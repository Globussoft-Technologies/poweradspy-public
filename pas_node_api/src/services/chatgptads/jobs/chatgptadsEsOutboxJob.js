'use strict';

/**
 * ChatGPT Ads ES outbox sweep — durability fix for the two failure windows found by live
 * testing on 2026-10-01 (see docs/insertion/chatgptads/MANIFEST.md):
 *   1. SQL commit succeeds, but the ES index/reindex call fails (cluster blip, timeout, …).
 *      The ad exists and is correct in SQL, but is NOT searchable until this job retries it.
 *   2. SQL row is deleted, but the ES delete call fails, leaving an orphaned doc behind.
 *
 * Mirrors admob's admobEsOutboxJob.js shape, but — unlike mob_es_outbox, which FK-cascades
 * away on ad delete and therefore can never record a delete failure — this one tracks BOTH
 * directions via chatgptads_es_outbox.action ('index' | 'delete'), with no FK on
 * chatgptads_ad_id (a 'delete' row's ad is gone by design).
 */

const databaseManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const repo = require('../insertion/repository');
const { buildChatgptSearchMixDoc, searchIdQuery, extractCarryOver } = require('../insertion/esDocBuilder');
const { CHATGPTADS_COLUMNS } = require('../insertion/esColumns');

const ES_INDEX = 'chatgpt_search_mix';
const log = logger.createChild('chatgptads-es-outbox');
let running = false;

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
function parseMaybeJson(v) {
  if (Array.isArray(v) || typeof v === 'object') return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

/** Rebuild the ES doc purely from what is durably in SQL (+ best-effort carry-over from
 * any still-existing ES doc) — an outbox retry has no access to the original request's
 * transient upload results, unlike the main pipeline's indexAd(). */
async function reindexOne(sql, elastic, chatgptadsAdId) {
  const joined = await repo.getJoinedAd(sql, 'chatgptads_ad.id', chatgptadsAdId);
  const row = joined[0];
  if (!row) return 'ad_gone'; // ad was deleted after this outbox row was queued — nothing to index

  let carryOver = {};
  try { carryOver = extractCarryOver(await elastic.search(searchIdQuery(ES_INDEX, chatgptadsAdId))); } catch { /* no existing doc — fine */ }

  const storedImg = row.image_url && !String(row.image_url).includes('DefaultImage') ? row.image_url : null;
  const extra = {};
  if (row.type === 'VIDEO') {
    extra.Thumbnail = storedImg ?? null;
    extra.nas_video_url = carryOver.nas_video_url ?? null;
  } else {
    extra.new_nas_image_url = storedImg ?? null;
  }
  if (row.image_url_original) extra.image_url_original = row.image_url_original;
  if (row.post_owner_image) extra.post_owner_image = row.post_owner_image;
  if (row.ad_image_video) extra.othermedia = parseMaybeJson(row.ad_image_video);
  // Same fix as chatgptadsPipeline.js's indexAd(): comes from SQL (chatgptads_translation via
  // getJoinedAd), not ES carry-over, which never held it. ES gets the full language NAME
  // ('English'), not the short code ('en') — the code stays SQL-only.
  extra.lang_detect = row.language_name ?? null;
  // Full country list, not just the primary — same reasoning as indexAd().
  extra.country = row.all_countries ? row.all_countries.split('||') : (row.country ? [row.country] : []);
  for (const k of Object.keys(carryOver)) if (extra[k] == null) extra[k] = carryOver[k];

  const doc = buildChatgptSearchMixDoc(CHATGPTADS_COLUMNS, row, { index: ES_INDEX, extra });
  // Deterministic _id (= chatgptads_ad.id), same reasoning as chatgptadsPipeline.js's
  // indexAd() — no search-then-reuse-found-_id race.
  await elastic.index({ index: doc.index, type: doc.type, id: String(chatgptadsAdId), body: doc.body });
  return 'indexed';
}

async function deleteOne(elastic, chatgptadsAdId) {
  try {
    await elastic.delete({ index: ES_INDEX, type: 'doc', id: String(chatgptadsAdId) });
  } catch (e) {
    if (e?.statusCode !== 404 && e?.meta?.statusCode !== 404) throw e;
  }
  return 'deleted'; // not found at all counts as already-deleted — still a success
}

async function runChatgptadsEsOutbox(jobConfig = {}, dependencies = {}) {
  if (running) {
    log.warn('ChatGPT Ads ES outbox sweep skipped — previous sweep still running');
    return { skipped: true, processed: 0, ok: 0, failed: 0 };
  }
  running = true;
  const db = dependencies.databaseManager || databaseManager;
  const repository = dependencies.repository || repo;
  const jobLog = dependencies.log || log;
  const batchSize = boundedInt(jobConfig.batchSize, 25, 1, 100);
  const maxAttempts = boundedInt(jobConfig.maxAttempts, 10, 1, 50);

  try {
    const sql = db.getSQL('chatgptads');
    const elastic = db.getElastic('chatgptads');
    if (!sql || !elastic) {
      jobLog.warn('ChatGPT Ads ES outbox sweep skipped — MySQL or Elasticsearch unavailable', {
        mysql: Boolean(sql), elasticsearch: Boolean(elastic),
      });
      return { skipped: true, processed: 0, ok: 0, failed: 0 };
    }

    const pending = await repository.getPendingEsOutbox(sql, batchSize, maxAttempts);
    let okCount = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const outcome = item.action === 'delete'
          ? await deleteOne(elastic, item.chatgptads_ad_id)
          : await reindexOne(sql, elastic, item.chatgptads_ad_id);
        await repository.completeEsOutbox(sql, item.id);
        okCount++;
        jobLog.info('ChatGPT Ads ES outbox item resolved', { id: item.id, ad_id: item.chatgptads_ad_id, action: item.action, outcome });
      } catch (error) {
        failed++;
        await repository.failEsOutbox(sql, item.id, error.message).catch((repoError) => {
          jobLog.error('ChatGPT Ads ES outbox retry state could not be updated', { id: item.id, error: repoError.message });
        });
        jobLog.error('ChatGPT Ads ES outbox item failed', {
          id: item.id, ad_id: item.chatgptads_ad_id, action: item.action,
          attempt: Number(item.attempts) + 1, error: error.message,
        });
      }
    }

    const result = { skipped: false, processed: pending.length, ok: okCount, failed };
    if (pending.length) jobLog.info('ChatGPT Ads ES outbox sweep completed', result);
    return result;
  } finally {
    running = false;
  }
}

module.exports = { runChatgptadsEsOutbox };

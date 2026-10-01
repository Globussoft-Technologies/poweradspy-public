'use strict';

/**
 * ChatGPT Ads delete pipeline — mirrors facebook's deletePipeline.js exactly, pointed at
 * chatgptads_ad / chatgpt_search_mix. No PHP equivalent exists for this network — the
 * shape is reused because it's sound, not because anything is being ported.
 */

const repo = require('./repository');
const { deleteFromNas } = require('../../../insertion/helpers/nasClient');
const { rejected, serverError } = require('../../../insertion/helpers/responses');

const ES_INDEX = 'chatgpt_search_mix';

function parseMaybeJson(v) {
  if (Array.isArray(v) || (v && typeof v === 'object')) return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
}

/** Collect every NAS path this ad owns EXCLUSIVELY (safe to delete) — deliberately excludes
 * post_owner_image, which lives on the DEDUPED chatgptads_ad_post_owners row and may be
 * shared by other ads from the same advertiser; deleting it here would break their images. */
function collectOwnedNasPaths(row, esSource) {
  const paths = [];
  const isDefault = (p) => !p || /DefaultImage/i.test(p);
  if (!isDefault(row?.image_url)) paths.push(row.image_url);
  const carousel = parseMaybeJson(row?.ad_image_video);
  if (Array.isArray(carousel)) {
    for (const p of carousel) if (typeof p === 'string' && !isDefault(p)) paths.push(p);
  } else if (carousel && typeof carousel === 'object') {
    for (const p of Object.values(carousel)) if (typeof p === 'string' && !isDefault(p)) paths.push(p);
  }
  // nas_video_url is NOT stored in SQL at all for this network (ES-only — see MANIFEST open
  // items) — the only place to read it back from before it's gone is the ES doc itself.
  if (esSource && !isDefault(esSource.nas_video_url)) paths.push(esSource.nas_video_url);
  return paths;
}

async function processDelete(ref, ctx) {
  const { db, log } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be deleted.');

  let internalId = ref.id;
  if (internalId === undefined || internalId === null || internalId === '') {
    if (ref.ad_id) {
      const found = await repo.getAdByAdId(sql, ref.ad_id);
      if (found.code !== 200) {
        return rejected(400, `No ad found for ad_id "${ref.ad_id}".`, {
          field: 'ad_id', hint: 'Pass an existing ad_id, or the internal id directly.',
        });
      }
      internalId = found.data[0].id;
    } else {
      return rejected(400, 'Provide the ad to delete: send `id` (internal) or `ad_id` (platform).', {
        hint: 'Body must include id or ad_id.',
      });
    }
  }

  try {
    // Read back everything needed to clean up NAS BEFORE anything is deleted — the video path
    // in particular exists ONLY in ES (never in SQL for this network), so it must be captured
    // before the ES doc is removed or it's unrecoverable.
    const joinedBefore = await repo.getJoinedAd(sql, 'chatgptads_ad.id', internalId);
    const rowBefore = joinedBefore[0] || null;
    let esSourceBefore = null;
    if (db.elastic) {
      try {
        const got = await db.elastic.get({ index: ES_INDEX, type: 'doc', id: String(internalId) });
        esSourceBefore = got?.body?._source || got?._source || null;
      } catch { /* no doc / not found — fine, nothing to carry over */ }
    }

    // Cancel any pending 'index' retry queued for this ad before the row disappears —
    // otherwise a stale reindex could fire for an ad that no longer exists.
    await repo.clearEsOutbox(sql, internalId).catch(() => {});
    const deleted = await repo.withTransaction(sql, (tx) => repo.deleteAdCascade(tx, internalId));
    if (!deleted) {
      return rejected(400, `Id ${internalId} is not present in the database.`, {
        hint: 'Nothing was deleted — the ad does not exist.',
      });
    }

    if (db.elastic) {
      try {
        // Deterministic _id = internalId — no search first (search-then-delete races the
        // index's refresh_interval; see chatgptadsPipeline.js's indexAd() comment for the
        // live-tested failure mode this avoids). 404 (already gone) is expected, not an error.
        await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: String(internalId) });
      } catch (e) {
        if (e?.statusCode === 404 || e?.meta?.statusCode === 404) {
          // already gone — nothing to do, not a failure
        } else {
          log.warn('ES delete failed (SQL row already removed) — queued for retry', { id: internalId, error: e.message });
          await repo.queueEsOutbox(sql, internalId, 'delete', e.message).catch(() => {});
        }
      }
    }

    // Best-effort NAS cleanup (main image/thumbnail, every othermultimedia/carousel item —
    // id_0, id_1, ... — and the video if any). Never blocks or fails the response: SQL+ES are
    // already gone at this point regardless of NAS outcome, same "best-effort, log on failure"
    // posture as every other NAS operation in this codebase. post_owner_image is deliberately
    // NOT included — see collectOwnedNasPaths()'s comment.
    const ownedPaths = collectOwnedNasPaths(rowBefore, esSourceBefore);
    const nasResults = await Promise.all(ownedPaths.map((p) => deleteFromNas(p, { adId: internalId })));
    const nasDeleted = nasResults.filter(Boolean).length;
    if (ownedPaths.length) {
      log.info('chatgptads NAS cleanup on delete', { id: internalId, attempted: ownedPaths.length, deleted: nasDeleted });
    }

    return { code: 200, status: 'ok', message: 'Data is deleted successfully !', data: { id: internalId } };
  } catch (err) {
    log.error('chatgptads delete pipeline error', { error: err.message, id: internalId });
    return serverError(500, 'The ad could not be deleted because of a server error.', { error: err.message });
  }
}

module.exports = { processDelete };

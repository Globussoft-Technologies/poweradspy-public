'use strict';

const crypto = require('crypto');
const media = require('../../../insertion/helpers/mediaUpload');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');
const { validateAdmobPayload } = require('./validate');
const { normalizeAdmobPayload } = require('./normalize');
const { resolveMediaUrl } = require('./mediaResolver');
const { buildAdmobDocument } = require('./esDocBuilder');
const repo = require('./repository');
const { invalidateAdmobFilterOptionsCache } = require('../../sdui/services/sduiService');

function hashPayload(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

async function processAdmobAd(payload, ctx) {
  const validation = validateAdmobPayload(payload);
  if (validation.code !== 200) return validation;

  const { db, log } = ctx;
  if (!db.sql) {
    return serverError(503, 'The AdMob MySQL connection to pasdev_admob is unavailable.', {
      hint: 'Check ADMOB_SQL_* configuration and pasdev_admob availability, then retry. No ad was saved.',
    });
  }
  if (!db.elastic) {
    return serverError(503, 'The AdMob Elasticsearch connection is unavailable.', {
      hint: 'Check ADMOB_ELASTIC_* configuration and mob_search_mix availability, then retry. No ad was saved.',
    });
  }

  const data = normalizeAdmobPayload(payload);
  let fetched = null;
  if (data.image_url_original) {
    try {
      const directUrl = await resolveMediaUrl(data.image_url_original);
      fetched = await media.fetchPrimaryMedia({ type: 'IMAGE', imageUrl: directUrl }, 'admob');
      if (!fetched.ok) {
        return rejected(422, 'The AdMob image could not be downloaded from image_url_original.', {
          field: 'image_url_original',
          hint: 'Send a live HTTP(S) image URL. For tmpfiles, either its page URL or /dl/ URL is accepted.',
        });
      }
    } catch (error) {
      return rejected(422, 'The AdMob image URL could not be resolved or downloaded.', {
        field: 'image_url_original',
        hint: `Check that the URL is public and not expired. Resolver reason: ${error.message}`,
      });
    }
  }

  let saved;
  try {
    saved = await repo.withTransaction(db.sql, async (tx) => {
      const existing = await repo.getAdForUpdate(tx, data.ad_id);
      const owner = await repo.ensureOwner(tx, data, !existing);
      const internalId = existing
        ? existing.id
        : await repo.insertAd(tx, data, owner?.id || null);
      if (existing) await repo.updateAd(tx, internalId, data, owner?.id || null);

      const newObservation = await repo.insertObservation(tx, internalId, data, hashPayload(data));
      await repo.upsertUrls(tx, internalId, data);
      await repo.upsertOriginalImage(tx, internalId, data.image_url_original);
      for (const country of data.country) {
        await repo.upsertDimension(tx, 'mob_ad_countries', 'country', internalId, country, data.last_seen, newObservation);
      }
      await repo.upsertDimension(tx, 'mob_ad_states', 'state', internalId, data.state, data.last_seen, newObservation);
      await repo.upsertDimension(tx, 'mob_ad_sub_networks', 'sub_network', internalId, data.sub_network, data.last_seen, newObservation);
      await repo.upsertSourceApp(tx, internalId, data, newObservation);
      await repo.queueEs(tx, internalId);
      return { internalId, inserted: !existing, newObservation };
    });
  } catch (error) {
    media.cleanupFetched(fetched);
    log.error('AdMob MySQL insertion failed', { ad_id: data.ad_id, error: error.message });
    return serverError(500, 'The AdMob ad could not be saved in pasdev_admob.', { error: error.message });
  }

  // This ad's country/state/sub_network/ad_position/image_size/source_app
  // values just committed to MySQL — clear the SDUI sidebar's in-memory
  // options cache so the next filter-panel request re-reads MySQL instead
  // of serving a snapshot from before this ad existed. Never let this block
  // the insertion response — it's a cheap, best-effort refresh signal.
  try {
    invalidateAdmobFilterOptionsCache();
  } catch (error) {
    log.warn('AdMob SDUI filter cache invalidation failed (non-fatal)', { error: error.message });
  }

  let nasPath = null;
  if (fetched) {
    const stored = await media.storePrimaryFromTemp(fetched, saved.internalId, 'admob');
    nasPath = stored.new_nas_image_url || stored.image_url || null;
    if (nasPath) {
      await repo.setNasImage(db.sql, saved.internalId, data.image_url_original, nasPath);
    }
  }

  try {
    const complete = await repo.getCompleteAd(db.sql, data.ad_id);
    const document = buildAdmobDocument(complete);
    const params = {
      index: db.elastic.indexName || 'mob_search_mix',
      id: String(saved.internalId),
      body: document,
      refresh: false,
    };
    if (Number(db.elastic.esMajor) <= 6) params.type = 'doc';
    await db.elastic.index(params);
    await repo.completeEs(db.sql, saved.internalId);
  } catch (error) {
    await repo.failEs(db.sql, saved.internalId, error.message).catch(() => {});
    log.error('AdMob Elasticsearch indexing failed', { ad_id: data.ad_id, id: saved.internalId, error: error.message });
      return {
        code: 503,
        status: 'server_error',
        message: 'The AdMob ad was saved in pasdev_admob, but Elasticsearch indexing is pending.',
        hint: 'Do not change the payload. Retry safely with the same ad_id and session_id; duplicate counters will not increase.',
        data: { id: saved.internalId, mysql_saved: true, elastic_indexed: false },
        error: error.message,
      };
  }

  return saved.inserted
    ? ok(saved.internalId, 'AdMob ad inserted successfully.')
    : updated(saved.internalId);
}

module.exports = { processAdmobAd };

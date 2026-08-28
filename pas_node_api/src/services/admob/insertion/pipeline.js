'use strict';

const fs = require('fs');
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

// AdMob-only guard: a "corrupted" image_url_original can still download as a
// 200 + non-empty response (a dead CDN serving an HTML error page, or a
// truncated file, with an image/* content-type) — fetchPrimaryMedia's ok:true
// doesn't catch that. Checking the real magic-byte signature here rejects it
// before the ad is ever saved. Scoped to this file only — the shared
// mediaUpload.js (used by every other network) is untouched.
function isValidImageFile(tmpPath) {
  let fd;
  try {
    fd = fs.openSync(tmpPath, 'r');
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, 12, 0);
    if (bytesRead < 4) return false;
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return true; // JPEG
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return true; // PNG
    if (header.toString('ascii', 0, 3) === 'GIF') return true; // GIF87a/89a
    if (header.toString('ascii', 0, 2) === 'BM') return true; // BMP
    if (bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return true;
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
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
      // Downloaded 200 + non-empty, but that alone doesn't mean it's a real
      // image — a dead CDN can serve an HTML error page with an image/*
      // content-type. Reject before it gets saved as if it were valid.
      if (fetched.image && !isValidImageFile(fetched.image)) {
        media.cleanupFetched(fetched);
        return rejected(422, 'The AdMob image_url_original did not return a valid image file.', {
          field: 'image_url_original',
          hint: 'The URL responded, but the downloaded file is not a recognizable image (corrupted, truncated, or an error page served with an image content-type).',
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

      // Resolved before the observation insert so the app can be stamped
      // directly onto that observation row (source_app_id) — needed for
      // accurate per-session, per-app breakdowns later.
      const { sourceAppId, isNewApp } = await repo.resolveSourceAppId(tx, data);
      const newObservation = await repo.insertObservation(tx, internalId, data, hashPayload(data), sourceAppId);
      await repo.upsertUrls(tx, internalId, data);
      await repo.upsertOriginalImage(tx, internalId, data.image_url_original);
      for (const country of data.country) {
        await repo.upsertDimension(tx, 'mob_ad_countries', 'country', internalId, country, data.last_seen, newObservation);
      }
      await repo.upsertDimension(tx, 'mob_ad_states', 'state', internalId, data.state, data.last_seen, newObservation);
      await repo.upsertDimension(tx, 'mob_ad_sub_networks', 'sub_network', internalId, data.sub_network, data.last_seen, newObservation);
      await repo.bumpSourceAppCounters(tx, internalId, sourceAppId, isNewApp, data, newObservation);
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

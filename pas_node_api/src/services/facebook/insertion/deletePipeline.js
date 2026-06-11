'use strict';

/**
 * Facebook delete pipeline — port of adsDataController::deleteads().
 *
 * Deletes an ad and all its child rows from SQL (in one transaction) and removes
 * the doc from Elasticsearch `search_mix`. Accepts the internal facebook_ad.id
 * (`id`) or the platform `ad_id` (resolved to the internal id first).
 *
 * processDelete(ref, ctx) → { code, status, message }. ctx = { db, log, network }.
 */

const repo = require('./repository');
const { searchIdQuery, firstHitId } = require('./esDocBuilder');
const { rejected, serverError } = require('../../../insertion/helpers/responses');

const ES_INDEX = 'search_mix';

async function processDelete(ref, ctx) {
  const { db, log } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be deleted.');

  // Resolve the internal facebook_ad.id from `id` (direct) or `ad_id` (platform).
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
    // 1. SQL cascade delete (atomic)
    const deleted = await repo.withTransaction(sql, (tx) => repo.deleteAdCascade(tx, internalId));
    if (!deleted) {
      return rejected(400, `Id ${internalId} is not present in the database.`, {
        hint: 'Nothing was deleted — the ad does not exist.',
      });
    }

    // 2. Elasticsearch delete (best-effort — SQL is the source of truth)
    if (db.elastic) {
      try {
        const _id = firstHitId(await db.elastic.search(searchIdQuery(ES_INDEX, internalId)));
        if (_id) await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: _id });
      } catch (e) {
        log.warn('ES delete failed (SQL row already removed)', { id: internalId, error: e.message });
      }
    }

    return { code: 200, status: 'ok', message: 'Data is deleted successfully !', data: { id: internalId } };
  } catch (err) {
    log.error('delete pipeline error', { error: err.message, id: internalId });
    return serverError(500, 'The ad could not be deleted because of a server error.', { error: err.message });
  }
}

module.exports = { processDelete };

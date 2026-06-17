'use strict';

/**
 * GDN delete pipeline — port of UserController::deleteads() (the function you supplied).
 * See ../../../../PHP-SPEC-gdn.md §5.
 *
 * Faithful-but-fixed (MANIFEST §0.5): the whole SQL cascade runs inside ONE
 * transaction (PHP had no transaction + a stray DB::rollback with no active tx),
 * and errors return structured results instead of raw exception strings.
 *
 * Accepts the internal gdn_ad.id (`id`) or the platform `ad_id`. The delete-token
 * guard (PHP API_DELETE_TOKEN) is enforced by the deleteAuth middleware on the route.
 *
 * processDelete(ref, ctx) → { code, status, message }. ctx = { db, log, network }.
 */

const repo = require('./repository');
const { searchIdQuery, firstHitId } = require('./esDocBuilder');
const { rejected, serverError } = require('../../../insertion/helpers/responses');

const ES_INDEX = 'gdn_search_mix_v2'; // module fallback; per-call below sources the network's configured index (db.elastic.indexName)

async function processDelete(ref, ctx) {
  const { db, log } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be deleted.');

  // Resolve internal gdn_ad.id from `id` (direct) or `ad_id` (platform).
  let internalId = ref.id;
  if (internalId === undefined || internalId === null || internalId === '') {
    if (ref.ad_id) {
      const found = await repo.getAdByAdId(sql, ref.ad_id);
      if (found.code !== 200) {
        return rejected(403, `Id is not present in database !`, {
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
      return rejected(403, `Id is not present in database !`, { hint: 'Nothing was deleted — the ad does not exist.' });
    }

    // 2. Elasticsearch delete (best-effort — SQL is the source of truth)
    if (db.elastic) {
      const ES_INDEX = db.elastic.indexName || 'gdn_search_mix_v2';
      try {
        const _id = firstHitId(await db.elastic.search(searchIdQuery(ES_INDEX, internalId)));
        if (_id) await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: _id });
      } catch (e) {
        log.warn('gdn ES delete failed (SQL row already removed)', { id: internalId, error: e.message });
      }
    }

    return { code: 200, status: 'ok', message: 'Data is deleted successfully !', data: { id: internalId } };
  } catch (err) {
    log.error('gdn delete pipeline error', { error: err.message, id: internalId });
    return serverError(500, 'The ad could not be deleted because of a server error.', { error: err.message });
  }
}

module.exports = { processDelete };

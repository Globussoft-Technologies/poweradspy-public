'use strict';

/**
 * GTEXT (Google Text) delete pipeline — port of UserController@deleteads.
 * Cascade-delete google_text_* children + google_text_ad (one transaction), then remove
 * the doc from Elasticsearch `google_ads_data_v2` (the live index the O-path writes to).
 *
 * Faithful-but-fixed: atomic transaction + structured errors. Accepts `id` (internal) or `ad_id`.
 */

const repo = require('./repository');
const { searchIdQuery, firstHitId, ES_INDEX } = require('./esDocBuilder');
const { rejected, serverError } = require('../../../insertion/helpers/responses');

async function processDelete(ref, ctx) {
  const { db, log } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be deleted.');

  let internalId = ref.id;
  if (internalId === undefined || internalId === null || internalId === '') {
    if (ref.ad_id) {
      const f = await repo.getAdByAdId(sql, ref.ad_id);
      if (f.code !== 200) return rejected(403, 'Id is not present in database !', { field: 'ad_id', hint: 'Pass an existing ad_id, or the internal id directly.' });
      internalId = f.data[0].id;
    } else {
      return rejected(400, 'Provide the ad to delete: send `id` (internal) or `ad_id` (platform).', { hint: 'Body must include id or ad_id.' });
    }
  }

  try {
    const deleted = await repo.withTransaction(sql, (tx) => repo.deleteAdCascade(tx, internalId));
    if (!deleted) return rejected(403, 'Id is not present in database !', { hint: 'Nothing was deleted — the ad does not exist.' });

    if (db.elastic) {
      try {
        const esIndex = db.elastic.indexName || ES_INDEX;
        const _id = firstHitId(await db.elastic.search(searchIdQuery(esIndex, internalId)));
        if (_id) await db.elastic.delete({ index: esIndex, type: 'doc', id: _id });
      } catch (e) {
        log.warn('gtext ES delete failed (SQL row already removed)', { id: internalId, error: e.message });
      }
    }

    return { code: 200, status: 'ok', message: 'Data is deleted successfully !', data: { id: internalId } };
  } catch (err) {
    log.error('gtext delete pipeline error', { error: err.message, id: internalId });
    return serverError(500, 'The ad could not be deleted because of a server error.', { error: err.message });
  }
}

module.exports = { processDelete };

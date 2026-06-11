'use strict';

/**
 * Instagram delete pipeline — port of InstagramUserController::deleteads.
 * Cascade SQL delete (instagram_* tables) + Elasticsearch delete (instagram_search_mix).
 * Accepts internal `id` or platform `ad_id`.
 */

const repo = require('./repository');
const { ES_INDEX } = require('./esColumns');
const { searchIdQuery, firstHitId } = require('./esDocBuilder');
const { rejected, serverError } = require('../../../insertion/helpers/responses');

async function processDelete(ref, ctx) {
  const { db, log } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be deleted.');

  let internalId = ref.id;
  if (internalId === undefined || internalId === null || internalId === '') {
    if (ref.ad_id) {
      const f = await repo.getAdByAdId(sql, ref.ad_id);
      if (f.code !== 200) return rejected(400, `No ad found for ad_id "${ref.ad_id}".`, { field: 'ad_id' });
      internalId = f.data[0].id;
    } else {
      return rejected(400, 'Provide the ad to delete: send `id` (internal) or `ad_id` (platform).');
    }
  }

  try {
    const deleted = await repo.withTransaction(sql, (tx) => repo.deleteAdCascade(tx, internalId));
    if (!deleted) return rejected(400, `Id ${internalId} is not present in the database.`);

    if (db.elastic) {
      try {
        const _id = firstHitId(await db.elastic.search(searchIdQuery(ES_INDEX, internalId)));
        if (_id) await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: _id });
      } catch (e) { log.warn('ES delete failed (SQL row already removed)', { id: internalId, error: e.message }); }
    }
    return { code: 200, status: 'ok', message: 'Data is deleted successfully !', data: { id: internalId } };
  } catch (err) {
    log.error('instagram delete error', { error: err.message, id: internalId });
    return serverError(500, 'The ad could not be deleted because of a server error.', { error: err.message });
  }
}

module.exports = { processDelete };

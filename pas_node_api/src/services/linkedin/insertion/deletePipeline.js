'use strict';

/**
 * LinkedIn delete pipeline — port of UserController@deleteads (api_linkedin 1745-1833).
 * Cascade-delete linkedin_* children + linkedin_ad (one transaction), then remove the
 * doc from Elasticsearch `linkedin_ads_data`.
 *
 * The ES _id IS the internal linkedin_ad.id (PHP indexes with id = linkedin_ad.id and
 * deletes by that id directly), so delete addresses ES by _id = internalId — no search.
 *
 * Faithful-but-fixed: atomic transaction + structured errors. Accepts `id` (internal,
 * what the PHP delete uses) or `ad_id` (platform — resolved to the internal id).
 */

const repo = require('./repository');
const { ES_INDEX } = require('./esDocBuilder');
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
        await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: String(internalId) });
      } catch (e) {
        log.warn('linkedin ES delete failed (SQL row already removed)', { id: internalId, error: e.message });
      }
    }

    return { code: 200, status: 'ok', message: 'Data is deleted successfully !', data: { id: internalId } };
  } catch (err) {
    log.error('linkedin delete pipeline error', { error: err.message, id: internalId });
    return serverError(500, 'The ad could not be deleted because of a server error.', { error: err.message });
  }
}

module.exports = { processDelete };

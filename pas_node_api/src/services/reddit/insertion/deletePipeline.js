'use strict';

/**
 * Reddit deletion pipeline — secure delete with cascade.
 */

const repo = require('./repository');
const { ok, rejected, serverError } = require('../../../insertion/helpers/responses');

const ES_INDEX = 'reddit_search_mix';

async function processDelete(req, ctx) {
  const { db, log, network = 'reddit' } = ctx;
  const sql = db.sql;

  if (!sql) {
    return serverError(503, 'Database connection is not available, so the ad could not be deleted.');
  }

  const { id, ad_id } = req.body;

  // Accept either id (internal) or ad_id (platform id)
  let redditAdId;

  if (id) {
    redditAdId = id;
  } else if (ad_id && String(ad_id).trim() !== '') {
    // Fallback: lookup by ad_id
    const existing = await repo.getAdByAdId(sql, ad_id);
    if (existing.code !== 200) {
      return rejected(404, `Ad with ad_id "${ad_id}" not found.`, {
        field: 'ad_id',
        hint: 'The ad does not exist, so no deletion was performed.',
      });
    }
    redditAdId = existing.data[0].id;
  } else {
    return rejected(400, 'Missing id or ad_id in request body.', {
      field: 'id',
      hint: 'Provide the internal id (preferred) or platform ad_id.',
    });
  }

  try {
    // Delete from DB (cascade)
    await repo.withTransaction(sql, async (tx) => {
      await repo.deleteAdCascade(tx, redditAdId);
    });

    // Delete from ES
    await db.elastic?.delete({
      index: ES_INDEX,
      id: String(redditAdId),
    }).catch(() => {});

    return ok(redditAdId, `Ad deleted successfully (id: ${redditAdId}).`);
  } catch (err) {
    log?.error('Error deleting Reddit ad', {
      error: err.message,
      ad_id,
    });
    return serverError(500, 'An error occurred while deleting the ad.', { error: err.message });
  }
}

module.exports = { processDelete };

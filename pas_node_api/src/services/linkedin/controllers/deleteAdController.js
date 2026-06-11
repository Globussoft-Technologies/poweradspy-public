'use strict';

/**
 * LinkedIn delete-ad controller — thin glue over the delete pipeline.
 * Accepts { id } (internal — what the PHP delete uses) or { ad_id } (platform).
 * Token guard is on the route (deleteAuth).
 */

const { processDelete } = require('../insertion/deletePipeline');

async function deleteAd(req, db, logger) {
  const ctx = { db, log: logger, network: 'linkedin' };
  const body = req.body || {};
  return processDelete({ id: body.id, ad_id: body.ad_id }, ctx);
}

module.exports = { deleteAd };

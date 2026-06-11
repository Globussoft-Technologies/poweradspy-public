'use strict';

/**
 * Facebook delete-ad controller — thin glue over the delete pipeline.
 * Accepts { id } (internal) or { ad_id } (platform).
 */

const { processDelete } = require('../insertion/deletePipeline');

async function deleteAd(req, db, logger) {
  const ctx = { db, log: logger, network: 'facebook' };
  const body = req.body || {};
  return processDelete({ id: body.id, ad_id: body.ad_id }, ctx);
}

module.exports = { deleteAd };

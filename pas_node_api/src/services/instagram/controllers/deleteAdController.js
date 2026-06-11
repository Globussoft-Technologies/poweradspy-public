'use strict';

const { processDelete } = require('../insertion/deletePipeline');

async function deleteAd(req, db, logger) {
  const ctx = { db, log: logger, network: 'instagram' };
  const body = req.body || {};
  return processDelete({ id: body.id, ad_id: body.ad_id }, ctx);
}

module.exports = { deleteAd };

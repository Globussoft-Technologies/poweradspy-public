'use strict';

/**
 * Reddit delete controller — thin glue.
 */

const { processDelete } = require('../insertion/deletePipeline');

/**
 * @param {Object} req
 * @param {Object} db
 * @param {Object} logger
 */
async function deleteAd(req, db, logger) {
  const ctx = { db, log: logger, network: 'reddit' };
  return await processDelete(req, ctx);
}

module.exports = { deleteAd };

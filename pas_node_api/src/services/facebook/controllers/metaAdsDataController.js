'use strict';

/**
 * Facebook metaAdsData controller — thin glue.
 * Parses one ad or an array, runs the pipeline through the shared InsertionEngine,
 * and formats the response. All real logic lives in insertion/metaAdsPipeline.js.
 */

const engine = require('../../../insertion/InsertionEngine');
const { processMetaAd } = require('../insertion/metaAdsPipeline');

/**
 * @param {Object} req
 * @param {Object} db     - { sql, mongo, elastic } injected per network
 * @param {Object} logger
 */
async function metaAdsData(req, db, logger) {
  const ctx = { db, log: logger, network: 'facebook' };
  const body = req.body;

  // Accept a single ad object OR { ads: [...] } OR a bare array.
  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;

  const out = await engine.run(payload, (ad) => processMetaAd(ad, ctx), ctx);

  if (out.batch) {
    const { total, ok, failed } = out.summary;
    return {
      code: 200,
      status: failed === 0 ? 'ok' : 'partial',
      message: `Processed ${total} ad(s): ${ok} succeeded, ${failed} failed.`,
      hint: failed ? 'Check each item in `data` — failed ones include their own message/hint explaining why.' : undefined,
      data: out.results,
      meta: out.summary,
    };
  }
  return out.result;
}

module.exports = { metaAdsData };

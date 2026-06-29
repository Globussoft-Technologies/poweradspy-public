'use strict';

/**
 * Reddit redAdsData controller — thin glue.
 * Parses one ad or an array, runs through the shared InsertionEngine,
 * and formats the response.
 */

const engine = require('../../../insertion/InsertionEngine');
const { processRedditAd } = require('../insertion/redditAdsPipeline');

/**
 * @param {Object} req
 * @param {Object} db     - { sql, mongo, elastic } injected per network
 * @param {Object} logger
 */
async function redditAdsData(req, db, logger) {
  const ctx = { db, log: logger, network: 'reddit' };
  const body = req.body;

  // Accept a single ad object OR { ads: [...] } OR a bare array.
  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;

  const out = await engine.run(payload, (ad) => processRedditAd(ad, ctx), ctx);

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

module.exports = { redditAdsData };

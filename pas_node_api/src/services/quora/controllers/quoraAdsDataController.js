'use strict';

/**
 * Quora adsData controller — thin glue.
 * Parses one ad or an array, runs through the shared InsertionEngine,
 * and formats the response.
 */

const engine = require('../../../insertion/InsertionEngine');
const { processQuoraAd } = require('../insertion/quoraAdsPipeline');

async function quoraAdsData(req, db, logger) {
  const ctx = { db, log: logger, network: 'quora' };
  const body = req.body;

  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;

  const out = await engine.run(payload, (ad) => processQuoraAd(ad, ctx), ctx);

  if (out.batch) {
    const { total, ok: okCount, failed } = out.summary;
    return {
      code: 200,
      status: failed === 0 ? 'ok' : 'partial',
      message: `Processed ${total} ad(s): ${okCount} succeeded, ${failed} failed.`,
      hint: failed ? 'Check each item in `data` — failed ones include their own message/hint explaining why.' : undefined,
      data: out.results,
      meta: out.summary,
    };
  }
  return out.result;
}

module.exports = { quoraAdsData };

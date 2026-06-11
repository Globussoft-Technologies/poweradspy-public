'use strict';

/**
 * LinkedIn lnAdsData controller — thin glue (mirrors GDN/gtext).
 * Parses one ad or an array, runs the pipeline through the shared InsertionEngine.
 */

const engine = require('../../../insertion/InsertionEngine');
const { processMetaAd } = require('../insertion/metaAdsPipeline');

async function lnAdsData(req, db, logger) {
  const ctx = { db, log: logger, network: 'linkedin' };
  const body = req.body;
  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;

  const out = await engine.run(payload, (ad) => processMetaAd(ad, ctx));

  if (out.batch) {
    const { total, ok, failed } = out.summary;
    return {
      code: 200,
      status: failed === 0 ? 'ok' : 'partial',
      message: `Processed ${total} ad(s): ${ok} succeeded, ${failed} failed.`,
      hint: failed ? 'Check each item in `data` — failed ones include their own message/hint.' : undefined,
      data: out.results,
      meta: out.summary,
    };
  }
  return out.result;
}

module.exports = { lnAdsData };

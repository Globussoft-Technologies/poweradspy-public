'use strict';

const engine = require('../../../insertion/InsertionEngine');
const { processGramAd } = require('../insertion/gramAdsPipeline');

async function gramAdsData(req, db, logger) {
  const ctx = { db, log: logger, network: 'instagram' };
  const body = req.body;
  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;
  const out = await engine.run(payload, (ad) => processGramAd(ad, ctx));
  if (out.batch) {
    const { total, ok, failed } = out.summary;
    return { code: 200, status: failed === 0 ? 'ok' : 'partial', message: `Processed ${total} ad(s): ${ok} succeeded, ${failed} failed.`, hint: failed ? 'Check each item in `data` for its message/hint.' : undefined, data: out.results, meta: out.summary };
  }
  return out.result;
}

module.exports = { gramAdsData };

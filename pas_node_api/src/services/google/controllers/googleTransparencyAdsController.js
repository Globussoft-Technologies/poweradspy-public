'use strict';

const engine = require('../../../insertion/InsertionEngine');
const { processTransparencyAd } = require('../transparencyInsertion/pipeline');
const { processMetaAd } = require('../insertion/metaAdsPipeline');

async function googleTransparencyAds(req, db, log) {
  const body = req.body;
  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;
  const ctx = { db, log, network: 'google', requestId: req.id || req.requestId || null };
  const out = await engine.run(
    payload,
    (ad, index) => Number(ad?.platform) === 18
      ? processTransparencyAd(ad, { ...ctx, index })
      : processMetaAd(ad, ctx),
    ctx
  );
  if (!out.batch) return out.result;
  return {
    code: 200,
    status: out.summary.failed === 0 ? 'ok' : 'partial',
    message: `Processed ${out.summary.total} ad(s): ${out.summary.ok} succeeded, ${out.summary.failed} failed.`,
    data: out.results,
    meta: out.summary,
  };
}

module.exports = { googleTransparencyAds };

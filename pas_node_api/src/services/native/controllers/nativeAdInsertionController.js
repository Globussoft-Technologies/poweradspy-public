'use strict';

const engine = require('../../../insertion/InsertionEngine');
const { processNativeAd } = require('../insertion/insertNativeAdPipeline');
const { processDelete }   = require('../insertion/deletePipeline');

async function insertAds(req, db, logger) {
  const ctx  = { db, log: logger, network: 'native' };
  const body = req.body;

  // Accept a single ad object OR { ads: [...] } OR a bare array
  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;

  const out = await engine.run(payload, (ad) => processNativeAd(ad, ctx));

  if (out.batch) {
    const { total, ok, failed } = out.summary;
    return {
      code:    200,
      status:  failed === 0 ? 'ok' : 'partial',
      message: `Processed ${total} ad(s): ${ok} succeeded, ${failed} failed.`,
      hint:    failed ? 'Check each item in `data` for per-ad errors.' : undefined,
      data:    out.results,
      meta:    out.summary,
    };
  }
  return out.result;
}

async function deleteAd(req, db, logger) {
  return processDelete(req.body, { db, log: logger, network: 'native' });
}

module.exports = { insertAds, deleteAd };

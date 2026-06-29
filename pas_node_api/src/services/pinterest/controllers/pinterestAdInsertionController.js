'use strict';

const engine = require('../../../insertion/InsertionEngine');
const { processPinterestAd } = require('../insertion/insertPinterestAdPipeline');
const { processDelete }      = require('../insertion/deletePipeline');

async function insertAds(req, db, logger) {
  const ctx  = { db, log: logger, network: 'pinterest' };
  const body = req.body;
  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;

  const out = await engine.run(payload, (ad) => processPinterestAd(ad, ctx), ctx);

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
  return processDelete(req.body, { db, log: logger, network: 'pinterest' });
}

module.exports = { insertAds, deleteAd };

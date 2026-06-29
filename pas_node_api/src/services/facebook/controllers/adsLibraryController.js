'use strict';

/**
 * Facebook adsLibrary controller — thin glue.
 * Parses one ad or an array, runs the pipeline through the shared InsertionEngine,
 * formats the response. Real logic lives in insertion/adsLibraryPipeline.js.
 */

const engine = require('../../../insertion/InsertionEngine');
const { processAdsLibrary } = require('../insertion/adsLibraryPipeline');

async function adsLibrary(req, db, logger) {
  const ctx = { db, log: logger, network: 'facebook' };
  const body = req.body;
  const payload = Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;

  const out = await engine.run(payload, (ad) => processAdsLibrary(ad, ctx), ctx);

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

module.exports = { adsLibrary };

'use strict';

const engine = require('../../../insertion/InsertionEngine');
const { rejected } = require('../../../insertion/helpers/responses');
const { processAdmobAd } = require('../insertion/pipeline');

function payloadFrom(body) {
  return Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : body;
}

function withMeta(result, req) {
  return {
    ...result,
    meta: {
      ...(result.meta || {}),
      requestId: req.id || req.requestId || null,
      timestamp: new Date().toISOString(),
    },
  };
}

async function insertAds(req, db, log) {
  const payload = payloadFrom(req.body);
  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length === 0) {
    return withMeta(rejected(422, 'The AdMob batch is empty.', { hint: 'Send one ad object or a non-empty ads array.' }), req);
  }
  const ctx = { db, log, network: 'admob', requestId: req.id || req.requestId || null };
  const output = await engine.run(payload, (ad) => processAdmobAd(ad, ctx), ctx);
  if (!output.batch) {
    const result = output.result;
    if (result.code >= 200 && result.code < 300) {
      return {
        code: result.code,
        status: result.status,
        message: result.message,
        data: { id: result.data.id },
      };
    }
    return withMeta(result, req);
  }
  return withMeta({
    code: 200,
    status: output.summary.failed === 0 ? 'ok' : 'partial',
    message: `Processed ${output.summary.total} AdMob ad(s): ${output.summary.ok} succeeded and ${output.summary.failed} failed.`,
    data: output.results,
    meta: output.summary,
  }, req);
}

module.exports = { insertAds };

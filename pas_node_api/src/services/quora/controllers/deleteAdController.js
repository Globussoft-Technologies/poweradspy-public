'use strict';

/**
 * Quora delete ad controller — thin glue.
 */

const engine = require('../../../insertion/InsertionEngine');
const { processDelete } = require('../insertion/deletePipeline');

async function deleteAd(req, db, logger) {
  const ctx = { db, log: logger, network: 'quora' };
  const body = req.body;

  const payload = Array.isArray(body) ? body : body;

  const out = await engine.run(payload, (item) => processDelete(item, ctx));

  if (out.batch) {
    const { total, ok: okCount, failed } = out.summary;
    return {
      code: 200,
      status: failed === 0 ? 'ok' : 'partial',
      message: `Deleted ${total} ad(s): ${okCount} succeeded, ${failed} failed.`,
      data: out.results,
      meta: out.summary,
    };
  }
  return out.result;
}

module.exports = { deleteAd };

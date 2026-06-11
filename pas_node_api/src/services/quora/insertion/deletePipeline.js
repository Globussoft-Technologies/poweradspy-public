'use strict';

/**
 * Quora insertion — delete pipeline.
 * Cascade-delete ad and all related rows, then remove from ES.
 */

const repo = require('./repository');
const { ok, rejected, serverError } = require('../../../insertion/helpers/responses');

async function processDelete(delReq, ctx) {
  const { db, log, network = 'quora' } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection unavailable.');

  const { ad_id, id } = delReq;
  const adId = ad_id || id;

  if (!adId) {
    return rejected(400, 'Missing ad_id or id field.', {
      field: 'ad_id',
      hint: 'Provide either ad_id or id to identify the ad.',
    });
  }

  try {
    let internalId;

    // Support both numeric internal ID and string ad_id
    if (typeof delReq.id === 'number' || (typeof delReq.id === 'string' && /^\d+$/.test(delReq.id))) {
      // Numeric ID provided — use directly as internal ID
      internalId = Number(delReq.id);
    } else if (ad_id) {
      // ad_id provided — lookup internal ID
      const existing = await repo.getAdByAdId(sql, ad_id);
      if (existing.code !== 200 || !existing.data.length) {
        return rejected(404, `Ad with ad_id "${ad_id}" not found.`);
      }
      internalId = existing.data[0].id;
    } else {
      return rejected(400, 'Must provide either numeric id (internal ID) or ad_id (platform ID).', {
        example1: { id: 8497 },
        example2: { ad_id: 'quora_campaign_001' },
      });
    }

    // Cascade delete inside transaction with FK constraints disabled
    const deleteResult = await repo.withTransaction(sql, async (tx) => {
      try {
        // Disable FK constraint checks
        await tx.query('SET FOREIGN_KEY_CHECKS=0');

        const result = await repo.deleteAdCascade(tx, internalId);

        // Re-enable FK constraint checks
        await tx.query('SET FOREIGN_KEY_CHECKS=1');
        return result;
      } catch (txErr) {
        try { await tx.query('SET FOREIGN_KEY_CHECKS=1'); } catch { /* ignore */ }
        throw txErr;
      }
    });


    // Delete from ES
    if (db.elastic) {
      try {
        await db.elastic.delete({
          index: 'quora_search_mix',
          id: String(internalId),
        });
      } catch (err) {
        log.warn('ES delete failed', { error: err.message });
      }
    }

    return ok(internalId, 'Ad deleted successfully.');
  } catch (err) {
    log.error('Delete failed', { error: err.message, stack: err.stack });
    return serverError(500, 'Failed to delete ad.', { error: err.message });
  }
}

module.exports = { processDelete };

'use strict';

/**
 * AdMob insertion — delete pipeline.
 * Cascade-delete ad and all related rows, then remove from ES.
 */

const repo = require('./repository');
const { ok, rejected, serverError } = require('../../../insertion/helpers/responses');

async function processDelete(delReq, ctx) {
  const { db, log } = ctx;
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
      const existing = await sql.query('SELECT id FROM mob_ads WHERE ad_id = ? LIMIT 1', [ad_id]);
      if (!existing.length) {
        return rejected(404, `Ad with ad_id "${ad_id}" not found.`);
      }
      internalId = existing[0].id;
    } else {
      return rejected(400, 'Must provide either numeric id (internal ID) or ad_id (platform ID).', {
        example1: { id: 8497 },
        example2: { ad_id: '7a452594d89609f86c27c7d8' },
      });
    }

    const affectedRows = await repo.withTransaction(sql, (tx) => repo.deleteAdCascade(tx, internalId));
    if (!affectedRows) {
      return rejected(404, `Ad with internal id "${internalId}" not found.`);
    }

    // ES doc is keyed by the internal mob_ads.id (see docs/erd/admob.md), so a
    // direct id delete works — no search-then-delete needed like other networks.
    if (db.elastic) {
      try {
        await db.elastic.delete({ index: 'mob_search_mix', id: String(internalId) });
      } catch (err) {
        if (err?.meta?.statusCode !== 404) {
          log.warn('ES delete failed', { error: err.message });
        }
      }
    }

    return ok(internalId, 'Ad deleted successfully.');
  } catch (err) {
    log.error('Delete failed', { error: err.message, stack: err.stack });
    return serverError(500, 'Failed to delete ad.', { error: err.message });
  }
}

module.exports = { processDelete };

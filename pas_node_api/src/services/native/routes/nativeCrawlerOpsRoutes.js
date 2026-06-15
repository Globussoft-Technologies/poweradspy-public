'use strict';

/**
 * Native crawler-ops routes — NEW, additive. Does NOT touch nativeInsertionRoutes.js / the ad-insert path.
 * Auto-mounted by ServiceRegistry under /api/v1/native (module.exports is the factory function).
 *
 *   POST /api/v1/native/insertion/crawlQuality -> recordCrawlQuality('native_crawl_quality')
 *   POST /api/v1/native/insertion/adExists     -> dedup check against native_ad ({existing:[...], exists})
 *
 * Guard: insertionEnabled('native') + insertionAuth (platform=12 bypass), same as adsData.
 * Replaces the crawler's former direct pymysql dedup SELECT against pasdev_native.native_ad.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { recordCrawlQuality } = require('../../../insertion/helpers/crawlQuality');

const httpStatus = (code) => (code === 200 ? 200 : code);

async function adExists(req, db, log) {
  const sql = db && db.sql;
  if (!sql) return { code: 503, status: 'error', message: 'Database connection is not available.' };
  const b = req.body || {};
  const ids = Array.isArray(b.ad_ids) ? b.ad_ids : (b.ad_id != null ? [b.ad_id] : []);
  const clean = ids.map((x) => String(x)).filter(Boolean).slice(0, 500);
  if (!clean.length) return { code: 400, status: 'rejected', message: 'Provide `ad_id` or `ad_ids`.' };
  try {
    const placeholders = clean.map(() => '?').join(',');
    const rows = await sql.query(`SELECT ad_id FROM native_ad WHERE ad_id IN (${placeholders})`, clean);
    const existing = rows.map((r) => String(r.ad_id));
    return { code: 200, status: 'ok', data: { existing, exists: existing.length > 0 } };
  } catch (e) {
    if (log && log.warn) log.warn('adExists(native) failed', { error: e.message });
    return { code: 500, status: 'error', message: e.message };
  }
}

function createNativeCrawlerOpsRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('native'), insertionAuth];

  router.post('/insertion/crawlQuality', ...guard, asyncHandler(async (req, res) => {
    const r = await recordCrawlQuality('native_crawl_quality', req, service.db, service.log);
    return res.status(httpStatus(r.code)).json(r);
  }));

  router.post('/insertion/adExists', ...guard, asyncHandler(async (req, res) => {
    const r = await adExists(req, service.db, service.log);
    return res.status(httpStatus(r.code)).json(r);
  }));

  return router;
}

module.exports = createNativeCrawlerOpsRoutes;

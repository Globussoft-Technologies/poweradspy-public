'use strict';

/**
 * GDN crawler-ops routes — NEW, additive. Does NOT touch gdnInsertionRoutes.js / the ad-insert path.
 * Auto-mounted by ServiceRegistry under /api/v1/gdn (module.exports is the factory function).
 *
 *   POST /api/v1/gdn/insertion/crawlQuality  -> recordCrawlQuality('gdn_crawl_quality')  (per-URL rolling yield)
 *   POST /api/v1/gdn/insertion/proxyHealth   -> UPSERT proxy_health                       (per-IP/port ad yield)
 *   POST /api/v1/gdn/insertion/adExists      -> dedup check against gdn_ad                ({existing:[...], exists})
 *
 * Guard: insertionEnabled('gdn') + insertionAuth. Clients authenticate with the platform=12 bypass
 * (include "platform":"12" in the JSON body) exactly like gdnAdsData — so the crawler needs no new secret.
 * These replace the crawler's former direct pymysql writes to staging (crawl_quality / proxy_health / dedup).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { recordCrawlQuality } = require('../../../insertion/helpers/crawlQuality');

const httpStatus = (code) => (code === 200 ? 200 : code);

// Per-proxy ad-yield rollup: which dedicated IP/port produced how many ads. proxy_health lives in the
// GDN database. Mirrors the crawler's former UPSERT exactly (counters accumulate; ip kept if blank).
const PROXY_HEALTH_SQL = `
INSERT INTO proxy_health (port, ip, country, ads_total, urls_crawled, last_crawl_at, updated_at)
VALUES (?, ?, ?, ?, ?, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  ads_total     = ads_total + VALUES(ads_total),
  urls_crawled  = urls_crawled + VALUES(urls_crawled),
  ip            = IF(VALUES(ip) <> '', VALUES(ip), ip),
  country       = VALUES(country),
  last_crawl_at = NOW(),
  updated_at    = NOW()`;

async function recordProxyHealth(req, db, log) {
  const sql = db && db.sql;
  if (!sql) return { code: 503, status: 'error', message: 'Database connection is not available.' };
  const b = req.body || {};
  const port = parseInt(b.port, 10);
  if (!Number.isFinite(port)) return { code: 400, status: 'rejected', message: 'Provide a numeric `port`.' };
  try {
    await sql.query(PROXY_HEALTH_SQL, [
      port, String(b.ip || ''), String(b.country || ''),
      parseInt(b.ads, 10) || 0, parseInt(b.urls, 10) || 0,
    ]);
    return { code: 200, status: 'ok', message: 'Proxy health recorded' };
  } catch (e) {
    if (log && log.warn) log.warn('proxyHealth upsert failed', { port, error: e.message });
    return { code: 500, status: 'error', message: e.message };
  }
}

// Pre-insert dedup: which of these ad_ids already exist in gdn_ad. Accepts a single `ad_id` or an
// `ad_ids` array (batched, capped at 500). Returns the subset that exist + a convenience `exists` flag.
async function adExists(req, db, log) {
  const sql = db && db.sql;
  if (!sql) return { code: 503, status: 'error', message: 'Database connection is not available.' };
  const b = req.body || {};
  const ids = Array.isArray(b.ad_ids) ? b.ad_ids : (b.ad_id != null ? [b.ad_id] : []);
  const clean = ids.map((x) => String(x)).filter(Boolean).slice(0, 500);
  if (!clean.length) return { code: 400, status: 'rejected', message: 'Provide `ad_id` or `ad_ids`.' };
  try {
    const placeholders = clean.map(() => '?').join(',');
    const rows = await sql.query(`SELECT ad_id FROM gdn_ad WHERE ad_id IN (${placeholders})`, clean);
    const existing = rows.map((r) => String(r.ad_id));
    return { code: 200, status: 'ok', data: { existing, exists: existing.length > 0 } };
  } catch (e) {
    if (log && log.warn) log.warn('adExists failed', { error: e.message });
    return { code: 500, status: 'error', message: e.message };
  }
}

function createGdnCrawlerOpsRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('gdn'), insertionAuth];

  router.post('/insertion/crawlQuality', ...guard, asyncHandler(async (req, res) => {
    const r = await recordCrawlQuality('gdn_crawl_quality', req, service.db, service.log);
    return res.status(httpStatus(r.code)).json(r);
  }));

  router.post('/insertion/proxyHealth', ...guard, asyncHandler(async (req, res) => {
    const r = await recordProxyHealth(req, service.db, service.log);
    return res.status(httpStatus(r.code)).json(r);
  }));

  router.post('/insertion/adExists', ...guard, asyncHandler(async (req, res) => {
    const r = await adExists(req, service.db, service.log);
    return res.status(httpStatus(r.code)).json(r);
  }));

  return router;
}

module.exports = createGdnCrawlerOpsRoutes;

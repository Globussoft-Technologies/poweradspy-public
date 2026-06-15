'use strict';

/**
 * Crawl-quality recorder — shared by the GDN + Native insertion routes.
 *
 * Rolling state per (url_hash, system_id) in `<platform>_crawl_quality`: tracks ad yield per crawled
 * URL *including zero-ad pages*, a consecutive-empty `zero_streak`, and a `status`
 * (ok | zero | blocked | error) so dead URLs can be pruned and high-yield sites prioritised over time.
 *
 * Additive — does NOT touch the ad-insertion path. Deployed to:
 *   src/services/insertion/helpers/crawlQuality.js
 * and wired into gdnInsertionRoutes.js / nativeInsertionRoutes.js as
 *   POST /api/v1/{gdn,native}/insertion/crawlQuality   (insertionAuth-guarded)
 *
 * Body: a single record { url, target_site, system_id, country, provider, gdn_ads, native_ads,
 * status, http_status, crawled_at } OR { records: [ ... ] } for a batch.
 */

const crypto = require('crypto');

const sha1  = (s) => crypto.createHash('sha1').update(String(s || '')).digest('hex');
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const VALID_STATUS = new Set(['ok', 'zero', 'blocked', 'error']);
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Classify a URL by its cumulative ad mix (2:1 dominance threshold) -> 'gdn' | 'native' | 'mixed' | 'none'.
function adMix(totalGdn, totalNative) {
  if (totalGdn + totalNative === 0) return 'none';
  if (totalNative >= 2 * totalGdn) return 'native';
  if (totalGdn >= 2 * totalNative) return 'gdn';
  return 'mixed';
}

function normRecord(r) {
  const url = String(r.url || r.placement_url || '').slice(0, 2048);
  if (!url) return null;
  const gdn   = toInt(r.gdn_ads);
  const nat   = toInt(r.native_ads);
  const total = (r.total_ads != null) ? toInt(r.total_ads) : gdn + nat;
  let status = String(r.status || '').toLowerCase();
  if (!VALID_STATUS.has(status)) status = total > 0 ? 'ok' : 'zero';
  const crawledAt = (typeof r.crawled_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.crawled_at))
    ? r.crawled_at.slice(0, 19).replace('T', ' ')
    : nowStr();
  return {
    url_hash: sha1(url),
    url,
    target_site: (r.target_site || '').slice(0, 255) || null,
    system_id: (r.system_id || '').slice(0, 64),
    country: (r.country || '').slice(0, 8) || null,
    provider: (r.provider || '').slice(0, 64) || null,
    os: (r.os || '').slice(0, 16) || null,        // 'Windows' | 'Linux' — which machine ran the crawl
    host: (r.host || '').slice(0, 64) || null,
    gdn, nat, total, status,
    http_status: (r.http_status != null) ? toInt(r.http_status) : null,
    crawledAt,
  };
}

const upsertSql = (tbl) => `
INSERT INTO ${tbl}
  (url_hash, url, target_site, system_id, country, provider, os, host,
   last_gdn_ads, last_native_ads, last_total_ads, total_crawls, total_ads,
   total_gdn_ads, total_native_ads, ad_mix,
   zero_streak, status, http_status, last_ad_at, first_crawled, last_crawled)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  url              = VALUES(url),
  target_site      = VALUES(target_site),
  country          = VALUES(country),
  provider         = VALUES(provider),
  os               = VALUES(os),
  host             = VALUES(host),
  last_gdn_ads     = VALUES(last_gdn_ads),
  last_native_ads  = VALUES(last_native_ads),
  last_total_ads   = VALUES(last_total_ads),
  total_crawls     = total_crawls + 1,
  total_ads        = total_ads + VALUES(last_total_ads),
  total_gdn_ads    = total_gdn_ads + VALUES(last_gdn_ads),
  total_native_ads = total_native_ads + VALUES(last_native_ads),
  ad_mix           = CASE
                       WHEN (total_gdn_ads + total_native_ads) = 0 THEN 'none'
                       WHEN total_native_ads >= 2 * total_gdn_ads THEN 'native'
                       WHEN total_gdn_ads >= 2 * total_native_ads THEN 'gdn'
                       ELSE 'mixed' END,
  zero_streak      = IF(VALUES(last_total_ads) > 0, 0, zero_streak + 1),
  status           = VALUES(status),
  http_status      = VALUES(http_status),
  last_ad_at       = IF(VALUES(last_total_ads) > 0, VALUES(last_crawled), last_ad_at),
  last_crawled     = VALUES(last_crawled)`;

/**
 * @param {string} tbl  e.g. 'gdn_crawl_quality' | 'native_crawl_quality'
 */
async function recordCrawlQuality(tbl, req, db, log) {
  const sql = db && db.sql;
  if (!sql) return { code: 503, status: 'error', message: 'Database connection is not available.' };

  const body = req.body || {};
  const list = Array.isArray(body.records) ? body.records : (body.url ? [body] : []);
  if (!list.length) {
    return { code: 400, status: 'rejected', message: 'Provide a `url` (single) or a `records` array.' };
  }

  let processed = 0, skipped = 0;
  for (const raw of list) {
    const r = normRecord(raw);
    if (!r) { skipped++; continue; }
    const zeroStreakInit = r.total > 0 ? 0 : 1;
    const lastAdAt       = r.total > 0 ? r.crawledAt : null;
    try {
      await sql.query(upsertSql(tbl), [
        r.url_hash, r.url, r.target_site, r.system_id, r.country, r.provider, r.os, r.host,
        r.gdn, r.nat, r.total,                       // last_gdn_ads, last_native_ads, last_total_ads
        r.total, r.gdn, r.nat, adMix(r.gdn, r.nat),  // total_ads, total_gdn_ads, total_native_ads, ad_mix
        zeroStreakInit, r.status, r.http_status,
        lastAdAt, r.crawledAt, r.crawledAt,
      ]);
      processed++;
    } catch (e) {
      skipped++;
      if (log && log.warn) log.warn('crawlQuality upsert failed', { table: tbl, url: r.url, error: e.message });
    }
  }
  return { code: 200, status: 'ok', message: 'Crawl quality recorded', data: { processed, skipped } };
}

module.exports = { recordCrawlQuality };

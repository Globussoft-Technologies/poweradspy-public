'use strict';

/**
 * GDN crawl-quality ANALYTICS read API — NEW, additive, READ-ONLY.
 *
 * Exposes gdn_crawl_quality so analysis/debugging queries go through the API instead of a direct
 * MySQL connection (prod has no direct DB access, so all reads must be API-based). Auto-mounted by
 * ServiceRegistry under /api/v1/gdn.
 *
 *   GET /api/v1/gdn/crawl-quality/zero-urls   -> paginated persistent zero-ad URLs
 *        ?min_crawls=3 &country=se &limit=5000 &offset=0 &order=crawls|streak
 *   GET /api/v1/gdn/crawl-quality/summary     -> totals, zero-ad crawl-count buckets, per-country yield
 *        ?provider=decodo-isp   (optional filter)
 *   GET /api/v1/gdn/crawl-quality/domains     -> per-domain yield rollup (waste-ranked)
 *        ?min_crawls=10 &limit=200
 *
 * Read-only + unguarded (same convention as dashboard/landers GETs). Reads pasdev_gdn via service.db.sql.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
async function all(sql, q, p) { return (await sql.query(q, p || [])) || []; }
async function one(sql, q, p) { const r = await sql.query(q, p || []); return (r && r[0]) ? r[0] : {}; }

function createGdnCrawlQualityRoutes(service) {
  const router = Router();
  const g = () => service.db.sql;

  // ---- persistent zero-ad URLs (the dead set: total_ads=0, crawled >= min_crawls) ----
  router.get('/crawl-quality/zero-urls', asyncHandler(async (req, res) => {
    try {
      const minCrawls = Math.max(1, parseInt(req.query.min_crawls, 10) || 3);
      const country = (req.query.country || '').toString().slice(0, 8);
      const limit = Math.min(20000, Math.max(1, parseInt(req.query.limit, 10) || 5000));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const orderBy = req.query.order === 'streak' ? 'zero_streak' : 'total_crawls';

      const where = ['total_ads = 0', 'total_crawls >= ?'];
      const params = [minCrawls];
      if (country) { where.push('country = ?'); params.push(country); }
      const ws = where.join(' AND ');

      const total = num((await one(g(), `SELECT COUNT(*) c FROM gdn_crawl_quality WHERE ${ws}`, params)).c);
      const rows = await all(g(),
        'SELECT url, target_site, country, total_crawls, zero_streak, status, http_status, ' +
        `UNIX_TIMESTAMP(last_crawled) last_crawled FROM gdn_crawl_quality WHERE ${ws} ` +
        `ORDER BY ${orderBy} DESC LIMIT ${limit} OFFSET ${offset}`, params);

      return res.status(200).json({
        code: 200, status: 'ok', data: {
          total, count: rows.length, limit, offset,
          rows: rows.map((r) => ({
            url: r.url, target_site: r.target_site, country: r.country,
            total_crawls: num(r.total_crawls), zero_streak: num(r.zero_streak),
            status: r.status, http_status: r.http_status == null ? null : num(r.http_status),
            last_crawled: num(r.last_crawled),
          })),
        },
      });
    } catch (e) {
      if (service.log && service.log.error) service.log.error('crawl-quality/zero-urls failed', { error: e.message });
      return res.status(500).json({ code: 500, status: 'error', message: e.message });
    }
  }));

  // ---- summary: totals + zero-ad crawl-count buckets + per-country yield ----
  router.get('/crawl-quality/summary', asyncHandler(async (req, res) => {
    try {
      const sid = (req.query.provider || '').toString().slice(0, 64);
      const provWhere = sid ? 'WHERE provider = ?' : '';
      const provParams = sid ? [sid] : [];

      const tot = await one(g(),
        'SELECT COUNT(*) urls, SUM(total_ads=0) zero_urls, SUM(total_ads>0) yielding_urls, ' +
        `COALESCE(SUM(total_crawls),0) crawls, COALESCE(SUM(total_ads),0) ads FROM gdn_crawl_quality ${provWhere}`,
        provParams);

      const buckets = await all(g(),
        "SELECT CASE WHEN total_crawls>=10 THEN '10+' WHEN total_crawls>=5 THEN '5-9' " +
        "WHEN total_crawls>=3 THEN '3-4' WHEN total_crawls=2 THEN '2' ELSE '1' END bucket, " +
        'COUNT(*) urls, COALESCE(SUM(total_crawls),0) wasted_crawls FROM gdn_crawl_quality ' +
        `WHERE total_ads=0 ${sid ? 'AND provider=?' : ''} GROUP BY bucket ORDER BY MIN(total_crawls) DESC`,
        provParams);

      const byCountry = await all(g(),
        'SELECT country, COUNT(*) urls, COALESCE(SUM(total_crawls),0) crawls, COALESCE(SUM(total_ads),0) ads, ' +
        `SUM(total_ads=0) zero_urls FROM gdn_crawl_quality ${provWhere} GROUP BY country ORDER BY crawls DESC`,
        provParams);

      return res.status(200).json({
        code: 200, status: 'ok', data: {
          totals: {
            urls: num(tot.urls), zero_urls: num(tot.zero_urls), yielding_urls: num(tot.yielding_urls),
            crawls: num(tot.crawls), ads: num(tot.ads),
          },
          zero_buckets: buckets.map((b) => ({ bucket: b.bucket, urls: num(b.urls), wasted_crawls: num(b.wasted_crawls) })),
          by_country: byCountry.map((r) => ({
            country: r.country, urls: num(r.urls), crawls: num(r.crawls), ads: num(r.ads), zero_urls: num(r.zero_urls),
            ads_per_crawl: num(r.crawls) ? +(num(r.ads) / num(r.crawls)).toFixed(3) : 0,
          })),
        },
      });
    } catch (e) {
      if (service.log && service.log.error) service.log.error('crawl-quality/summary failed', { error: e.message });
      return res.status(500).json({ code: 500, status: 'error', message: e.message });
    }
  }));

  // ---- per-domain yield rollup, ranked by wasted crawls (crawls - ads) ----
  router.get('/crawl-quality/domains', asyncHandler(async (req, res) => {
    try {
      const minCrawls = Math.max(1, parseInt(req.query.min_crawls, 10) || 10);
      const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 200));
      const rows = await all(g(),
        'SELECT host, COUNT(*) urls, SUM(yields) yielding_urls, SUM(c) crawls, SUM(a) ads FROM (' +
        "SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(url,'/',3),'//',-1) host, " +
        'total_crawls c, total_ads a, (total_ads>0) yields FROM gdn_crawl_quality) t ' +
        `GROUP BY host HAVING SUM(c) >= ? ORDER BY (SUM(c) - SUM(a)) DESC LIMIT ${limit}`, [minCrawls]);
      return res.status(200).json({
        code: 200, status: 'ok', data: {
          rows: rows.map((r) => ({
            host: r.host, urls: num(r.urls), yielding_urls: num(r.yielding_urls),
            crawls: num(r.crawls), ads: num(r.ads),
            yield_rate: num(r.urls) ? +(num(r.yielding_urls) / num(r.urls)).toFixed(3) : 0,
          })),
        },
      });
    } catch (e) {
      if (service.log && service.log.error) service.log.error('crawl-quality/domains failed', { error: e.message });
      return res.status(500).json({ code: 500, status: 'error', message: e.message });
    }
  }));

  return router;
}

module.exports = createGdnCrawlQualityRoutes;

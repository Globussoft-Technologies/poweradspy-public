'use strict';

/**
 * GDN/Native Scraping-Benchmark dashboard READ API — NEW, additive. Serves every number the dashboard
 * needs so dashboard.py (and any UI) reads via API instead of querying staging MySQL directly.
 * Auto-mounted by ServiceRegistry under /api/v1/gdn.
 *
 *   GET /api/v1/gdn/dashboard/live      -> live session payload (the /api/live feed)
 *   GET /api/v1/gdn/dashboard/overview  -> full overview payload (totals, providers, machines, split,
 *                                          networks, countries, sites, advertisers, proxy countries,
 *                                          0-ad URLs, throughput, proxy quality)
 *
 * Read-only + unguarded (same convention as the landers GET). Query params:
 *   system_id    (default 'decodo-isp')  - provider / system_id filter for "our crawl"
 *   session_secs (default 10800)         - rolling session window (3h)
 *   limit        (default 100)           - live feed rows
 *
 * Reads pasdev_gdn via service.db.sql and pasdev_native via DatabaseManager.getSQL('native'); the merge /
 * derivation logic that used to live in dashboard.py now lives here (BE owns all DB access + business logic).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const databaseManager = require('../../../database/DatabaseManager');

// Single-row JSON store for the hourly crawl-box health snapshot (posted by ops/fleet_audit/crawl_watch.py,
// read publicly by an external Telegram bot / dashboard). A DB row — not a file — so it's shared across the
// pm2 cluster workers and survives restarts. Created lazily on first POST.
const CRAWL_HEALTH_DDL = `CREATE TABLE IF NOT EXISTS gdn_crawl_health (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  payload LONGTEXT NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
// `updated: null` present so a consumer can ALWAYS branch on / staleness-check the field (a fresh snapshot
// carries a real ISO timestamp; the empty/error sentinels carry null — never undefined).
const CRAWL_HEALTH_EMPTY = { updated: null, overall: 'unknown', text: 'no crawl health reported yet', counts: {}, boxes: [], issues: [], muted_hosts: [] };
const CRAWL_HEALTH_KEYS = ['updated', 'overall', 'counts', 'text', 'boxes', 'issues', 'muted_hosts'];  // whitelist — drop anything else
const CRAWL_HEALTH_MAX = 32 * 1024;                    // reject payloads bigger than the snapshot could legitimately be
const CRAWL_HEALTH_KEY = process.env.CRAWL_HEALTH_KEY || '';   // optional shared secret on top of insertionAuth
let crawlHealthEnsured = false;                        // run the CREATE TABLE at most once per worker, not per POST

const httpStatus = (code) => (code === 200 ? 200 : code);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function one(sql, q, params) { const r = await sql.query(q, params || []); return (r && r[0]) ? r[0] : {}; }
async function all(sql, q, params) { return (await sql.query(q, params || [])) || []; }

// ---------------- LIVE ----------------
async function buildLive(g, n, sid, sessionSecs, limit) {
  const a = await one(g,
    'SELECT COUNT(*) done, COUNT(DISTINCT host) hosts, MAX(UNIX_TIMESTAMP(last_crawled)) last_ts, ' +
    'MIN(UNIX_TIMESTAMP(last_crawled)) start_ts ' +
    'FROM gdn_crawl_quality WHERE last_crawled > (NOW() - INTERVAL ? SECOND) AND provider=?', [sessionSecs, sid]);
  const ccsRows = await all(g,
    "SELECT DISTINCT country FROM gdn_crawl_quality WHERE last_crawled > (NOW() - INTERVAL ? SECOND) " +
    "AND provider=? AND country<>'' ORDER BY country", [sessionSecs, sid]);
  const ccs = ccsRows.map((r) => r.country);
  let pool = 0;
  if (ccs.length) {
    const ph = ccs.map(() => '?').join(',');
    pool = num((await one(g,
      `SELECT COUNT(DISTINCT url) c FROM gdn_crawl_quality WHERE provider=? AND country IN (${ph})`,
      [sid, ...ccs])).c);
  }
  const obs = await one(g,
    'SELECT COALESCE(SUM(total_gdn_ads),0) g, COALESCE(SUM(total_native_ads),0) n ' +
    'FROM gdn_crawl_quality WHERE provider=?', [sid]);
  const gnew = num((await one(g, 'SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1', [sid])).c);
  const nnew = num((await one(n, 'SELECT COUNT(*) c FROM native_account_activities WHERE system_id=? AND is_unique=1', [sid])).c);
  const gObs = num(obs.g), nObs = num(obs.n);
  const lastTs = a.last_ts != null ? num(a.last_ts) : null;
  const running = !!(lastTs && (Date.now() / 1000 - lastTs) < 120);
  const done = num(a.done);
  const startTs = a.start_ts != null ? num(a.start_ts) : null;
  const live = {
    status: running ? 'running' : 'idle',
    country: ccs.join(',') || '—',
    mode: `${num(a.hosts)} machine(s) · session = last 3h`,
    done: pool ? Math.min(done, pool) : done, pool, last_ts: lastTs,
    start_ts: startTs,                                  // when the current crawl session started
    run_secs: (startTs && lastTs) ? Math.max(0, lastTs - startTs) : 0,  // span first->last crawl
    gdn_ads: Math.max(gObs, gnew), gdn_new: gnew,
    native_ads: Math.max(nObs, nnew), native_new: nnew,
  };
  const lim = parseInt(limit, 10) || 100;
  const pagesRaw = await all(g,
    'SELECT UNIX_TIMESTAMP(last_crawled) ts, target_site site, url, country cc, os, ' +
    "COALESCE(host,'') host, " +
    'last_gdn_ads n_gdn, last_native_ads n_native, last_total_ads n_total, status ' +
    `FROM gdn_crawl_quality ORDER BY last_crawled DESC LIMIT ${lim}`);
  const pages = pagesRaw.map((p) => ({
    ts: num(p.ts), site: p.site, url: p.url, cc: p.cc, os: p.os, host: p.host,
    n_gdn: p.n_gdn == null ? null : num(p.n_gdn),
    n_native: p.n_native == null ? null : num(p.n_native),
    n_total: p.n_total == null ? null : num(p.n_total), status: p.status,
  }));
  // Native is LIVE on v2: getSQL('native') -> nativepro_v2 keep-set (4.1M, fast — no longer the 48.8M table).
  const creatives = num((await one(g, 'SELECT COUNT(*) c FROM gdn_ad')).c);
  const runs = num((await one(g, 'SELECT COALESCE(SUM(total_crawls),0) c FROM gdn_crawl_quality')).c);
  const ah = num((await one(g, 'SELECT COUNT(*) c FROM gdn_ad WHERE created_date > (NOW()-INTERVAL 1 HOUR)')).c);
  const nh = num((await one(n, 'SELECT COUNT(*) c FROM native_ad WHERE created_date > (NOW()-INTERVAL 1 HOUR)')).c);
  // NEW ADS inserted in the last 24h, per network -- the 24h companion of gdn_hr/native_hr (new ads
  // actually inserted, i.e. gdn_ad/native_ad.created_date; NOT the "fresh unique" account_activities metric).
  const gAds24 = num((await one(g, 'SELECT COUNT(*) c FROM gdn_ad WHERE created_date > (NOW()-INTERVAL 24 HOUR)')).c);
  const nAds24 = num((await one(n, 'SELECT COUNT(*) c FROM native_ad WHERE created_date > (NOW()-INTERVAL 24 HOUR)')).c);
  // Per-country crawl breakdown for THIS session, so the dashboard can show the multi-country spread.
  const byCcRows = await all(g,
    "SELECT country cc, COUNT(*) urls, COALESCE(SUM(last_gdn_ads),0) gdn, COALESCE(SUM(last_native_ads),0) nat " +
    "FROM gdn_crawl_quality WHERE last_crawled > (NOW() - INTERVAL ? SECOND) AND provider=? AND country<>'' " +
    "GROUP BY country ORDER BY urls DESC", [sessionSecs, sid]);
  const byCountry = byCcRows.map((r) => ({ cc: r.cc, urls: num(r.urls), gdn: num(r.gdn), nat: num(r.nat) }));
  const todayNew = num((await one(g,
    'SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=CURDATE()', [sid])).c);
  const act = await all(g,
    "SELECT COALESCE(host,'?') host, COALESCE(os,'?') os, COUNT(*) c FROM gdn_crawl_quality " +
    'WHERE last_crawled > (NOW()-INTERVAL 50 SECOND) AND provider=? GROUP BY host, os', [sid]);
  const fleet = act.length
    ? { text: act.map((r) => `${r.host} [${r.os}] ~${num(r.c)} profiles crawling`).join(' · ') }
    : null;
  const profiles = num((await one(g,
    'SELECT COUNT(*) c FROM gdn_crawl_quality WHERE last_crawled > (NOW()-INTERVAL 45 SECOND) AND provider=?', [sid])).c);
  return { live, pages, db: { creatives, runs }, ads_hr: ah + nh, gdn_hr: ah, native_hr: nh,
    gdn_24h: gAds24, native_24h: nAds24, by_country: byCountry, today_new: todayNew, fleet, profiles };
}

// ---------------- OVERVIEW ----------------
async function buildOverview(g, n, sid) {
  // totals
  const gtot = num((await one(g, 'SELECT COUNT(*) c FROM gdn_ad')).c);
  const ntot = num((await one(n, 'SELECT COUNT(*) c FROM native_ad')).c); // native live on v2 (nativepro_v2.native_ad)
  const ah24 = num((await one(g, 'SELECT COUNT(*) c FROM gdn_ad WHERE created_date>=NOW()-INTERVAL 24 HOUR')).c);
  const cq = await one(g, 'SELECT COUNT(*) urls, COUNT(DISTINCT country) ccs, COALESCE(SUM(total_ads),0) ads FROM gdn_crawl_quality');
  // distinct advertisers actually present in the live keep-set (NOT COUNT(*) of the
  // gdn_ad_post_owners dimension — that table was copied in full at migration and is
  // ~95% orphan rows, which over-counted advertisers ~20x).
  const nadv = num((await one(g, "SELECT COUNT(DISTINCT post_owner_id) c FROM gdn_ad WHERE post_owner_id IS NOT NULL")).c);
  // URLs crawled in the last 24h, split by what they yielded (a URL can yield both, so gdn+native may
  // exceed total). Filtered to our crawl (provider=sid). total = distinct URLs touched in the window.
  const u24 = await one(g,
    'SELECT COUNT(*) total, COALESCE(SUM(last_gdn_ads>0),0) gdn, COALESCE(SUM(last_native_ads>0),0) native ' +
    'FROM gdn_crawl_quality WHERE last_crawled >= NOW()-INTERVAL 24 HOUR AND provider=?', [sid]);
  const urls24h = { total: num(u24.total), gdn: num(u24.gdn), native: num(u24.native) };

  // provider comparison: merge live (gdn_crawl_quality) + historical (page_visits) + runs country fallback
  const live = await all(g,
    "SELECT COALESCE(provider,'?') provider, COUNT(*) urls, COUNT(DISTINCT country) countries, " +
    'COALESCE(SUM(total_gdn_ads),0) gdn, COALESCE(SUM(total_native_ads),0) native, ' +
    "SUM(status='zero' OR last_total_ads=0) zero_urls, MAX(UNIX_TIMESTAMP(last_crawled)) last_ts " +
    'FROM gdn_crawl_quality GROUP BY provider');
  let hist = [];
  try {
    hist = await all(g,
      "SELECT COALESCE(provider,'?') provider, COUNT(*) urls, 0 countries, " +
      'COALESCE(SUM(n_gdn),0) gdn, COALESCE(SUM(n_native),0) native, ' +
      'SUM(COALESCE(n_ads,0)=0) zero_urls, MAX(ts) last_ts FROM page_visits GROUP BY provider');
  } catch (e) { hist = []; }
  let runsCc = {};
  try {
    const rc = await all(g, "SELECT COALESCE(provider,'?') provider, COUNT(DISTINCT proxy_country) c FROM runs GROUP BY provider");
    rc.forEach((r) => { runsCc[r.provider] = num(r.c); });
  } catch (e) { runsCc = {}; }
  const merged = {};
  [...hist, ...live].forEach((r) => {
    const p = r.provider;
    const m = merged[p] || (merged[p] = { provider: p, urls: 0, countries: 0, gdn: 0, native: 0, zero_urls: 0, last_ts: 0 });
    m.urls += num(r.urls); m.gdn += num(r.gdn); m.native += num(r.native);
    m.zero_urls += num(r.zero_urls); m.last_ts = Math.max(m.last_ts, num(r.last_ts));
    m.countries = Math.max(m.countries, num(r.countries));
  });
  Object.values(merged).forEach((m) => { if (!m.countries) m.countries = runsCc[m.provider] || 0; });
  const providers = Object.values(merged).sort((x, y) => y.gdn - x.gdn);

  // machine benchmark
  const machinesRaw = await all(g,
    "SELECT COALESCE(host,'?') host, COALESCE(os,'?') os, COUNT(*) urls, COALESCE(SUM(total_gdn_ads),0) gdn, " +
    'COALESCE(SUM(total_native_ads),0) native, SUM(last_total_ads>0) hit ' +
    'FROM gdn_crawl_quality WHERE provider=? GROUP BY host, os ORDER BY gdn DESC', [sid]);
  const machines = machinesRaw.map((m) => ({
    host: m.host, os: m.os, urls: num(m.urls), gdn: num(m.gdn), native: num(m.native), hit: num(m.hit),
  }));

  // GDN vs Native split
  const obs = await one(g, 'SELECT COALESCE(SUM(total_gdn_ads),0) g, COALESCE(SUM(total_native_ads),0) n FROM gdn_crawl_quality WHERE provider=?', [sid]);
  const gNew = num((await one(g, 'SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1', [sid])).c);
  const nNew = num((await one(n, 'SELECT COUNT(*) c FROM native_account_activities WHERE system_id=? AND is_unique=1', [sid])).c);
  const split = { g_obs: num(obs.g), n_obs: num(obs.n), g_new: gNew, n_new: nNew };

  // native by network (live on v2): Taboola / Outbrain / Revcontent / …
  const networks = (await all(n,
    "SELECT nw.network, COUNT(*) c FROM native_ad a JOIN networks nw ON a.network_id=nw.id " +
    "GROUP BY nw.network ORDER BY c DESC LIMIT 10")).map((r) => ({ network: r.network, creatives: num(r.c) }));

  // by country / site / advertisers
  const byc = await all(g,
    "SELECT country, COUNT(*) urls, COALESCE(SUM(total_gdn_ads),0) gdn, COALESCE(SUM(total_native_ads),0) nat " +
    "FROM gdn_crawl_quality WHERE country<>'' GROUP BY country ORDER BY gdn DESC");
  const countries = byc.map((r) => ({ country: r.country, urls: num(r.urls), gdn: num(r.gdn), nat: num(r.nat) }));
  const bys = await all(g,
    "SELECT target_site site, COUNT(*) urls, COALESCE(SUM(total_ads),0) ads FROM gdn_crawl_quality " +
    "WHERE target_site<>'' GROUP BY target_site ORDER BY ads DESC LIMIT 25");
  const sites = bys.map((r) => ({ site: r.site, urls: num(r.urls), ads: num(r.ads) }));
  const adv = await all(g, "SELECT post_owner_name, ads_count FROM gdn_ad_post_owners WHERE post_owner_name<>'' ORDER BY ads_count DESC LIMIT 25");
  const advertisers = adv.map((r) => ({ post_owner_name: r.post_owner_name, ads_count: num(r.ads_count) }));

  // proxy countries
  let proxyCountries = [];
  try {
    const pc = await all(g, 'SELECT cc, name, supported FROM proxy_countries ORDER BY cc');
    proxyCountries = pc.map((r) => ({ cc: r.cc, name: r.name, supported: num(r.supported) }));
  } catch (e) { proxyCountries = []; }

  // 0-ad URLs
  const zuRaw = await all(g,
    'SELECT url, target_site site, country, os, UNIX_TIMESTAMP(last_crawled) ts, zero_streak ' +
    "FROM gdn_crawl_quality WHERE status='zero' OR last_total_ads=0 ORDER BY last_crawled DESC LIMIT 40");
  const zeroUrls = {
    rows: zuRaw.map((r) => ({ url: r.url, site: r.site, country: r.country, os: r.os, ts: num(r.ts), zero_streak: num(r.zero_streak) })),
    count: num((await one(g, "SELECT COUNT(*) c FROM gdn_crawl_quality WHERE status='zero' OR last_total_ads=0")).c),
  };

  // throughput
  const throughput = {
    fg_hr: num((await one(g, 'SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=NOW()-INTERVAL 1 HOUR', [sid])).c),
    fn_hr: num((await one(n, 'SELECT COUNT(*) c FROM native_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=NOW()-INTERVAL 1 HOUR', [sid])).c),
    fg_day: num((await one(g, 'SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=CURDATE()', [sid])).c),
    fn_day: num((await one(n, 'SELECT COUNT(*) c FROM native_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=CURDATE()', [sid])).c),
  };

  // proxy quality (per-IP ad yield)
  let proxyQuality = { rows: [], totals: {} };
  try {
    const ph = await all(g,
      'SELECT country, COUNT(*) ips, COALESCE(SUM(urls_crawled>0),0) used, ' +
      'COALESCE(SUM(ads_total),0) ads, COALESCE(SUM(urls_crawled),0) urls ' +
      'FROM proxy_health GROUP BY country ORDER BY ads DESC, ips DESC');
    const pqt = await one(g,
      'SELECT COUNT(*) ips, COALESCE(SUM(ads_total),0) ads, COALESCE(SUM(urls_crawled),0) urls, ' +
      'COALESCE(SUM(urls_crawled>0),0) used FROM proxy_health');
    proxyQuality = {
      rows: ph.map((r) => ({ country: r.country, ips: num(r.ips), used: num(r.used), ads: num(r.ads), urls: num(r.urls) })),
      totals: { ips: num(pqt.ips), ads: num(pqt.ads), urls: num(pqt.urls), used: num(pqt.used) },
    };
  } catch (e) { proxyQuality = { rows: [], totals: {} }; }

  return {
    totals: { gtot, ntot, ah24, urls: num(cq.urls), ccs: num(cq.ccs), total_ads: num(cq.ads), advertisers: nadv },
    urls_24h: urls24h,
    providers, machines, split, networks, countries, sites, advertisers,
    proxy_countries: proxyCountries, zero_urls: zeroUrls, throughput, proxy_quality: proxyQuality,
  };
}

function createGdnDashboardRoutes(service) {
  const router = Router();
  const nativeSql = () => databaseManager.getSQL('native');

  router.get('/dashboard/live', asyncHandler(async (req, res) => {
    const sid = (req.query.system_id || 'decodo-isp').toString();
    const sessionSecs = parseInt(req.query.session_secs, 10) || 10800;
    const limit = parseInt(req.query.limit, 10) || 100;
    try {
      const data = await buildLive(service.db.sql, nativeSql(), sid, sessionSecs, limit);
      return res.status(200).json({ code: 200, status: 'ok', data });
    } catch (e) {
      if (service.log && service.log.error) service.log.error('dashboard/live failed', { error: e.message });
      return res.status(500).json({ code: 500, status: 'error', message: e.message });
    }
  }));

  router.get('/dashboard/overview', asyncHandler(async (req, res) => {
    const sid = (req.query.system_id || 'decodo-isp').toString();
    try {
      const data = await buildOverview(service.db.sql, nativeSql(), sid);
      return res.status(200).json({ code: 200, status: 'ok', data });
    } catch (e) {
      if (service.log && service.log.error) service.log.error('dashboard/overview failed', { error: e.message });
      return res.status(500).json({ code: 500, status: 'error', message: e.message });
    }
  }));

  // ---- crawl-box health snapshot (hourly monitor -> public feed) ----
  // WRITE: guarded by insertionAuth only (NOT insertionEnabled — health monitoring must keep working even
  // when insertion is disabled for a network). The ops host posts its crawl_health.json here each hour with
  // "platform":"12". GET is public + unwrapped (returns the snapshot as-is) so a bot can poll it directly.
  router.post('/dashboard/crawl-health', insertionAuth, asyncHandler(async (req, res) => {
    // Optional shared secret on TOP of insertionAuth. platform:12 is a public bypass, and this row feeds a
    // human-facing alert channel — so if CRAWL_HEALTH_KEY is configured, also require the matching header
    // (only the ops host knows it), which stops anyone from spoofing/masking the feed.
    if (CRAWL_HEALTH_KEY && req.get('x-crawl-health-key') !== CRAWL_HEALTH_KEY) {
      return res.status(401).json({ code: 401, status: 'unauthorized', message: 'bad or missing crawl-health key' });
    }
    const sql = service.db && service.db.sql;
    if (!sql) return res.status(503).json({ code: 503, status: 'error', message: 'Database connection is not available.' });
    const body = req.body || {};
    const health = {};                                  // whitelist known keys only (drops platform + anything unexpected)
    for (const k of CRAWL_HEALTH_KEYS) if (body[k] !== undefined) health[k] = body[k];
    if (!health.updated) {
      return res.status(400).json({ code: 400, status: 'rejected', message: 'Expected a health JSON body with an `updated` field.' });
    }
    const payload = JSON.stringify(health);
    if (payload.length > CRAWL_HEALTH_MAX) {            // a real snapshot is a few KB; anything larger is abuse
      return res.status(413).json({ code: 413, status: 'rejected', message: 'payload too large' });
    }
    try {
      if (!crawlHealthEnsured) { await sql.query(CRAWL_HEALTH_DDL); crawlHealthEnsured = true; }
      await sql.query(
        'INSERT INTO gdn_crawl_health (id, payload, updated_at) VALUES (1, ?, NOW()) ' +
        'ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = NOW()',
        [payload]);
      return res.status(200).json({ code: 200, status: 'ok', message: 'crawl health recorded' });
    } catch (e) {
      crawlHealthEnsured = false;                       // re-attempt the DDL next time (in case the table was the cause)
      if (service.log && service.log.warn) service.log.warn('crawl-health write failed', { error: e.message });
      return res.status(500).json({ code: 500, status: 'error', message: e.message });
    }
  }));

  router.get('/dashboard/crawl-health', asyncHandler(async (req, res) => {
    const sql = service.db && service.db.sql;
    res.set('Cache-Control', 'no-store');
    if (!sql) return res.status(503).json({ ...CRAWL_HEALTH_EMPTY, error: 'db unavailable' });
    try {
      const rows = await sql.query('SELECT payload FROM gdn_crawl_health WHERE id = 1');
      if (!rows || !rows[0] || !rows[0].payload) return res.status(200).json(CRAWL_HEALTH_EMPTY);  // no data yet != failure
      return res.status(200).json(JSON.parse(rows[0].payload));
    } catch (e) {
      // pre-first-POST the table doesn't exist yet — that's "no data", not a backend failure → 200 empty.
      // Any other error IS a failure → 5xx so an uptime/health check can tell it apart from a fresh snapshot.
      if (/does\s*n.?t exist|no such table|ER_NO_SUCH_TABLE/i.test(e.message || '')) return res.status(200).json(CRAWL_HEALTH_EMPTY);
      return res.status(503).json({ ...CRAWL_HEALTH_EMPTY, error: 'crawl health unavailable' });
    }
  }));

  return router;
}

module.exports = createGdnDashboardRoutes;

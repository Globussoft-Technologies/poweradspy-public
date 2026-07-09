/**
 * System-Info Crawler Dashboard — NEW, additive, read-only.
 *
 * Powers the revamped (Grafana-style) System Info tab. Does NOT touch any
 * existing endpoint. One main endpoint:
 *
 *   POST /admin-panel/system-metrics/dashboard/overview
 *     body: { range:{from,to}, platform?:[ "10","12" ], activeWindowMin?:10 }
 *     returns fleet totals + per-network rollup + per-system rows
 *             (status / last-active / accounts / ads / unique / cpu / ram).
 *
 * Data: per-network `<net>_accounts_activities` (DB) + Prometheus heartbeat
 * (account_active_hb_total) bridged DB system_id <-> machine hostname via the
 * shared account_id (same pattern as src/system-metrics.js).
 *
 * Fail-safe by design: every network / Prometheus call is wrapped so one bad
 * source can never 500 the whole response — it just contributes nothing.
 */

require('dotenv').config();
const axios = require('axios');
const queryDatabase = require('../db-connections/connection');
const searchAllInstances = require('../es-connections/connection'); // ES (for YouTube benchmark)
const cache = require('../utils/cache');
const { adCountAcrossSelectedNetworks } = require('../utils/db-query-metrics');
// REUSE the EXACT same per-network config + query that Crawler Insight's
// /network-name/get-count (metric=range) uses, so Total/Unique match it exactly
// for every network. Source = MySQL <net>_ad main table:
//   Total (active)  = COUNT(id) WHERE last_seen  in [from 00:00, (to+1) 00:00)
//   Unique (new)    = COUNT(id) WHERE first_seen in the same window
//   GDN quirk: active bounds first_seen < to (matches DS).
const { DB_DATA: DYN_DB } = require('./dynamic-count-analytics');

// my network key -> dynamic-count key (only gtext differs -> "google")
const DYN_KEY = { facebook: 'facebook', instagram: 'instagram', gtext: 'google',
  youtube: 'youtube', native: 'native', gdn: 'gdn', reddit: 'reddit', quora: 'quora', linkedin: 'linkedin' };

function dynNextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// { total, unique } for a network+range — identical to /get-count.
//  - no platform filter  -> metric=range  (total=last_seen, unique=first_seen)
//  - platform selected   -> metric=platform (COUNT on platform table by `created`
//                           date + platform IN(...)) — matches the live curl.
async function dynCounts(net, range, platform) {
  const cfg = DYN_DB[DYN_KEY[net]];
  if (!cfg || !range?.from || !range?.to) return { total: null, unique: null };
  const win = [`${range.from} 00:00:00`, `${dynNextDay(range.to)} 00:00:00`];

  const plats = Array.isArray(platform) ? platform.map(Number).filter(Number.isInteger) : [];
  if (plats.length) {
    // metric=platform — platform lives on the main table for facebook, on
    // <net>_ad_meta_data for everyone else; counted by the `created` date.
    const table = cfg.platformOnMain ? cfg.main : cfg.meta;
    const inList = plats.map(() => '?').join(',');
    const sql = `SELECT COUNT(${cfg.platformCountCol}) AS cnt FROM ${table}
                 WHERE ${cfg.created} >= ? AND ${cfg.created} < ? AND platform IN (${inList})`;
    try {
      const r = await queryDatabase(cfg.db_id, cfg.index, sql, [...win, ...plats]);
      const c = Number(r?.[0]?.cnt || 0);
      return { total: c, unique: c, platformFiltered: true };
    } catch (e) {
      console.error(`dynCounts(platform) ${net} failed:`, e.message);
      return { total: null, unique: null };
    }
  }

  const newSql = `SELECT COUNT(id) AS cnt FROM ${cfg.main} WHERE ${cfg.firstSeen} >= ? AND ${cfg.firstSeen} < ?`;
  const activeSql = cfg.gdnQuirk
    ? `SELECT COUNT(id) AS cnt FROM ${cfg.main} WHERE last_seen >= ? AND ${cfg.firstSeen} < ?`
    : `SELECT COUNT(id) AS cnt FROM ${cfg.main} WHERE last_seen >= ? AND last_seen < ?`;
  try {
    const [n, a] = await Promise.all([
      queryDatabase(cfg.db_id, cfg.index, newSql, win),
      queryDatabase(cfg.db_id, cfg.index, activeSql, win),
    ]);
    return { total: Number(a?.[0]?.cnt || 0), unique: Number(n?.[0]?.cnt || 0) };
  } catch (e) {
    console.error(`dynCounts ${net} failed:`, e.message);
    return { total: null, unique: null };
  }
}

const mode = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
const PROM_BASE = process.env.PROMETHEUS_URL || '';
const SEND_METRICS_URL = process.env.SEND_METRICS_URL || '';

// Verified prod config (see docs/SYSTEM_DASHBOARD_MANIFEST.md + dump.json).
// hasAccount = network has real crawler accounts (else account_id is system-ish).
// acts = per-account/system activity log; created_at + is_unique + platform are uniform.
// `user` = how to resolve account name + country from the per-network users
// table (verified from utils/db-query-metrics.js DB_DATA). idCol matches
// activities.account_id. reddit has no display name → use the username.
const NETS = {
  facebook:  { db_id: 0, env: 'FB_DATABASE',       acts: 'facebook_accounts_activities',  hasAccount: true,
    user: { table: 'facebook_users',  idCol: 'facebook_id',     nameCol: 'name',             countryCol: 'current_country' } },
  youtube:   { db_id: 1, env: 'YT_DATABASE',       acts: 'youtube_accounts_activities',   hasAccount: false },
  linkedin:  { db_id: 2, env: 'LINKEDIN_DATABASE', acts: 'linkedin_account_activities',   hasAccount: true,
    user: { table: 'linkedin_users',  idCol: 'linkedin_id',     nameCol: 'name',             countryCol: 'current_country' } },
  native:    { db_id: 3, env: 'NATIVE_DATABASE',   acts: 'native_account_activities',     hasAccount: false },
  reddit:    { db_id: 4, env: 'REDDIT_DATABASE',   acts: 'reddit_accounts_activities',    hasAccount: true,
    user: { table: 'reddit_user',     idCol: 'reddit_username', nameCol: 'reddit_username',  countryCol: 'current_country' } },
  gdn:       { db_id: 5, env: 'GDN_DATABASE',      acts: 'gdn_account_activities',        hasAccount: false },
  quora:     { db_id: 7, env: 'QUORA_DATABASE',    acts: 'quora_accounts_activities',     hasAccount: true,
    user: { table: 'quora_user',      idCol: 'quora_id',        nameCol: 'name',             countryCol: 'current_country' } },
  instagram: { db_id: 8, env: 'INSTA_DATABASE',    acts: 'instagram_accounts_activities', hasAccount: true,
    user: { table: 'instagram_user',  idCol: 'instagram_id',    nameCol: 'name',             countryCol: 'country' } },
  gtext:     { db_id: 9, env: 'GT_DATABASE',       acts: 'google_account_activities',     hasAccount: false },
};
const NET_KEYS = Object.keys(NETS);

// ---- small helpers -------------------------------------------------------

async function instantQuery(promql, atUnix) {
  if (!PROM_BASE) return { data: { result: [] } };
  let url = `${PROM_BASE}/api/v1/query?query=${encodeURIComponent(promql)}`;
  if (atUnix) url += `&time=${atUnix}`;   // evaluate the query AT a past instant (for historical windows)
  const res = await axios.get(url, { timeout: 12000 });
  return res.data;
}

function pad(n) { return String(n).padStart(2, '0'); }
// Accepts "YYYY-MM-DD" (or Date) -> full-day SQL bounds.
function dayBounds(range) {
  const f = range?.from ? String(range.from).slice(0, 10) : null;
  const t = range?.to ? String(range.to).slice(0, 10) : null;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const fromDay = f || todayStr;
  const toDay = t || fromDay;
  return { fromSql: `${fromDay} 00:00:00`, toSql: `${toDay} 23:59:59`, fromDay, toDay };
}

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// ---- per-network DB rollup ----------------------------------------------

async function networkRollup(net, fromSql, toSql, platform) {
  const cfg = NETS[net];
  const dbName = process.env[cfg.env];
  if (!dbName) return { net, rows: [] };

  // YouTube systems live in youtube_ad.system_id (proxmox machines). Match the
  // network card EXACTLY, per system: ads = last_seen-in-window (the "total"
  // metric), unique = created_date-in-window (= /get-count's unique for youtube).
  // So per-system ads now SUM to the card (minus ads whose system_id is blank).
  if (net === 'youtube') {
    const sql = `SELECT system_id, 0 AS accounts, '' AS account_ids,
        SUM(last_seen BETWEEN ? AND ?) AS ads,
        SUM(created_date BETWEEN ? AND ?) AS unique_ads,
        MAX(last_seen) AS last_active
      FROM youtube_ad
      WHERE ((last_seen BETWEEN ? AND ?) OR (created_date BETWEEN ? AND ?))
        AND system_id IS NOT NULL AND system_id <> ''
      GROUP BY system_id`;
    const p = [fromSql, toSql, fromSql, toSql, fromSql, toSql, fromSql, toSql];
    const rows = await queryDatabase(cfg.db_id, dbName, sql, p);
    return { net, rows: rows || [] };
  }

  // GDN/Native systems = the proxmox MACHINES (gdn_crawl_quality.host), NOT the
  // activities table — there system_id is the ISP/proxy (e.g. "decodo-isp"), not
  // a system. Both gdn & native crawl data live in one table (gdnpro_v2.
  // gdn_crawl_quality). The ad tables have NO host column, so the dedup'd /get-
  // count number can't be split per host; we use last_*_ads (ads each machine
  // found on its LAST crawl, in the window) — a sane per-host figure. NOT the
  // dedup'd network total, so per-host will not sum to the card. last_crawled is
  // the activity timestamp. (total_*_ads was a LIFETIME counter → 500k+ nonsense.)
  if (net === 'gdn' || net === 'native') {
    const adCol = net === 'gdn' ? 'last_gdn_ads' : 'last_native_ads';
    const sql = `SELECT host AS system_id, 0 AS accounts, '' AS account_ids,
        COALESCE(SUM(${adCol}),0) AS ads, 0 AS unique_ads,
        COUNT(*) AS urls, MAX(last_crawled) AS last_active
      FROM gdn_crawl_quality
      WHERE last_crawled BETWEEN ? AND ? AND host IS NOT NULL AND host <> ''
      GROUP BY host`;
    const rows = await queryDatabase(5, process.env.GDN_DATABASE, sql, [fromSql, toSql]);
    return { net, rows: rows || [] };
  }

  // Account networks (fb/insta/linkedin/reddit/quora) + gtext: use the SAME
  // source Crawler Insight uses — the <net>_ad table joined to <net>_users
  // (adCountAcrossSelectedNetworks, required=null) — so systems + accounts MATCH
  // Crawler Insight exactly. The activities log was sparse and undercounted.
  const from = fromSql.slice(0, 10);
  const to = toSql.slice(0, 10);
  const plat = (Array.isArray(platform) && platform.length === 1) ? Number(platform[0]) : null;
  const adRows = await adCountAcrossSelectedNetworks({ from, to }, [net], null, plat).catch(() => []);
  const m = new Map();   // system_id -> { accounts:Set, ads }
  for (const r of (adRows || [])) {
    const sys = r?.system_name;
    if (!sys) continue;
    const acct = (r.account_id != null && r.account_id !== 'N/A') ? String(r.account_id) : null;
    let e = m.get(sys);
    if (!e) { e = { accounts: new Set(), ads: 0 }; m.set(sys, e); }
    if (acct) e.accounts.add(acct);
    e.ads += toNum(r.unqiue_ads);
  }
  const rows = [...m].map(([sys, e]) => ({
    system_id: sys, accounts: e.accounts.size, account_ids: [...e.accounts].join(','),
    ads: e.ads, unique_ads: 0, last_active: null,
  }));
  return { net, rows };
}

// CRITICAL — the metrics exporter restarts ~hourly, so the raw counters RESET
// and an INSTANT query only sees whatever reported since the last restart (a tiny
// fraction of the fleet). That is why the system/account count came out far below
// Crawler Insight. The fix: read `increase(metric[2d])`, which sums across resets,
// so EVERY machine/account active in the last 2 days is captured. Configurable via
// FLEET_WINDOW. These 2d-range reads are heavier, so they are cached (~5 min) — the
// fleet membership changes slowly, and it also keeps Prometheus load low.
const FLEET_WIN = process.env.FLEET_WINDOW || '24h';

// Per-account fleet series over the 2d window: [{ acct, host=system_id, net }].
// SOURCE = account_active_hb_total, whose server_name IS the system_id (PAS####)
// — NOT scroll_plugin_counter_total: scroll is so high-cardinality that
// increase(scroll[2d]) TIMES OUT on prod, while increase(account_active_hb_total
// [2d]) returns the full fleet in ~1s. increase[2d] also survives the ~hourly
// exporter restarts. Cached so the query runs once per few minutes.
async function scrollSeries() {
  const ck = `dash_fleetseries_${FLEET_WIN}`;
  const cached = cache.get(ck);
  if (cached) return cached;
  let rows = [];
  try {
    const pc = await instantQuery(`count by (account_id, server_name, network) (increase(account_active_hb_total{mode="${mode}"}[${FLEET_WIN}]))`);
    rows = (pc.data?.result || []).map((s) => ({
      acct: s.metric?.account_id != null ? String(s.metric.account_id) : '',
      host: s.metric?.server_name || '',
      net: (s.metric?.network || '').toLowerCase(),
    }));
  } catch (e) { console.error('dashboard scrollSeries failed:', e.message); }
  cache.set(ck, rows, 300);
  return rows;
}

// account_id -> system_id bridge (for hostname + heartbeat status).
async function buildAccountBridge(range) {
  const acctToSystem = new Map();
  const results = await Promise.all(
    NET_KEYS.map(nw => adCountAcrossSelectedNetworks(range, [nw], null, null).catch(() => []))
  );
  for (const rows of results) {
    for (const r of (rows || [])) {
      if (r?.system_name && r.account_id && r.account_id !== 'N/A') {
        acctToSystem.set(String(r.account_id), r.system_name);
      }
    }
  }
  return acctToSystem;
}

// account_id -> SYSTEM_ID from the heartbeat metric. CRITICAL: the two Prometheus
// metrics label the same machine differently — scroll_plugin_counter_total uses
// the machine HOSTNAME ("GBSBHL1201-PC") while account_active_hb_total uses the
// logical SYSTEM_ID ("PAS1201") — the same id the DB uses. The DB bridge only
// covers accounts active in the window, so most monitored accounts fell back to
// the hostname and the SAME machine got counted twice (PAS1201 + GBSBHL1201-PC),
// breaking the system count vs Crawler Insight. This bridge maps EVERY monitored
// account to its real system_id so the whole fleet collapses to clean system_ids.
async function buildHbBridge() {
  const ck = `dash_hbbridge_${FLEET_WIN}`;
  const cached = cache.get(ck);
  if (cached) return cached;
  const map = new Map();
  try {
    // increase[2d] — survive the hourly exporter restarts (see FLEET_WIN note).
    const r = await instantQuery(`count by (account_id, server_name) (increase(account_active_hb_total{mode="${mode}"}[${FLEET_WIN}]))`);
    for (const s of (r.data?.result || [])) {
      const acct = s.metric?.account_id != null ? String(s.metric.account_id) : '';
      const sys = s.metric?.server_name || '';
      if (acct && acct !== '-' && acct !== 'N/A' && sys && !map.has(acct)) map.set(acct, sys);
    }
  } catch (e) { console.error('dashboard buildHbBridge failed:', e.message); }
  cache.set(ck, map, 300);
  return map;
}

// The FULL FLEET of account-running machines — the same set Crawler Insight's
// "Total Systems" counts. DB activities only show systems that scraped in the
// window; many facebook/instagram machines have monitored accounts but no ads
// today. Those come from Prometheus (scroll_plugin_counter_total accounts),
// bridged to their system_id via account_id (fallback: the hostname). Only the
// account-based networks — crawl machines (gdn/native/youtube/gtext) are handled
// by their own rollups. Returns system_id -> { accounts:Set, networks:Set }.
async function buildFleet(acctToSystem) {
  const fleet = new Map();
  for (const { acct, host, net: network } of await scrollSeries()) {
    if (!network || ['youtube', 'gtext', 'gdn', 'native'].includes(network)) continue;
    const realAcct = acct && acct !== '-' && acct !== 'N/A';
    // A network-tagged series IS a real crawler machine — keep it even with a
    // blank account (e.g. Reddit's machine shows idle). Bridge the account to its
    // clean system_id; fall back to the hostname only when there is no bridge.
    const sys = (realAcct && acctToSystem.get(acct)) || host || null;
    if (!sys) continue;
    let f = fleet.get(sys);
    if (!f) { f = { accounts: new Set(), networks: new Set() }; fleet.set(sys, f); }
    if (realAcct) f.accounts.add(acct);
    f.networks.add(network);
  }
  return fleet;
}

// system_id -> [hostnames] via the (cached, 2d) scroll series + account bridge.
async function buildHostMap(acctToSystem) {
  const sysToHosts = {};
  try {
    for (const { acct, host } of await scrollSeries()) {
      const sys = acctToSystem.get(acct);
      if (!host || !sys) continue;
      (sysToHosts[sys] = sysToHosts[sys] || new Set()).add(host);
    }
  } catch (e) {
    console.error('dashboard buildHostMap failed:', e.message);
  }
  const out = {};
  for (const k of Object.keys(sysToHosts)) out[k] = [...sysToHosts[k]];
  return out;
}

// account_id -> { account_name, server_name } from Prometheus, for the drill's
// name display + wiring the existing account status-timeline (which filters by
// account_name + server_name).
async function buildAccountPromMap() {
  const ck = `dash_acctprommap_${FLEET_WIN}`;
  const cached = cache.get(ck);
  if (cached) return cached;
  const map = new Map();
  try {
    // increase[2d] so names resolve for the whole fleet, not just post-restart.
    const r = await instantQuery(`count by (account_id, account_name, server_name) (increase(scroll_plugin_counter_total{mode="${mode}"}[${FLEET_WIN}]))`);
    for (const s of (r.data?.result || [])) {
      const id = s.metric?.account_id;
      if (id == null) continue;
      const k = String(id);
      if (!map.has(k)) {
        map.set(k, { account_name: s.metric?.account_name || null, server_name: s.metric?.server_name || null });
      }
    }
  } catch (e) { /* non-fatal */ }
  cache.set(ck, map, 300);
  return map;
}

// Set of account_ids whose heartbeat increased in the last ~2 min => live now.
async function liveAccountIds() {
  const set = new Set();
  try {
    const r = await instantQuery(`count by (account_id) (increase(account_active_hb_total{mode="${mode}"}[120s]) > 0)`);
    for (const s of (r.data?.result || [])) {
      const id = s.metric?.account_id;
      if (id != null) set.add(String(id));
    }
  } catch (e) {
    console.error('dashboard liveAccountIds failed:', e.message);
  }
  return set;
}

// Latest instant value of a per-host gauge, keyed by server_name.
async function hostGauge(metric) {
  const map = {};
  try {
    const r = await instantQuery(`${metric}{mode="${mode}"}`);
    for (const s of (r.data?.result || [])) {
      const host = s.metric?.server_name;
      const val = Number(s.value?.[1]);
      if (host && Number.isFinite(val)) map[host] = val;
    }
  } catch (e) { /* non-fatal */ }
  return map;
}

// "Abhi kya chal raha hai" — per-host live scrape rate (events/sec) over a
// short window, summed by server_name. Multiply by 60 in the UI for /min.
async function hostRate(metric, win = '2m') {
  const map = {};
  try {
    const r = await instantQuery(`sum by (server_name) (rate(${metric}{mode="${mode}"}[${win}]))`);
    for (const s of (r.data?.result || [])) {
      const host = s.metric?.server_name;
      const val = Number(s.value?.[1]);
      if (host && Number.isFinite(val)) map[host] = val;
    }
  } catch (e) { /* non-fatal */ }
  return map;
}

// Per-ACCOUNT live scrape rate (events/sec) — "which account is scraping now".
async function acctRateByAccount(win = '2m') {
  const map = {};
  try {
    const r = await instantQuery(`sum by (account_id) (rate(scroll_plugin_counter_total{mode="${mode}"}[${win}]))`);
    for (const s of (r.data?.result || [])) {
      const id = s.metric?.account_id;
      const val = Number(s.value?.[1]);
      if (id != null && Number.isFinite(val)) map[String(id)] = val;
    }
  } catch (e) { /* non-fatal */ }
  return map;
}

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// Fleet-wide live counter increase over a window (e.g. cycles in last 5m).
async function fleetIncrease(metric, win = '5m') {
  try {
    const r = await instantQuery(`sum(increase(${metric}{mode="${mode}"}[${win}]))`);
    const v = Number(r.data?.result?.[0]?.value?.[1]);
    return Number.isFinite(v) ? Math.round(v) : 0;
  } catch (e) {
    return 0;
  }
}

// ---- main endpoint -------------------------------------------------------

// In-flight overview computes keyed by cacheKey — the single-flight stampede
// guard (see the cache-miss path below). Prevents the FE auto-refresh + multiple
// tabs from each launching a duplicate ~5s recompute on every cache expiry,
// which on this small shared box stacked into a CPU stampede (load 50+).
const _overviewInflight = new Map();

async function overview(req, res) {
  const range = req.body?.range || {};
  const platform = req.body?.platform;
  const activeWindowMin = toNum(req.body?.activeWindowMin) || 10;
  let { fromSql, toSql, fromDay, toDay } = dayBounds(range);
  // Live-dashboard timezone guard: the FE derives "today" from the viewer's
  // local timezone, which for IST users in the evening is a calendar day AHEAD
  // of the server's UTC day — so the default window lands entirely in the future
  // and returns nothing (data is timestamped in UTC). If the window STARTS after
  // the current UTC day, snap it to the current UTC day so live data shows.
  const _todayUtc = new Date().toISOString().slice(0, 10);
  if (fromDay > _todayUtc) {
    ({ fromSql, toSql, fromDay, toDay } = dayBounds({ from: _todayUtc, to: _todayUtc }));
  }

  const platKey = Array.isArray(platform) && platform.length ? platform.slice().sort().join('-') : 'all';
  const cacheKey = `dash_overview_${fromDay}_${toDay}_${platKey}_${activeWindowMin}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  // Single-flight stampede guard: if this exact overview is already being
  // computed, wait for it and serve the cache it populates, instead of kicking
  // off a duplicate ~5s recompute.
  const _existing = _overviewInflight.get(cacheKey);
  if (_existing) {
    try { await _existing; } catch (_) { /* ignore */ }
    const _c2 = cache.get(cacheKey);
    if (_c2) return res.json(_c2);
    // the in-flight compute yielded no cache hit; fall through and compute.
  }
  let _flightDone;
  const _flight = new Promise(r => { _flightDone = r; });
  _overviewInflight.set(cacheKey, _flight);
  // Safety net: never let a thrown compute pin the key (bounds the wait above).
  const _flightTimer = setTimeout(() => {
    if (_overviewInflight.get(cacheKey) === _flight) _overviewInflight.delete(cacheKey);
    _flightDone();
  }, 25000);

  // 1) DB rollups per network (each fail-safe).
  const rollups = await Promise.all(
    NET_KEYS.map(net => networkRollup(net, fromSql, toSql, platform).catch(err => {
      console.error(`dashboard rollup ${net} failed:`, err.message);
      return { net, rows: [] };
    }))
  );

  // 2a) account→system bridge (for hostname + status). ES gives the headline
  // ad counts (below); per-system numbers come from the DB activities rollup.
  // Enrich the DB bridge (window-only) with the heartbeat bridge (every monitored
  // account → its real system_id), so the fleet collapses to clean system_ids
  // (PAS####) instead of splitting one machine across its hostname too.
  const [acctToSystem, hbBridge] = await Promise.all([
    buildAccountBridge(range).catch(() => new Map()),
    buildHbBridge().catch(() => new Map()),
  ]);
  for (const [acct, sys] of hbBridge) if (!acctToSystem.has(acct)) acctToSystem.set(acct, sys);

  // Total + Unique ads per network — the SAME query Crawler Insight's
  // /get-count uses (dynamicCountFilter), so the numbers match exactly. Honors
  // the platform filter (metric=platform when platforms are selected).
  const dynArr = await Promise.all(
    NET_KEYS.map(net => dynCounts(net, { from: fromDay, to: toDay }, platform).catch(() => ({ total: null, unique: null })))
  );
  const esTotal = {}, esUnique = {};
  NET_KEYS.forEach((net, i) => { esTotal[net] = dynArr[i]?.total; esUnique[net] = dynArr[i]?.unique; });

  // 2b) Prometheus enrichment (all fail-safe) — heartbeat, specs, AND live "now" activity.
  const [hostMap, liveAccts, cpuMap, ramMap, nowRateByHost,
         cycles5m, ytProc5m, gdnCap5m, nativeCap5m, pluginEvt5m, fleet] = await Promise.all([
    buildHostMap(acctToSystem),
    liveAccountIds(),
    hostGauge('cpu_utilization'),
    hostGauge('ram_utilization'),
    hostRate('scroll_plugin_counter_total', '2m'),   // live scrape rate per host
    fleetIncrease('cycle_outcomes_total', '5m'),       // crawl cycles last 5m
    fleetIncrease('processed_yt_ad_count_total', '5m'),// YouTube processed last 5m
    fleetIncrease('gdn_ads_captured_total', '5m'),     // GDN captured last 5m
    fleetIncrease('native_ads_captured_total', '5m'),  // Native captured last 5m
    fleetIncrease('plugin_event_total', '5m'),         // plugin events last 5m
    buildFleet(acctToSystem),                          // full account-machine fleet (Crawler-Insight parity)
  ]);

  const nowMs = Date.now();
  const windowMs = activeWindowMin * 60 * 1000;

  // 3) Merge by system_id across networks.
  const systems = new Map();          // system_id -> aggregate row
  const networkSummary = {};          // net -> rollup totals

  for (const { net, rows } of rollups) {
    let nSystems = 0, nAccounts = 0, nAds = 0, nUnique = 0, nActive = 0, lastNet = null;
    for (const r of rows) {
      const sid = r.system_id;
      if (!sid) continue;
      nSystems++;
      const ads = toNum(r.ads);
      const uniq = toNum(r.unique_ads);
      const accts = toNum(r.accounts);
      const urls = toNum(r.urls);   // gdn/native: crawl_quality URLs this machine crawled
      const acctIds = (r.account_ids ? String(r.account_ids).split(',') : []).filter(Boolean);
      const lastActive = r.last_active ? new Date(r.last_active).getTime() : 0;
      if (lastActive && (!lastNet || lastActive > lastNet)) lastNet = lastActive;
      nAccounts += accts; nAds += ads; nUnique += uniq;

      let s = systems.get(sid);
      if (!s) {
        s = { system_id: sid, networks: [], accounts: 0, ads: 0, unique_ads: 0, urls: 0,
              last_active_ms: 0, account_ids: new Set(), perNetwork: {} };
        systems.set(sid, s);
      }
      if (!s.networks.includes(net)) s.networks.push(net);
      s.accounts += accts; s.ads += ads; s.unique_ads += uniq; s.urls += urls;
      if (lastActive > s.last_active_ms) s.last_active_ms = lastActive;
      acctIds.forEach(a => s.account_ids.add(a));
      s.perNetwork[net] = { accounts: accts, ads, unique_ads: uniq, urls,
        last_active: lastActive ? new Date(lastActive).toISOString() : null };

      // per-network "active now"?
      const liveHere = acctIds.some(a => liveAccts.has(a)) || (lastActive && nowMs - lastActive <= windowMs);
      if (liveHere) nActive++;
    }
    networkSummary[net] = {
      network: net, systems: nSystems, accounts: nAccounts, ads: nAds,
      unique_ads: nUnique, active_systems: nActive,
      last_active: lastNet ? new Date(lastNet).toISOString() : null,
    };
  }

  // 3b) Add the rest of the account-machine FLEET (Crawler-Insight parity): every
  // machine with monitored accounts, even if it produced no ads in the window.
  // They render as Idle with their account count — so Total Systems matches the
  // Crawler Insight "System Analytics" total instead of only-active-today.
  for (const [sys, f] of fleet) {
    const existing = systems.get(sys);
    if (existing) {
      f.accounts.forEach(a => existing.account_ids.add(a));
      existing.accounts = Math.max(existing.accounts, f.accounts.size);  // monitored count
      for (const net of f.networks) if (!existing.networks.includes(net)) existing.networks.push(net);
      continue;
    }
    const s = { system_id: sys, networks: [...f.networks], accounts: f.accounts.size,
      ads: 0, unique_ads: 0, last_active_ms: 0, account_ids: new Set(f.accounts), perNetwork: {} };
    for (const net of f.networks) s.perNetwork[net] = { accounts: f.accounts.size, ads: 0, unique_ads: 0, last_active: null };
    systems.set(sys, s);
  }

  // recompute per-network system + account counts from the FULL set so the
  // network cards agree with the grid (ads/unique stay = /get-count below).
  for (const net of NET_KEYS) {
    if (!networkSummary[net]) networkSummary[net] = { network: net, systems: 0, accounts: 0, ads: 0, unique_ads: 0, active_systems: 0, last_active: null };
    const inNet = [...systems.values()].filter(s => s.networks.includes(net));
    networkSummary[net].systems = inNet.length;
    networkSummary[net].accounts = inNet.reduce((x, s) => x + (s.accounts || 0), 0);
  }

  // 4) Finalize per-system rows + status + host/cpu/ram.
  const systemRows = [];
  let totActive = 0;
  for (const s of systems.values()) {
    const hosts = hostMap[s.system_id] || [];
    const host = hosts[0] || null;
    // live scrape rate across ALL of this system's hosts -> events/min "right now"
    const ratePerSec = hosts.reduce((sum, h) => sum + (nowRateByHost[h] || 0), 0);
    const nowRatePerMin = Math.round(ratePerSec * 60);
    const acctLive = [...s.account_ids].some(a => liveAccts.has(a));
    const recent = s.last_active_ms && (nowMs - s.last_active_ms <= windowMs);
    // "active now" = beating heartbeat, OR actively scraping now, OR recent activity
    const active = Boolean(acctLive || nowRatePerMin > 0 || recent);
    if (active) totActive++;
    // Per-system ads = DB activity in the window (ES is network-level only, so
    // it can't attribute per-system). Headline/per-network totals use ES below.
    // kind drives the click action: gdncrawl (gdn/native proxmox machine) opens
    // the host-scoped crawl benchmark; others open the per-account drill.
    const isGdnCrawl = s.networks.includes('gdn') || s.networks.includes('native');
    systemRows.push({
      system_id: s.system_id,
      kind: isGdnCrawl ? 'gdncrawl' : 'normal',
      hostname: host,
      hostnames: hosts,
      networks: s.networks,
      accounts: s.accounts,
      ads: s.ads,
      unique_ads: s.unique_ads,
      urls: s.urls || 0,
      last_active: s.last_active_ms ? new Date(s.last_active_ms).toISOString() : null,
      last_active_ago_sec: s.last_active_ms ? Math.round((nowMs - s.last_active_ms) / 1000) : null,
      active,
      live_heartbeat: acctLive,
      now_rate_per_min: nowRatePerMin,   // live: scraping speed right now
      cpu: host && cpuMap[host] != null ? Math.round(cpuMap[host]) : null,
      ram: host && ramMap[host] != null ? Math.round(ramMap[host]) : null,
      perNetwork: s.perNetwork,
    });
  }
  systemRows.sort((a, b) => (b.last_active_ms || 0) - (a.last_active_ms || 0) ||
                            (new Date(b.last_active || 0)) - (new Date(a.last_active || 0)));

  // Make each network's "live" count use the SAME definition as the per-system
  // `active` badge (heartbeat OR scraping-now OR recent). Earlier the rollup  
  // loop only knew about heartbeat/recency, so a network could show "0 live"  
  // while its system cards showed "Active" (scraping now). Recompute from the 
  // finalized rows so the network card and the grid always agree.             
  const netActiveCount = {};
  for (const r of systemRows) {
    if (!r.active) continue;
    for (const net of (r.networks || [])) netActiveCount[net] = (netActiveCount[net] || 0) + 1;
  }
  for (const net of NET_KEYS) {
    if (networkSummary[net]) networkSummary[net].active_systems = netActiveCount[net] || 0;
  }

  // Per-network "ads" (last_seen) + "unique" (first_seen) = ES, the SAME source
  // as the live site / Crawler Insight. Falls back to DB activity if ES is null.
  for (const net of NET_KEYS) {
    if (!networkSummary[net]) continue;
    if (esTotal[net] != null) networkSummary[net].ads = esTotal[net];
    if (esUnique[net] != null) networkSummary[net].unique_ads = esUnique[net];
  }

  // fleet-wide live scrape rate (events/min) summed across every host
  const fleetRatePerMin = Math.round(
    Object.values(nowRateByHost).reduce((sum, v) => sum + (v || 0), 0) * 60
  );

  const totals = {
    systems: systemRows.length,
    active_systems: totActive,
    inactive_systems: systemRows.length - totActive,
    accounts: systemRows.reduce((x, r) => x + r.accounts, 0),
    // total/unique ads = sum of per-network ES counts (matches live site / Crawler Insight)
    ads: NET_KEYS.reduce((x, net) => x + (esTotal[net] || 0), 0),
    unique_ads: NET_KEYS.reduce((x, net) => x + (esUnique[net] || 0), 0),
    networks_active: Object.values(networkSummary).filter(n => n.systems > 0).length,
  };

  // "Abhi kya chal raha hai" — real-time fleet activity (Prometheus, last few min).
  const live = {
    scrape_rate_per_min: fleetRatePerMin,
    cycles_5m: cycles5m,
    yt_processed_5m: ytProc5m,
    gdn_captured_5m: gdnCap5m,
    native_captured_5m: nativeCap5m,
    plugin_events_5m: pluginEvt5m,
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    window: { from: fromDay, to: toDay, activeWindowMin },
    platform: Array.isArray(platform) && platform.length ? platform : null,
    totals,
    live,
    networks: NET_KEYS.map(n => networkSummary[n]).filter(Boolean),
    systems: systemRows,
  };

  cache.set(cacheKey, payload, 60); // was 20s (< the 30s FE refresh, so EVERY refresh missed); single-flight collapses any concurrent misses
  clearTimeout(_flightTimer);
  if (_overviewInflight.get(cacheKey) === _flight) _overviewInflight.delete(cacheKey);
  _flightDone();
  return res.json(payload);
}

// account_ids heartbeating under one system (server_name == system_id) over the
// fleet window — the monitored accounts, even those with no ads in the window.
// Lets the drill match the grid (which counts heartbeat accounts via buildFleet)
// instead of showing "no account activity" for a system that IS being monitored.
function _promLabel(v) { return String(v == null ? '' : v).replace(/[\\"\n]/g, ''); }
async function heartbeatAccountsForSystem(systemId) {
  const out = [];
  try {
    const r = await instantQuery(`count by (account_id, network) (increase(account_active_hb_total{mode="${mode}",server_name="${_promLabel(systemId)}"}[${FLEET_WIN}]))`);
    for (const s of (r.data?.result || [])) {
      const id = s.metric?.account_id;
      if (id == null || id === '-' || id === 'N/A') continue;
      out.push({ account_id: String(id), network: (s.metric?.network || '').toLowerCase() });
    }
  } catch (e) { /* non-fatal */ }
  return out;
}

// ---- system drill: per-account breakdown for one system ------------------
//
// POST /dashboard/system  { system_id, range, platform? }
// Returns each account running on that system (account_id, network, ads,
// unique, last-active) for the account-networks, plus a per-network ad summary
// for the system-only networks (youtube/native/gdn/gtext — no account_id).
async function systemDrill(req, res) {
  const system_id = req.body?.system_id;
  if (!system_id) return res.status(400).json({ error: 'system_id required' });
  const range = req.body?.range || {};
  const platform = req.body?.platform;
  const { fromSql, toSql, fromDay, toDay } = dayBounds(range);

  const platKey = Array.isArray(platform) && platform.length ? platform.slice().sort().join('-') : 'all';
  const cacheKey = `dash_system_${system_id}_${fromDay}_${toDay}_${platKey}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const nowMs = Date.now();
  const accounts = [];
  const perNetwork = [];
  let recent = [];   // per-system live feed (youtube: what this machine just inserted)

  await Promise.all(NET_KEYS.map(async (net) => {
    const cfg = NETS[net];
    const dbName = process.env[cfg.env];
    if (!dbName) return;
    // gdn/native systems are proxmox machines — they open the crawl benchmark
    // (gdnBenchmark), never this per-account drill — so skip their heavy queries.
    if (net === 'gdn' || net === 'native') return;
    const plat = (Array.isArray(platform) && platform.length === 1) ? Number(platform[0]) : null;
    try {
      if (net === 'youtube') {
        // youtube systems come from youtube_ad.system_id (proxmox machines)
        const sql = `SELECT COUNT(*) AS ads, MAX(last_seen) AS last_active
          FROM youtube_ad WHERE system_id = ? AND created_date BETWEEN ? AND ?`;
        const rows = await queryDatabase(cfg.db_id, dbName, sql, [system_id, fromSql, toSql]);
        const r = rows && rows[0];
        if (r && toNum(r.ads) > 0) {
          const la = r.last_active ? new Date(r.last_active).getTime() : 0;
          perNetwork.push({ network: net, accounts: 0, ads: toNum(r.ads), unique_ads: 0,
            last_active: la ? new Date(la).toISOString() : null });
        }
        // per-system LIVE feed: the latest ads THIS machine just inserted/saw.
        try {
          const feed = await queryDatabase(cfg.db_id, dbName,
            `SELECT ad_id, type, ad_position, UNIX_TIMESTAMP(last_seen) last_seen, UNIX_TIMESTAMP(created_date) created
             FROM youtube_ad WHERE system_id = ? ORDER BY id DESC LIMIT 60`, [system_id]);
          recent = (feed || []).map((x) => ({
            network: 'youtube', ad_id: x.ad_id, ad_type: x.type || '', ad_position: x.ad_position || '',
            ts: toNum(x.last_seen) || toNum(x.created),
          }));
        } catch (e) { /* feed is best-effort */ }
      } else if (cfg.hasAccount) {
        // SAME source as the overview grid — the <net>_ad table joined to
        // <net>_users (adCountAcrossSelectedNetworks), filtered to this system.
        // The activities log was sparse, so systems that DID produce ads showed
        // "no account activity" here. account_name comes from the join.
        const adRows = await adCountAcrossSelectedNetworks({ from: fromDay, to: toDay }, [net], null, plat).catch(() => []);
        const agg = new Map();   // account_id -> { ads, name }
        for (const r of (adRows || [])) {
          if (String(r?.system_name) !== String(system_id)) continue;
          const acct = (r.account_id != null && r.account_id !== 'N/A') ? String(r.account_id) : null;
          if (!acct) continue;
          let e = agg.get(acct);
          if (!e) { e = { ads: 0, name: (r.account_name && r.account_name !== 'N/A') ? r.account_name : null }; agg.set(acct, e); }
          e.ads += toNum(r.unqiue_ads);
        }
        let nAds = 0;
        for (const [acct, e] of agg) {
          nAds += e.ads;
          accounts.push({ account_id: acct, network: net, ads: e.ads, unique_ads: 0,
            name: e.name, last_active: null, last_active_ago_sec: null });
        }
        if (agg.size) {
          perNetwork.push({ network: net, accounts: agg.size, ads: nAds, unique_ads: 0, last_active: null });
        }
      } else {
        // system-only networks (gtext) — same adCount source as the overview.
        const adRows = await adCountAcrossSelectedNetworks({ from: fromDay, to: toDay }, [net], null, plat).catch(() => []);
        let nAds = 0;
        for (const r of (adRows || [])) {
          if (String(r?.system_name) !== String(system_id)) continue;
          nAds += toNum(r.unqiue_ads);
        }
        if (nAds > 0) {
          perNetwork.push({ network: net, accounts: 0, ads: nAds, unique_ads: 0, last_active: null });
        }
      }
    } catch (e) {
      console.error(`system drill ${net} failed:`, e.message);
    }
  }));

  // Idle monitored accounts: heartbeating under this system (server_name=
  // system_id) but with no ads in the window — so the drill's account list
  // matches the grid's count (which includes the heartbeat fleet) instead of
  // showing "no account activity" for a system that IS being monitored.
  try {
    const have = new Set(accounts.map(a => String(a.account_id)));
    for (const { account_id, network } of await heartbeatAccountsForSystem(system_id)) {
      if (have.has(account_id)) continue;
      have.add(account_id);
      accounts.push({ account_id, network: network || null, ads: 0, unique_ads: 0,
        name: null, last_active: null, last_active_ago_sec: null });
    }
  } catch (e) { /* non-fatal */ }

  // ---- enrich accounts: name + country (DB users) + live + prom keys -------
  const [promAcct, liveAccts] = await Promise.all([
    buildAccountPromMap().catch(() => new Map()),
    liveAccountIds().catch(() => new Set()),
  ]);

  // batch the users-table lookups per network (name + country)
  const idsByNet = {};
  for (const a of accounts) {
    if (a.account_id == null) continue;
    (idsByNet[a.network] = idsByNet[a.network] || new Set()).add(String(a.account_id));
  }
  const userMaps = {};
  await Promise.all(Object.keys(idsByNet).map(async (net) => {
    const cfg = NETS[net];
    if (!cfg?.user) return;
    const ids = [...idsByNet[net]];
    if (!ids.length) return;
    try {
      const sql = `SELECT \`${cfg.user.idCol}\` AS aid,
          \`${cfg.user.nameCol}\` AS name, \`${cfg.user.countryCol}\` AS country
        FROM \`${cfg.user.table}\`
        WHERE \`${cfg.user.idCol}\` IN (${ids.map(() => '?').join(',')})`;
      const rows = await queryDatabase(cfg.db_id, process.env[cfg.env], sql, ids);
      const m = new Map();
      for (const r of (rows || [])) m.set(String(r.aid), { name: r.name, country: r.country });
      userMaps[net] = m;
    } catch (e) {
      console.error(`drill user lookup ${net} failed:`, e.message);
    }
  }));

  let liveCount = 0;
  for (const a of accounts) {
    const u = userMaps[a.network]?.get(String(a.account_id));
    const p = promAcct.get(String(a.account_id));
    const dbName = u?.name && String(u.name).trim() && u.name !== 'N/A' ? u.name : null;
    a.name = dbName || a.name || p?.account_name || null;
    a.country = u?.country || null;
    a.live = liveAccts.has(String(a.account_id));   // heartbeat NOW (Prometheus)
    if (a.live) liveCount++;
    a.prom_account_name = p?.account_name || null;  // for the status-timeline call
    a.prom_server = p?.server_name || null;         // hostname for the timeline
  }

  accounts.sort((a, b) => (Number(b.live) - Number(a.live)) || (b.ads || 0) - (a.ads || 0));
  perNetwork.sort((a, b) => (b.ads || 0) - (a.ads || 0));

  const acctAds = accounts.reduce((x, a) => x + a.ads, 0);
  const acctUniq = accounts.reduce((x, a) => x + a.unique_ads, 0);
  const sysOnly = perNetwork.filter(p => p.accounts === 0);
  const payload = {
    system_id,
    window: { from: fromDay, to: toDay },
    totals: {
      accounts: accounts.length,
      live_accounts: liveCount,
      ads: acctAds + sysOnly.reduce((x, p) => x + p.ads, 0),
      unique_ads: acctUniq + sysOnly.reduce((x, p) => x + p.unique_ads, 0),
      networks: perNetwork.length,
    },
    accounts,
    perNetwork,
    recent,
  };
  cache.set(cacheKey, payload, 30);
  return res.json(payload);
}

// ---- ALL accounts across the fleet (for the Accounts / Scraping-Now tiles) --
//
// POST /dashboard/accounts  { range, platform? }
// Every account on every system: name, country, network, system_id, live (now),
// scrape rate now, ads/unique/last-active. Drives a single "All Accounts" view
// that the Accounts tile (no filter) and the Scraping-Now tile (scraping>0) share.
async function accountsOverview(req, res) {
  const range = req.body?.range || {};
  const platform = req.body?.platform;
  const { fromSql, toSql, fromDay, toDay } = dayBounds(range);

  const platKey = Array.isArray(platform) && platform.length ? platform.slice().sort().join('-') : 'all';
  const cacheKey = `dash_accounts_${fromDay}_${toDay}_${platKey}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  // 1) per-account rows from the account-networks (grouped by account + system)
  const rollups = await Promise.all(NET_KEYS.filter(n => NETS[n].hasAccount).map(async (net) => {
    const cfg = NETS[net];
    const dbName = process.env[cfg.env];
    if (!dbName) return { net, rows: [] };
    const params = [fromSql, toSql];
    let platClause = '';
    if (Array.isArray(platform) && platform.length) {
      platClause = ` AND platform IN (${platform.map(() => '?').join(',')})`;
      params.push(...platform);
    }
    try {
      const sql = `SELECT account_id, system_id, COUNT(*) AS ads,
          COALESCE(SUM(is_unique),0) AS unique_ads, MAX(created_at) AS last_active
        FROM \`${cfg.acts}\`
        WHERE created_at BETWEEN ? AND ?${platClause}
        GROUP BY account_id, system_id`;
      const rows = await queryDatabase(cfg.db_id, dbName, sql, params);
      return { net, rows: rows || [] };
    } catch (e) {
      console.error(`accounts rollup ${net} failed:`, e.message);
      return { net, rows: [] };
    }
  }));

  // 2) Prometheus: live set + per-account scrape rate + name/server map
  const [liveAccts, rateByAcct, promAcct] = await Promise.all([
    liveAccountIds().catch(() => new Set()),
    acctRateByAccount().catch(() => ({})),
    buildAccountPromMap().catch(() => new Map()),
  ]);

  // 3) flatten + name/country enrichment (batched per network)
  const nowMs = Date.now();
  const flat = [];
  const idsByNet = {};
  for (const { net, rows } of rollups) {
    for (const r of rows) {
      if (r.account_id == null) continue;
      (idsByNet[net] = idsByNet[net] || new Set()).add(String(r.account_id));
      flat.push({
        account_id: r.account_id, network: net, system_id: r.system_id || null,
        ads: toNum(r.ads), unique_ads: toNum(r.unique_ads),
        last_active_ms: r.last_active ? new Date(r.last_active).getTime() : 0,
      });
    }
  }
  const userMaps = {};
  await Promise.all(Object.keys(idsByNet).map(async (net) => {
    const cfg = NETS[net];
    if (!cfg?.user) return;
    const ids = [...idsByNet[net]];
    if (!ids.length) return;
    try {
      const sql = `SELECT \`${cfg.user.idCol}\` AS aid,
          \`${cfg.user.nameCol}\` AS name, \`${cfg.user.countryCol}\` AS country
        FROM \`${cfg.user.table}\` WHERE \`${cfg.user.idCol}\` IN (${ids.map(() => '?').join(',')})`;
      const rows = await queryDatabase(cfg.db_id, process.env[cfg.env], sql, ids);
      const m = new Map();
      for (const r of (rows || [])) m.set(String(r.aid), { name: r.name, country: r.country });
      userMaps[net] = m;
    } catch (e) {
      console.error(`accounts user lookup ${net} failed:`, e.message);
    }
  }));

  const networksSet = new Set(), countriesSet = new Set(), systemsSet = new Set();
  let liveCount = 0, scrapingCount = 0, totAds = 0, totUniq = 0;
  const accounts = flat.map((a) => {
    const id = String(a.account_id);
    const u = userMaps[a.network]?.get(id);
    const p = promAcct.get(id);
    const dbName = u?.name && String(u.name).trim() && u.name !== 'N/A' ? u.name : null;
    const live = liveAccts.has(id);
    const nowRate = Math.round((rateByAcct[id] || 0) * 60);
    if (live) liveCount++;
    if (nowRate > 0) scrapingCount++;
    totAds += a.ads; totUniq += a.unique_ads;
    networksSet.add(a.network);
    if (u?.country) countriesSet.add(u.country);
    if (a.system_id) systemsSet.add(a.system_id);
    return {
      account_id: a.account_id,
      name: dbName || p?.account_name || null,
      network: a.network,
      country: u?.country || null,
      system_id: a.system_id,
      live,
      now_rate_per_min: nowRate,
      ads: a.ads,
      unique_ads: a.unique_ads,
      last_active: a.last_active_ms ? new Date(a.last_active_ms).toISOString() : null,
      last_active_ago_sec: a.last_active_ms ? Math.round((nowMs - a.last_active_ms) / 1000) : null,
      prom_account_name: p?.account_name || null,
      prom_server: p?.server_name || null,
    };
  });

  // live first, then scraping rate, then ads
  accounts.sort((x, y) =>
    (Number(y.live) - Number(x.live)) ||
    (y.now_rate_per_min - x.now_rate_per_min) ||
    (y.ads - x.ads));

  const payload = {
    generatedAt: new Date().toISOString(),
    window: { from: fromDay, to: toDay },
    totals: { accounts: accounts.length, live: liveCount, scraping: scrapingCount, ads: totAds, unique_ads: totUniq },
    facets: {
      networks: [...networksSet],
      countries: [...countriesSet].sort(),
      systems: [...systemsSet].sort(),
    },
    accounts,
  };
  cache.set(cacheKey, payload, 20);
  return res.json(payload);
}

// ---- per-account status timeline (by account_id — always present) ----------
//
// POST /dashboard/account-timeline  { account_id, server_name?, range }
// Same output shape as the existing account-state-chart, but filtered by
// account_id (the heartbeat metric always carries it) so it never comes back
// empty due to an account_name mismatch.
async function accountTimeline(req, res) {
  const account_id = req.body?.account_id;
  if (account_id == null || account_id === '') return res.status(400).json({ error: 'account_id required' });
  const range = req.body?.range || {};
  const { fromDay, toDay } = dayBounds(range);
  const start = Math.floor(new Date(`${fromDay} 00:00:00`).getTime() / 1000);
  const end = Math.floor(new Date(`${toDay} 23:59:59`).getTime() / 1000);

  // Filter ONLY by account_id. We deliberately do NOT filter by server_name:
  // the same machine carries different server_name formats across metrics
  // (e.g. "GLB-218-PC" in scroll_plugin_counter_total vs "GLB - 218" in
  // account_active_hb_total), which would wrongly return empty. sum() collapses
  // any per-server series into one heartbeat timeline.
  const promql = `sum(increase(account_active_hb_total{account_id="${account_id}",mode="${mode}"}[100s]))`;

  try {
    const url = `${PROM_BASE}/api/v1/query_range?query=${encodeURIComponent(promql)}&start=${start}&end=${end}&step=180`;
    const resp = await axios.get(url, { timeout: 15000 });
    const result = resp.data?.data?.result?.[0];
    if (!result || !result.values || !result.values.length) {
      // Figure out the EXACT reason it's empty (so the UI can show it).
      let reason = 'No heartbeat data points in the selected window.';
      let seriesExists = false, liveNow = false, servers = [];
      try {
        // does ANY account_active_hb_total series exist for this account_id at all?
        const probe = await instantQuery(`account_active_hb_total{account_id="${account_id}",mode="${mode}"}`);
        const r = probe.data?.result || [];
        seriesExists = r.length > 0;
        servers = [...new Set(r.map((x) => x.metric?.server_name).filter(Boolean))];
        const inc = await instantQuery(`increase(account_active_hb_total{account_id="${account_id}",mode="${mode}"}[120s]) > 0`);
        liveNow = (inc.data?.result || []).length > 0;
      } catch (e) { /* ignore */ }

      if (!seriesExists) {
        reason = `Prometheus has NO account_active_hb_total series for account_id="${account_id}" — the plugin reports this account under a different id (or isn't exporting a heartbeat). The "Live/Active" badge you saw comes from a DIFFERENT account_id match; the timeline can't be drawn without a matching heartbeat series.`;
      } else if (liveNow) {
        reason = `Heartbeat is increasing RIGHT NOW but the range query over ${fromDay}→${toDay} (step 180s) returned no points — usually the account came online only in the last few minutes, so there's nothing yet across the day window.`;
      } else {
        reason = `Series exists but had no increase in ${fromDay}→${toDay} — account was online OUTSIDE this date window. Widen the date range.`;
      }
      return res.json({
        timeline: [], totalActive: '00:00:00', totalInactive: '00:00:00', empty: true,
        reason, seriesExists, liveNow, servers, query: promql,
      });
    }
    const values = result.values;
    const timeline = [];
    let totalActive = 0, totalInactive = 0;
    let currentState = parseFloat(values[0][1]) > 0;
    let periodStart = parseInt(values[0][0]);
    const label = String(account_id);
    for (let i = 1; i < values.length; i++) {
      const ts = parseInt(values[i][0]);
      const newState = parseFloat(values[i][1]) > 0;
      if (newState !== currentState) {
        const periodEnd = ts - 1;
        const duration = periodEnd - periodStart + 1;
        if (currentState) totalActive += duration; else totalInactive += duration;
        timeline.push({
          category: label, from: periodStart, to: periodEnd,
          name: currentState ? 'Active' : 'Inactive',
          columnSettings: { fill: currentState ? 'am5.color(0x4caf50)' : 'am5.color(0xcd213b)' },
        });
        currentState = newState;
        periodStart = ts;
      }
    }
    const lastTs = parseInt(values[values.length - 1][0]);
    const lastDur = lastTs - periodStart + 1;
    if (currentState) totalActive += lastDur; else totalInactive += lastDur;
    timeline.push({
      category: label, from: periodStart, to: lastTs,
      name: currentState ? 'Active' : 'Inactive',
      columnSettings: { fill: currentState ? 'am5.color(0x4caf50)' : 'am5.color(0xcd213b)' },
    });
    return res.json({ timeline, totalActive: fmtDuration(totalActive), totalInactive: fmtDuration(totalInactive) });
  } catch (e) {
    console.error('accountTimeline failed:', e.message);
    return res.json({ timeline: [], totalActive: '00:00:00', totalInactive: '00:00:00', error: e.message });
  }
}

// ---- discover ALL platform values present in the data --------------------
//
// POST /dashboard/platforms  ->  [{ value, label }]
// Looks across every network's activities table (last 7 days) so the filter
// lists EVERY platform that exists (10, 12, 15, …), not just a hardcoded pair.
const PLATFORM_LABELS = { '10': 'Scroll Plugin', '12': 'Python Crawler' };
async function platforms(req, res) {
  const cacheKey = 'dash_platforms';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const toD = new Date();
  const fromD = new Date(Date.now() - 7 * 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  const fromSql = `${fromD.getFullYear()}-${pad(fromD.getMonth() + 1)}-${pad(fromD.getDate())} 00:00:00`;
  const toSql = `${toD.getFullYear()}-${pad(toD.getMonth() + 1)}-${pad(toD.getDate())} 23:59:59`;

  const set = new Set();
  await Promise.all(NET_KEYS.map(async (net) => {
    const cfg = NETS[net];
    const dbName = process.env[cfg.env];
    if (!dbName) return;
    try {
      const rows = await queryDatabase(cfg.db_id, dbName,
        `SELECT DISTINCT platform FROM \`${cfg.acts}\` WHERE created_at BETWEEN ? AND ? LIMIT 50`,
        [fromSql, toSql]);
      for (const r of (rows || [])) if (r.platform != null && r.platform !== '') set.add(String(r.platform));
    } catch (e) { /* fail-safe */ }
  }));

  const list = [...set].sort((a, b) => Number(a) - Number(b))
    .map((v) => ({ value: v, label: PLATFORM_LABELS[v] || `Platform ${v}` }));
  const payload = { platforms: list };
  cache.set(cacheKey, payload, 600);
  return res.json(payload);
}

// ---- system data-lineage debug trace -------------------------------------
//
// POST /dashboard/system-debug  { system_id, range, platform? }
// Re-runs the real lookups for ONE system and records each step (human title +
// source + result; raw query hidden by default) so the user can see exactly
// HOW this system's name / hostname / numbers were obtained.
async function systemDebug(req, res) {
  const system_id = req.body?.system_id;
  if (!system_id) return res.status(400).json({ error: 'system_id required' });
  const range = req.body?.range || {};
  const platform = req.body?.platform;
  const { fromSql, toSql, fromDay, toDay } = dayBounds(range);

  const t0 = Date.now();
  const steps = [];
  const step = (s) => { steps.push({ n: steps.length + 1, at_ms: Date.now() - t0, ...s }); };

  step({ title: `Search for system "${system_id}" in every network's activity log`, source: 'db', status: 'info',
    detail: 'There is no central system registry — the name lives directly in each <net>_accounts_activities.system_id column.' });

  const found = [];
  for (const net of NET_KEYS) {
    const cfg = NETS[net];
    const dbName = process.env[cfg.env];
    if (!dbName) continue;
    const params = [system_id, fromSql, toSql];
    let platClause = '';
    if (Array.isArray(platform) && platform.length) {
      platClause = ` AND platform IN (${platform.map(() => '?').join(',')})`;
      params.push(...platform);
    }
    const sql = `SELECT COUNT(*) AS ads, COUNT(DISTINCT account_id) AS accounts, MAX(created_at) AS last
      FROM \`${cfg.acts}\` WHERE system_id = ? AND created_at BETWEEN ? AND ?${platClause}`;
    try {
      const rows = await queryDatabase(cfg.db_id, dbName, sql, params);
      const r = rows && rows[0];
      const ads = toNum(r?.ads);
      if (ads > 0) {
        found.push(net);
        step({ title: `Matched in ${net} → table ${cfg.acts}`, source: 'db', status: 'ok',
          query: sql.replace(/\s+/g, ' ').trim(),
          detail: `${ads} ad-capture rows · ${toNum(r.accounts)} accounts · last activity ${r.last || '—'}. ${cfg.hasAccount ? 'Account names come from ' + cfg.user.table + '.' : 'This network has no user table — system_id is the only identity.'}`,
          result: { ads, accounts: toNum(r.accounts) } });
      }
    } catch (e) {
      step({ title: `${net}: query error`, source: 'db', status: 'error', detail: e.message });
    }
  }
  if (!found.length) {
    step({ title: 'Not found in any activity table for this window', source: 'db', status: 'warn',
      detail: 'System is idle in the selected date range (or the id is spelled differently).' });
  } else {
    step({ title: `System name source confirmed: ${found.join(', ')} activity table(s)`, source: 'db', status: 'ok',
      detail: `"${system_id}" is a raw value stored by the crawler in <net>_accounts_activities.system_id — it is NOT derived or generated here.` });
  }

  // Prometheus hostname bridge
  step({ title: 'Resolve machine hostname via Prometheus', source: 'prom', status: 'info',
    detail: 'DB system_id (e.g. PAS1012 / decodo-isp) ≠ Prometheus server_name (machine hostname). They are joined through the shared account_id.' });
  let hosts = [];
  try {
    const acctToSystem = await buildAccountBridge(range).catch(() => new Map());
    const hostMap = await buildHostMap(acctToSystem).catch(() => ({}));
    hosts = hostMap[system_id] || [];
    step({ title: hosts.length ? `Hostname resolved: ${hosts.join(', ')}` : 'No Prometheus hostname for this system',
      source: 'prom', status: hosts.length ? 'ok' : 'warn',
      query: `scroll_plugin_counter_total{mode="${mode}"}  →  match account_id  →  server_name`,
      detail: hosts.length
        ? 'One of this system\'s account_ids appears in scroll_plugin_counter_total; its server_name label is the hostname.'
        : 'No scroll_plugin_counter_total series carried this system\'s account_id — so no live hostname/CPU/RAM (DB data still shown).' });
  } catch (e) {
    step({ title: 'Hostname bridge failed', source: 'prom', status: 'error', detail: e.message });
  }

  // live CPU/RAM
  const host = hosts[0];
  if (host) {
    try {
      const [cpu, ram] = await Promise.all([hostGauge('cpu_utilization'), hostGauge('ram_utilization')]);
      step({ title: 'Read live CPU / RAM', source: 'prom', status: 'ok',
        query: `cpu_utilization{server_name="${host}"} · ram_utilization{server_name="${host}"}`,
        detail: `CPU ${cpu[host] ?? '—'}% · RAM ${ram[host] ?? '—'}% (instant gauge values).` });
    } catch (e) {
      step({ title: 'CPU/RAM read failed', source: 'prom', status: 'error', detail: e.message });
    }
  }

  return res.json({ system_id, window: { from: fromDay, to: toDay }, networks_found: found, hosts, steps, total_ms: Date.now() - t0 });
}

// ---- exporter health / raw snapshot -------------------------------------
//
// Reads the RAW Prometheus exposition (send-metrics) directly — the absolute
// freshest snapshot (no scrape lag) + a "is the source up?" signal. Kept on a
// SEPARATE endpoint (not in the 20s overview poll) so downloading the blob
// never slows the main dashboard. Fully fail-safe.
async function exporterHealth(req, res) {
  if (!SEND_METRICS_URL) {
    return res.json({ up: false, configured: false, error: 'SEND_METRICS_URL not set' });
  }
  const cacheKey = 'dash_exporter_health';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const t0 = Date.now();
  try {
    // The raw exposition has grown to tens of MB (high metric cardinality), which blew past the
    // old 60MB cap (→ outright failure) and made the fetch+parse slow enough to block the event
    // loop. We only need a representative head for the "up" signal + headline counters, so STREAM
    // and stop after CAP_BYTES — fast, bounded, and it can never choke on the full blob again.
    const CAP_BYTES = 12 * 1024 * 1024;
    const stream = await axios.get(SEND_METRICS_URL, {
      timeout: 10000, responseType: 'stream', maxContentLength: Infinity, maxBodyLength: Infinity,
    });
    let text = ''; let bytes = 0; let truncated = false;
    await new Promise((resolve, reject) => {
      stream.data.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= CAP_BYTES) { text += chunk.toString('latin1'); }
        else if (!truncated) { truncated = true; try { stream.data.destroy(); } catch (e) { /* ignore */ } resolve(); }
      });
      stream.data.on('end', resolve);
      stream.data.on('close', resolve);
      stream.data.on('error', reject);
    });
    const lines = text.split('\n');

    // Count distinct metric names + total series (sample lines, ignore # HELP/# TYPE).
    const metricNames = new Set();
    let series = 0;
    for (const line of lines) {
      if (!line || line[0] === '#') continue;
      series++;
      const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)/);
      if (m) metricNames.add(m[1]);
    }

    // A few headline counters (current raw values, summed) for a "right now" feel.
    const sumMetric = (name) => {
      let total = 0, found = false;
      for (const line of lines) {
        if (line[0] === '#') continue;
        if (line.startsWith(name + '{') || line.startsWith(name + ' ')) {
          const val = Number(line.trim().split(/\s+/).pop());
          if (Number.isFinite(val)) { total += val; found = true; }
        }
      }
      return found ? total : null;
    };

    // Do the live-activity metric names actually exist on prod? (diagnoses the
    // "always 0" strip — a missing name means that PromQL returns nothing.)
    const LIVE_METRICS = ['cycle_outcomes_total', 'processed_yt_ad_count_total',
      'gdn_ads_captured_total', 'native_ads_captured_total', 'plugin_event_total'];
    const live_metric_check = {};
    for (const name of LIVE_METRICS) {
      live_metric_check[name] = metricNames.has(name) ? sumMetric(name) : 'MISSING';
    }
    // Surface candidate names so we can map to the real ones if they differ.
    const allNames = [...metricNames].sort();
    const candidates = allNames.filter(n => /cycle|captur|process|plugin|scroll|_hb_|heartbeat|cpu|ram|ad_count|ads_/i.test(n));

    const payload = {
      up: true,
      configured: true,
      url: SEND_METRICS_URL,
      fetchedAt: new Date().toISOString(),
      latency_ms: Date.now() - t0,
      bytes: text.length,
      truncated,
      series,
      metric_names: metricNames.size,
      snapshot: {
        scroll_plugin_counter_total: sumMetric('scroll_plugin_counter_total'),
        account_active_hb_total: sumMetric('account_active_hb_total'),
        system_active_hb_total: sumMetric('system_active_hb_total'),
        plugin_event_total: sumMetric('plugin_event_total'),
      },
      live_metric_check,          // which live-strip metrics exist + their raw sum
      candidate_metrics: candidates, // real names matching cycle/capture/plugin/etc.
    };
    cache.set(cacheKey, payload, 120); // 2-min cache so the 12MB stream isn't refetched every poll
    return res.json(payload);
  } catch (e) {
    const payload = { up: false, configured: true, url: SEND_METRICS_URL,
      latency_ms: Date.now() - t0, error: e.message };
    cache.set(cacheKey, payload, 30);
    return res.json(payload);
  }
}

// ---- GDN / Native scraping-benchmark (ported from pas_node_api gdn dashboard) -
//
// POST /dashboard/gdn-benchmark  { system_id?, session_secs?, limit? }
// Direct DB read (NO v2 HTTP API) — the admin pools already reach the same DBs:
//   GDN    = db_id 5 / gdnpro_v2     (gdn_crawl_quality, gdn_ad, gdn_account_activities, …)
//   NATIVE = db_id 3 / nativepro_v2  (native_ad, native_account_activities, networks)
// SQL is a faithful copy of buildOverview/buildLive in
// pas_node_api/src/services/gdn/routes/gdnDashboardRoutes.js.
const GDN_POOL = { id: NETS.gdn.db_id, db: () => process.env[NETS.gdn.env] };
const NAT_POOL = { id: NETS.native.db_id, db: () => process.env[NETS.native.env] };
const g1 = (q, p) => queryDatabase(GDN_POOL.id, GDN_POOL.db(), q, p).then(r => (r && r[0]) ? r[0] : {});
const gA = (q, p) => queryDatabase(GDN_POOL.id, GDN_POOL.db(), q, p).then(r => r || []);
const n1 = (q, p) => queryDatabase(NAT_POOL.id, NAT_POOL.db(), q, p).then(r => (r && r[0]) ? r[0] : {});
const nA = (q, p) => queryDatabase(NAT_POOL.id, NAT_POOL.db(), q, p).then(r => r || []);

// scope = ISP/provider (default, network 📊 button) OR a single proxmox machine
// (host, when a system card is clicked). host mode filters gdn_crawl_quality by
// host; the account_activities "new" counts are ISP-keyed so they're 0 per host.
async function gdnBuildLive(sid, sessionSecs, limit, host) {
  const byHost = !!host;
  const sCol = byHost ? 'host' : 'provider';
  const sVal = byHost ? host : sid;
  const scopeWhere = byHost ? `WHERE ${sCol}=?` : '';
  const sp = byHost ? [sVal] : [];

  const a = await g1('SELECT COUNT(*) done, COUNT(DISTINCT host) hosts, MAX(UNIX_TIMESTAMP(last_crawled)) last_ts, '
    + 'MIN(UNIX_TIMESTAMP(last_crawled)) start_ts FROM gdn_crawl_quality '
    + `WHERE last_crawled > (NOW() - INTERVAL ? SECOND) AND ${sCol}=?`, [sessionSecs, sVal]);
  const ccsRows = await gA('SELECT DISTINCT country FROM gdn_crawl_quality WHERE last_crawled > (NOW() - INTERVAL ? SECOND) '
    + `AND ${sCol}=? AND country<>'' ORDER BY country`, [sessionSecs, sVal]);
  const ccs = ccsRows.map(r => r.country);
  let pool = 0;
  if (ccs.length) {
    const ph = ccs.map(() => '?').join(',');
    pool = toNum((await g1(`SELECT COUNT(DISTINCT url) c FROM gdn_crawl_quality WHERE ${sCol}=? AND country IN (${ph})`, [sVal, ...ccs])).c);
  }
  const obs = await g1(`SELECT COALESCE(SUM(total_gdn_ads),0) g, COALESCE(SUM(total_native_ads),0) n FROM gdn_crawl_quality WHERE ${sCol}=?`, [sVal]);
  const gnew = byHost ? 0 : toNum((await g1('SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1', [sid])).c);
  const nnew = byHost ? 0 : toNum((await n1('SELECT COUNT(*) c FROM native_account_activities WHERE system_id=? AND is_unique=1', [sid])).c);
  const gObs = toNum(obs.g), nObs = toNum(obs.n);
  const lastTs = a.last_ts != null ? toNum(a.last_ts) : null;
  const running = !!(lastTs && (Date.now() / 1000 - lastTs) < 120);
  const done = toNum(a.done);
  const startTs = a.start_ts != null ? toNum(a.start_ts) : null;
  const live = {
    status: running ? 'running' : 'idle', country: ccs.join(',') || '—',
    mode: `${toNum(a.hosts)} machine(s) · session = last 3h`,
    done: pool ? Math.min(done, pool) : done, pool, last_ts: lastTs, start_ts: startTs,
    run_secs: (startTs && lastTs) ? Math.max(0, lastTs - startTs) : 0,
    gdn_ads: Math.max(gObs, gnew), gdn_new: gnew, native_ads: Math.max(nObs, nnew), native_new: nnew,
  };
  const lim = parseInt(limit, 10) || 100;
  const pagesRaw = await gA('SELECT UNIX_TIMESTAMP(last_crawled) ts, target_site site, url, country cc, os, '
    + 'last_gdn_ads n_gdn, last_native_ads n_native, last_total_ads n_total, status '
    + `FROM gdn_crawl_quality ${scopeWhere} ORDER BY last_crawled DESC LIMIT ${lim}`, sp);
  const pages = pagesRaw.map(p => ({ ts: toNum(p.ts), site: p.site, url: p.url, cc: p.cc, os: p.os,
    n_gdn: p.n_gdn == null ? null : toNum(p.n_gdn), n_native: p.n_native == null ? null : toNum(p.n_native),
    n_total: p.n_total == null ? null : toNum(p.n_total), status: p.status }));
  const creatives = toNum((await g1('SELECT COUNT(*) c FROM gdn_ad')).c);
  const runs = toNum((await g1(`SELECT COALESCE(SUM(total_crawls),0) c FROM gdn_crawl_quality ${scopeWhere}`, sp)).c);
  const ah = toNum((await g1('SELECT COUNT(*) c FROM gdn_ad WHERE created_date > (NOW()-INTERVAL 1 HOUR)')).c);
  const nh = toNum((await n1('SELECT COUNT(*) c FROM native_ad WHERE created_date > (NOW()-INTERVAL 1 HOUR)')).c);
  const todayNew = byHost ? 0 : toNum((await g1('SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=CURDATE()', [sid])).c);
  const act = await gA("SELECT COALESCE(host,'unknown') host, COALESCE(os,'unknown') os, COUNT(*) c FROM gdn_crawl_quality "
    + `WHERE last_crawled > (NOW()-INTERVAL 50 SECOND) AND ${sCol}=? GROUP BY host, os`, [sVal]);
  const fleet = act.length ? { text: act.map(r => `${r.host} [${r.os}] ~${toNum(r.c)} profiles crawling`).join(' · ') } : null;
  const profiles = toNum((await g1(`SELECT COUNT(*) c FROM gdn_crawl_quality WHERE last_crawled > (NOW()-INTERVAL 45 SECOND) AND ${sCol}=?`, [sVal])).c);
  return { live, pages, db: { creatives, runs }, ads_hr: ah + nh, gdn_hr: ah, native_hr: nh, today_new: todayNew, fleet, profiles };
}

async function gdnBuildOverview(sid, host) {
  const byHost = !!host;
  const sCol = byHost ? 'host' : 'provider';
  const sVal = byHost ? host : sid;
  const scopeWhere = byHost ? `WHERE ${sCol}=?` : '';
  const scopeAnd = byHost ? `AND ${sCol}=?` : '';
  const sp = byHost ? [sVal] : [];

  const gtot = toNum((await g1('SELECT COUNT(*) c FROM gdn_ad')).c);
  const ntot = toNum((await n1('SELECT COUNT(*) c FROM native_ad')).c);
  const ah24 = toNum((await g1('SELECT COUNT(*) c FROM gdn_ad WHERE created_date>=NOW()-INTERVAL 24 HOUR')).c);
  const cq = await g1(`SELECT COUNT(*) urls, COUNT(DISTINCT country) ccs, COALESCE(SUM(total_ads),0) ads FROM gdn_crawl_quality ${scopeWhere}`, sp);
  const nadv = toNum((await g1("SELECT COUNT(DISTINCT post_owner_id) c FROM gdn_ad WHERE post_owner_id IS NOT NULL")).c);
  const u24 = await g1('SELECT COUNT(*) total, COALESCE(SUM(last_gdn_ads>0),0) gdn, COALESCE(SUM(last_native_ads>0),0) native '
    + `FROM gdn_crawl_quality WHERE last_crawled >= NOW()-INTERVAL 24 HOUR AND ${sCol}=?`, [sVal]);
  const urls24h = { total: toNum(u24.total), gdn: toNum(u24.gdn), native: toNum(u24.native) };

  const live = await gA("SELECT COALESCE(provider,'unknown') provider, COUNT(*) urls, COUNT(DISTINCT country) countries, "
    + 'COALESCE(SUM(total_gdn_ads),0) gdn, COALESCE(SUM(total_native_ads),0) native, '
    + `SUM(status='zero' OR last_total_ads=0) zero_urls, MAX(UNIX_TIMESTAMP(last_crawled)) last_ts FROM gdn_crawl_quality ${scopeWhere} GROUP BY provider`, sp);
  let hist = [];
  try {
    // page_visits/runs are ISP-keyed (no host column) — skip in host mode.
    if (!byHost) hist = await gA("SELECT COALESCE(provider,'unknown') provider, COUNT(*) urls, 0 countries, "
      + 'COALESCE(SUM(n_gdn),0) gdn, COALESCE(SUM(n_native),0) native, '
      + 'SUM(COALESCE(n_ads,0)=0) zero_urls, MAX(ts) last_ts FROM page_visits GROUP BY provider');
  } catch (e) { hist = []; }
  let runsCc = {};
  try {
    if (!byHost) {
      const rc = await gA("SELECT COALESCE(provider,'unknown') provider, COUNT(DISTINCT proxy_country) c FROM runs GROUP BY provider");
      rc.forEach(r => { runsCc[r.provider] = toNum(r.c); });
    }
  } catch (e) { runsCc = {}; }
  const merged = {};
  [...hist, ...live].forEach(r => {
    const p = r.provider;
    const m = merged[p] || (merged[p] = { provider: p, urls: 0, countries: 0, gdn: 0, native: 0, zero_urls: 0, last_ts: 0 });
    m.urls += toNum(r.urls); m.gdn += toNum(r.gdn); m.native += toNum(r.native);
    m.zero_urls += toNum(r.zero_urls); m.last_ts = Math.max(m.last_ts, toNum(r.last_ts));
    m.countries = Math.max(m.countries, toNum(r.countries));
  });
  Object.values(merged).forEach(m => { if (!m.countries) m.countries = runsCc[m.provider] || 0; });
  const providers = Object.values(merged).sort((x, y) => y.gdn - x.gdn);

  const machinesRaw = await gA("SELECT COALESCE(host,'unknown') host, COALESCE(os,'unknown') os, COUNT(*) urls, COALESCE(SUM(total_gdn_ads),0) gdn, "
    + `COALESCE(SUM(total_native_ads),0) native, SUM(last_total_ads>0) hit FROM gdn_crawl_quality WHERE ${sCol}=? GROUP BY host, os ORDER BY gdn DESC`, [sVal]);
  const machines = machinesRaw.map(m => ({ host: m.host, os: m.os, urls: toNum(m.urls), gdn: toNum(m.gdn), native: toNum(m.native), hit: toNum(m.hit) }));

  const obs = await g1(`SELECT COALESCE(SUM(total_gdn_ads),0) g, COALESCE(SUM(total_native_ads),0) n FROM gdn_crawl_quality WHERE ${sCol}=?`, [sVal]);
  const gNew = byHost ? 0 : toNum((await g1('SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1', [sid])).c);
  const nNew = byHost ? 0 : toNum((await n1('SELECT COUNT(*) c FROM native_account_activities WHERE system_id=? AND is_unique=1', [sid])).c);
  const split = { g_obs: toNum(obs.g), n_obs: toNum(obs.n), g_new: gNew, n_new: nNew };

  const networks = (await nA("SELECT nw.network, COUNT(*) c FROM native_ad a JOIN networks nw ON a.network_id=nw.id "
    + "GROUP BY nw.network ORDER BY c DESC LIMIT 10")).map(r => ({ network: r.network, creatives: toNum(r.c) }));

  const byc = await gA("SELECT country, COUNT(*) urls, COALESCE(SUM(total_gdn_ads),0) gdn, COALESCE(SUM(total_native_ads),0) nat "
    + `FROM gdn_crawl_quality WHERE country<>'' ${scopeAnd} GROUP BY country ORDER BY gdn DESC`, sp);
  const countries = byc.map(r => ({ country: r.country, urls: toNum(r.urls), gdn: toNum(r.gdn), nat: toNum(r.nat) }));
  const bys = await gA('SELECT target_site site, COUNT(*) urls, COALESCE(SUM(total_ads),0) ads FROM gdn_crawl_quality '
    + `WHERE target_site<>'' ${scopeAnd} GROUP BY target_site ORDER BY ads DESC LIMIT 25`, sp);
  const sites = bys.map(r => ({ site: r.site, urls: toNum(r.urls), ads: toNum(r.ads) }));
  const adv = await gA("SELECT post_owner_name, ads_count FROM gdn_ad_post_owners WHERE post_owner_name<>'' ORDER BY ads_count DESC LIMIT 25");
  const advertisers = adv.map(r => ({ post_owner_name: r.post_owner_name, ads_count: toNum(r.ads_count) }));

  let proxyCountries = [];
  try {
    const pc = await gA('SELECT cc, name, supported FROM proxy_countries ORDER BY cc');
    proxyCountries = pc.map(r => ({ cc: r.cc, name: r.name, supported: toNum(r.supported) }));
  } catch (e) { proxyCountries = []; }

  const zuRaw = await gA('SELECT url, target_site site, country, os, UNIX_TIMESTAMP(last_crawled) ts, zero_streak '
    + `FROM gdn_crawl_quality WHERE (status='zero' OR last_total_ads=0) ${scopeAnd} ORDER BY last_crawled DESC LIMIT 40`, sp);
  const zeroUrls = {
    rows: zuRaw.map(r => ({ url: r.url, site: r.site, country: r.country, os: r.os, ts: toNum(r.ts), zero_streak: toNum(r.zero_streak) })),
    count: toNum((await g1(`SELECT COUNT(*) c FROM gdn_crawl_quality WHERE (status='zero' OR last_total_ads=0) ${scopeAnd}`, sp)).c),
  };

  const throughput = byHost ? { fg_hr: 0, fn_hr: 0, fg_day: 0, fn_day: 0 } : {
    fg_hr: toNum((await g1('SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=NOW()-INTERVAL 1 HOUR', [sid])).c),
    fn_hr: toNum((await n1('SELECT COUNT(*) c FROM native_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=NOW()-INTERVAL 1 HOUR', [sid])).c),
    fg_day: toNum((await g1('SELECT COUNT(*) c FROM gdn_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=CURDATE()', [sid])).c),
    fn_day: toNum((await n1('SELECT COUNT(*) c FROM native_account_activities WHERE system_id=? AND is_unique=1 AND created_at>=CURDATE()', [sid])).c),
  };

  let proxyQuality = { rows: [], totals: {} };
  try {
    const ph = await gA('SELECT country, COUNT(*) ips, COALESCE(SUM(urls_crawled>0),0) used, '
      + 'COALESCE(SUM(ads_total),0) ads, COALESCE(SUM(urls_crawled),0) urls FROM proxy_health GROUP BY country ORDER BY ads DESC, ips DESC');
    const pqt = await g1('SELECT COUNT(*) ips, COALESCE(SUM(ads_total),0) ads, COALESCE(SUM(urls_crawled),0) urls, '
      + 'COALESCE(SUM(urls_crawled>0),0) used FROM proxy_health');
    proxyQuality = {
      rows: ph.map(r => ({ country: r.country, ips: toNum(r.ips), used: toNum(r.used), ads: toNum(r.ads), urls: toNum(r.urls) })),
      totals: { ips: toNum(pqt.ips), ads: toNum(pqt.ads), urls: toNum(pqt.urls), used: toNum(pqt.used) },
    };
  } catch (e) { proxyQuality = { rows: [], totals: {} }; }

  return {
    totals: { gtot, ntot, ah24, urls: toNum(cq.urls), ccs: toNum(cq.ccs), total_ads: toNum(cq.ads), advertisers: nadv },
    urls_24h: urls24h, providers, machines, split, networks, countries, sites, advertisers,
    proxy_countries: proxyCountries, zero_urls: zeroUrls, throughput, proxy_quality: proxyQuality,
  };
}

async function gdnBenchmark(req, res) {
  // host = a single proxmox machine (system-card click); system_id = ISP/proxy
  // (network 📊 button, default). host takes precedence when present.
  const host = req.body?.host ? String(req.body.host) : null;
  const sid = (req.body?.system_id || 'decodo-isp').toString();
  const sessionSecs = parseInt(req.body?.session_secs, 10) || 10800;
  const limit = parseInt(req.body?.limit, 10) || 100;
  const cacheKey = `dash_gdnbench_${host || sid}_${sessionSecs}_${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const [liveData, overview] = await Promise.all([
      gdnBuildLive(sid, sessionSecs, limit, host),
      gdnBuildOverview(sid, host),
    ]);
    // gdnBuildLive returns { live, pages, ads_hr, gdn_hr, native_hr, today_new,
    // fleet, profiles, db } — flatten it so the frontend's gdnBenchmark.live /
    // .today_new / .ads_hr / .pages paths line up (it was double-nested before).
    const payload = { system_id: host || sid, scope: host ? 'host' : 'provider',
      generatedAt: new Date().toISOString(), overview, ...liveData };
    cache.set(cacheKey, payload, 15);
    return res.json(payload);
  } catch (e) {
    console.error('gdnBenchmark failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ---- YouTube monitoring benchmark (ported from pas_node_api youtube dashboard) -
//
// POST /dashboard/youtube-benchmark  { limit? }
// YouTube has NO crawl_quality / MySQL benchmark — its dashboard reads the
// ElasticSearch `youtube_ads_data` index. We query it DIRECTLY via the admin ES
// connection (searchAllInstances), faithfully replicating getOverview/getLive in
// pas_node_api/src/services/youtube/controllers/youtubeDashboardController.js.
const YT_ES = { es_id: 0, index: process.env.YT_INDEX || 'youtube_ads_data' };
// The youtube crawler's own live dashboard JSON — authoritative "running" status
// + the real live processing feed. ES is the fallback when this is unreachable.
const YT_LIVE_URL = process.env.YT_LIVE_URL || 'http://125.16.67.186:8081/api/youtube-live';
const YT_VD = ['VIDEO', 'DISCOVERY'];
const YT_THUMB = ['pasvideo', 'pasimage', 'bydefault', 'DefaultImage'].map((p) => ({ wildcard: { 'thumbnail_url.keyword': { value: `*${p}*` } } }));
const YT_NAS = ['pasvideo', 'pasimage', 'bydefault'].map((p) => ({ wildcard: { 'new_nas_image_url.keyword': { value: `*${p}*` } } }));
const YT_FINDABLE = { bool: { should: [
  { bool: { filter: [{ terms: { 'ad_type.keyword': YT_VD } }, { exists: { field: 'thumbnail_url' } }], must_not: YT_THUMB } },
  { bool: { filter: [{ exists: { field: 'new_nas_image_url' } }], must_not: [{ terms: { 'ad_type.keyword': YT_VD } }, ...YT_NAS] } },
], minimum_should_match: 1 } };
const YT_HAS_REDIRECT = { bool: { filter: [{ exists: { field: 'redirect_urls' } }], must_not: [{ term: { 'redirect_urls.keyword': '' } }] } };

const ytHits = (r) => r?.hits || r?.body?.hits || {};
const ytAggs = (r) => r?.aggregations || r?.body?.aggregations || {};
const ytTotal = (r) => { const t = ytHits(r).total; return typeof t === 'object' ? toNum(t?.value) : toNum(t); };
const ytBuckets = (a) => (a && a.buckets) || [];
function ytMergeWindowed(b1h, b24h, keyName) {
  const m = {};
  ytBuckets(b24h).forEach((b) => { const k = b.key || '(none)'; m[k] = { [keyName]: k, h1: 0, d1: toNum(b.doc_count) }; });
  ytBuckets(b1h).forEach((b) => { const k = b.key || '(none)'; m[k] = m[k] || { [keyName]: k, h1: 0, d1: 0 }; m[k].h1 = toNum(b.doc_count); });
  return Object.values(m).sort((a, z) => z.d1 - a.d1);
}
async function ytSearch(body) {
  const r = await searchAllInstances(YT_ES.index, body, YT_ES.es_id, 'search');
  return r?.data || {};
}
async function ytCount(query) {
  const r = await searchAllInstances(YT_ES.index, { query }, YT_ES.es_id, 'count');
  return toNum(r?.data);
}

async function youtubeBenchmark(req, res) {
  const limit = Math.min(parseInt(req.body?.limit, 10) || 250, 500);
  const cacheKey = `dash_ytbench_${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const now = Math.floor(Date.now() / 1000);
  try {
    // ----- overview -----
    const TY = { field: 'ad_type.keyword', size: 15 };
    const PO = { field: 'ad_position.keyword', size: 20 };
    const aggRes = await ytSearch({
      size: 0, track_total_hits: true, query: { match_all: {} },
      aggs: {
        by_type: { terms: TY }, by_position: { terms: PO },
        w1h: { filter: { range: { last_seen: { gte: now - 3600 } } }, aggs: { t: { terms: TY }, p: { terms: PO } } },
        w24h: { filter: { range: { last_seen: { gte: now - 86400 } } }, aggs: { t: { terms: TY }, p: { terms: PO } } },
      },
    });
    const total = ytTotal(aggRes);
    const aggs = ytAggs(aggRes);
    const [ads1h, ads24h, new1h, new24h, findable, withChain] = await Promise.all([
      ytCount({ range: { last_seen: { gte: now - 3600 } } }),
      ytCount({ range: { last_seen: { gte: now - 86400 } } }),
      ytCount({ range: { first_seen: { gte: now - 3600 } } }),
      ytCount({ range: { first_seen: { gte: now - 86400 } } }),
      ytCount(YT_FINDABLE),
      ytCount(YT_HAS_REDIRECT),
    ]);
    const overview = {
      totals: { total, ads_1h: ads1h, ads_24h: ads24h, findable, shown_pct: total ? Number((100 * findable / total).toFixed(1)) : 0 },
      unique: { new_1h: new1h, dup_1h: Math.max(0, ads1h - new1h), new_24h: new24h, dup_24h: Math.max(0, ads24h - new24h) },
      redirect_chain: { with_chain: withChain, pct: total ? Number((100 * withChain / total).toFixed(2)) : 0 },
      by_type: ytBuckets(aggs.by_type).map((b) => ({ type: b.key || '(none)', count: toNum(b.doc_count) })),
      by_position: ytBuckets(aggs.by_position).map((b) => ({ position: b.key || '(none)', count: toNum(b.doc_count) })),
      by_type_win: ytMergeWindowed(aggs.w1h && aggs.w1h.t, aggs.w24h && aggs.w24h.t, 'type'),
      by_position_win: ytMergeWindowed(aggs.w1h && aggs.w1h.p, aggs.w24h && aggs.w24h.p, 'position'),
    };

    // ----- live -----
    const liveRes = await ytSearch({
      size: limit, sort: [{ last_seen: { order: 'desc' } }, { ad_id: 'desc' }],
      _source: ['ad_id', 'ad_type', 'ad_position', 'post_owner', 'destination_url', 'redirect_urls', 'last_seen', 'first_seen', 'source'],
      query: { match_all: {} },
    });
    let multiHop = 0;
    let pages = (ytHits(liveRes).hits || []).map((h) => {
      const s = h._source || {};
      const rv = s.redirect_urls;
      const chain = Array.isArray(rv) ? rv.filter(Boolean).map(String) : (rv ? [String(rv)] : []);
      if (chain.length > 1) multiHop += 1;
      return { ts: toNum(s.last_seen), ad_id: s.ad_id, ad_type: s.ad_type || '', ad_position: s.ad_position || '',
        advertiser: s.post_owner || '—', url: s.destination_url || '', hops: chain.length, chain,
        first_seen: toNum(s.first_seen), source: Array.isArray(s.source) ? s.source.join(',') : (s.source || '') };
    });
    const [l1h, l3h, l24h, n1h, n3h, n24h] = await Promise.all([
      ytCount({ range: { last_seen: { gte: now - 3600 } } }),
      ytCount({ range: { last_seen: { gte: now - 10800 } } }),
      ytCount({ range: { last_seen: { gte: now - 86400 } } }),
      ytCount({ range: { first_seen: { gte: now - 3600 } } }),
      ytCount({ range: { first_seen: { gte: now - 10800 } } }),
      ytCount({ range: { first_seen: { gte: now - 86400 } } }),
    ]);
    const lastTs = pages.length ? pages[0].ts : null;
    let live = {
      status: lastTs && (now - lastTs) < 300 ? 'running' : 'idle',
      ads_1h: l1h, ads_3h: l3h, ads_24h: l24h,
      dup_1h: Math.max(0, l1h - n1h), dup_3h: Math.max(0, l3h - n3h), dup_24h: Math.max(0, l24h - n24h),
      new_1h: n1h, new_3h: n3h, new_24h: n24h, last_ts: lastTs, multi_hop: multiHop,
    };

    // Prefer the crawler's OWN live endpoint — it knows the true "running" status
    // and the real processing feed right now. ES (above) stays as the fallback.
    let live_source = 'es';
    try {
      const r = await axios.get(YT_LIVE_URL, { timeout: 8000 });
      if (r.data && r.data.live) {
        live = { ...live, ...r.data.live };
        live_source = 'crawler';
        if (Array.isArray(r.data.pages) && r.data.pages.length) {
          pages = r.data.pages.map((p) => ({
            ts: toNum(p.ts), ad_id: p.ad_id, ad_type: p.ad_type || '', ad_position: p.ad_position || '',
            advertiser: p.advertiser || '—', url: p.url || '', hops: toNum(p.hops),
            chain: Array.isArray(p.chain) ? p.chain : [], first_seen: toNum(p.first_seen),
            source: Array.isArray(p.source) ? p.source.join(',') : (p.source || ''),
          }));
        }
      }
    } catch (e) {
      console.warn('youtube-live endpoint unreachable, using ES live:', e.message);
    }

    const payload = { generatedAt: new Date().toISOString(), index: YT_ES.index, live_source, overview, live, pages };
    cache.set(cacheKey, payload, 20);
    return res.json(payload);
  } catch (e) {
    console.error('youtubeBenchmark failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ---- OCR processing analytics (Prometheus) -------------------------------
//
// POST /dashboard/ocr  { range }
// Ports the "OCR" Grafana dashboard (grafana.poweradspy.ai, datasource kT4VkhPnk
// = the SAME prometheus.poweradspy.ai we already read via PROM_BASE) into the
// System Info page. The OCR workers expose two pull-scraped counters:
//   ocr_status_total{platform,status,code,instance}
//       code "0"      = image processed OK
//       code "1|2|3"  = processed but failed (no image / ocr error / …)
//   ocr_request_status_total{platform,status,instance}
//       status "urls found" / "no urls found"  = the get-image-URL stage
// NOTE: unlike the crawler metrics these carry NO `mode` label — do not add one.
// Everything is fail-safe: a missing/empty Prometheus just yields zeros.

// Window for the OCR queries — MATCHES the OCR Grafana dashboard exactly.
// Every panel there hardcodes a trailing `increase(...[24h])` reduced to the last
// point (reduceOptions.lastNotNull), so it always shows the last 24 hours,
// anchored at the END of the selected range (the range length is ignored). We
// mirror that: a fixed 24h window evaluated AT the end of the `to` day (clamped
// to now for "today"). Prometheus `increase(metric[24h])` @ T = increase over
// [T-24h, T].
const OCR_WINDOW_SEC = 24 * 3600;
function ocrWindow(range) {
  const { fromDay, toDay } = dayBounds(range);
  let toEnd = Math.floor(new Date(`${toDay}T23:59:59Z`).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (toEnd > now) toEnd = now;            // "today" -> anchor on now, no future window
  return { winSec: OCR_WINDOW_SEC, atUnix: toEnd, fromDay, toDay };
}

function ocrQuery(metric, filter, winSec, agg) {
  const sel = filter ? `${metric}{${filter}}` : metric;
  const inner = `increase(${sel}[${winSec}s])`;
  return `${agg}(${inner})`;
}

// sum by (<label>) (increase(<metric>{<filter>}[W])) -> { <label value>: number }
async function ocrSumBy(metric, byLabel, filter, winSec, atUnix) {
  const out = {};
  try {
    const r = await instantQuery(ocrQuery(metric, filter, winSec, `sum by (${byLabel})`), atUnix);
    for (const s of (r.data?.result || [])) {
      const k = s.metric?.[byLabel];
      const v = Number(s.value?.[1]);
      if (k != null && k !== '' && Number.isFinite(v)) out[k] = (out[k] || 0) + v;
    }
  } catch (e) { /* fail-safe */ }
  return out;
}

const round = (v) => Math.round(Number(v) || 0);
const pct = (a, b) => (b > 0 ? Number(((100 * a) / b).toFixed(1)) : 0);

async function ocr(req, res) {
  const range = req.body?.range || {};
  const { winSec, atUnix, fromDay, toDay } = ocrWindow(range);

  const cacheKey = `dash_ocr_${fromDay}_${toDay}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  if (!PROM_BASE) {
    const payload = { available: false, reason: 'PROMETHEUS_URL not set',
      window: { from: fromDay, to: toDay }, totals: {}, platforms: [], instances: [], statuses: [] };
    return res.json(payload);
  }

  // All fail-safe + parallel.
  const [succByPlat, failByPlat, urlsByPlat, noUrlsByPlat,
         succByInst, failByInst, statusAll] = await Promise.all([
    ocrSumBy('ocr_status_total', 'platform', `code="0"`, winSec, atUnix),
    ocrSumBy('ocr_status_total', 'platform', `code=~"1|2|3"`, winSec, atUnix),
    ocrSumBy('ocr_request_status_total', 'platform', `status="urls found"`, winSec, atUnix),
    ocrSumBy('ocr_request_status_total', 'platform', `status="no urls found"`, winSec, atUnix),
    ocrSumBy('ocr_status_total', 'instance', `code="0"`, winSec, atUnix),
    ocrSumBy('ocr_status_total', 'instance', `code=~"1|2|3"`, winSec, atUnix),
    ocrSumBy('ocr_status_total', 'status', '', winSec, atUnix),
  ]);

  // ---- per-platform rollup (union of every platform seen across the maps) ----
  const platKeys = [...new Set([
    ...Object.keys(succByPlat), ...Object.keys(failByPlat),
    ...Object.keys(urlsByPlat), ...Object.keys(noUrlsByPlat),
  ])];
  const platforms = platKeys.map((p) => {
    const successful = round(succByPlat[p]);
    const unsuccessful = round(failByPlat[p]);
    const processed = successful + unsuccessful;
    return {
      platform: p,
      processed, successful, unsuccessful,
      success_rate: pct(successful, processed),
      urls_found: round(urlsByPlat[p]),
      no_urls_found: round(noUrlsByPlat[p]),
    };
  }).sort((a, b) => b.processed - a.processed);

  // ---- per-instance (system-wise) rollup -------------------------------------
  const instKeys = [...new Set([...Object.keys(succByInst), ...Object.keys(failByInst)])];
  const instances = instKeys.map((i) => {
    const successful = round(succByInst[i]);
    const unsuccessful = round(failByInst[i]);
    const processed = successful + unsuccessful;
    return { instance: i, processed, successful, unsuccessful, success_rate: pct(successful, processed) };
  }).sort((a, b) => b.processed - a.processed);

  // ---- overall status breakdown (every textual status, e.g. success / no image) ----
  const statuses = Object.entries(statusAll)
    .map(([status, v]) => ({ status, count: round(v) }))
    .sort((a, b) => b.count - a.count);

  const successful = platforms.reduce((x, p) => x + p.successful, 0);
  const unsuccessful = platforms.reduce((x, p) => x + p.unsuccessful, 0);
  const processed = successful + unsuccessful;
  const urls_found = platforms.reduce((x, p) => x + p.urls_found, 0);
  const no_urls_found = platforms.reduce((x, p) => x + p.no_urls_found, 0);

  const payload = {
    available: processed > 0 || instances.length > 0,
    generatedAt: new Date().toISOString(),
    window: { from: fromDay, to: toDay },
    totals: {
      processed, successful, unsuccessful,
      success_rate: pct(successful, processed),
      urls_found, no_urls_found,
      instances: instances.length,
    },
    platforms,
    instances,
    statuses,
  };
  cache.set(cacheKey, payload, 60);
  return res.json(payload);
}

module.exports = { overview, systemDrill, accountsOverview, accountTimeline, platforms, systemDebug, gdnBenchmark, youtubeBenchmark, exporterHealth, ocr };

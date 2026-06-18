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

async function instantQuery(promql) {
  if (!PROM_BASE) return { data: { result: [] } };
  const url = `${PROM_BASE}/api/v1/query?query=${encodeURIComponent(promql)}`;
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

  const params = [fromSql, toSql];
  let platClause = '';
  if (Array.isArray(platform) && platform.length) {
    platClause = ` AND platform IN (${platform.map(() => '?').join(',')})`;
    params.push(...platform);
  }
  const acctSel = cfg.hasAccount
    ? 'COUNT(DISTINCT account_id) AS accounts, GROUP_CONCAT(DISTINCT account_id) AS account_ids'
    : "0 AS accounts, '' AS account_ids";

  const sql = `SELECT system_id,
      ${acctSel},
      COUNT(*) AS ads,
      COALESCE(SUM(is_unique),0) AS unique_ads,
      MAX(created_at) AS last_active
    FROM \`${cfg.acts}\`
    WHERE created_at BETWEEN ? AND ?${platClause}
    GROUP BY system_id`;

  const rows = await queryDatabase(cfg.db_id, dbName, sql, params);
  return { net, rows: rows || [] };
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

// system_id -> [hostnames] via Prometheus scroll_plugin_counter_total.account_id.
async function buildHostMap(acctToSystem) {
  const sysToHosts = {};
  try {
    const pc = await instantQuery(`scroll_plugin_counter_total{mode="${mode}"}`);
    for (const s of (pc.data?.result || [])) {
      const host = s.metric?.server_name;
      const acct = s.metric?.account_id != null ? String(s.metric.account_id) : '';
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
  const map = new Map();
  try {
    const r = await instantQuery(`scroll_plugin_counter_total{mode="${mode}"}`);
    for (const s of (r.data?.result || [])) {
      const id = s.metric?.account_id;
      if (id == null) continue;
      const k = String(id);
      if (!map.has(k)) {
        map.set(k, { account_name: s.metric?.account_name || null, server_name: s.metric?.server_name || null });
      }
    }
  } catch (e) { /* non-fatal */ }
  return map;
}

// Set of account_ids whose heartbeat increased in the last ~2 min => live now.
async function liveAccountIds() {
  const set = new Set();
  try {
    const r = await instantQuery(`increase(account_active_hb_total{mode="${mode}"}[120s]) > 0`);
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

async function overview(req, res) {
  const range = req.body?.range || {};
  const platform = req.body?.platform;
  const activeWindowMin = toNum(req.body?.activeWindowMin) || 10;
  const { fromSql, toSql, fromDay, toDay } = dayBounds(range);

  const platKey = Array.isArray(platform) && platform.length ? platform.slice().sort().join('-') : 'all';
  const cacheKey = `dash_overview_${fromDay}_${toDay}_${platKey}_${activeWindowMin}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  // 1) DB rollups per network (each fail-safe).
  const rollups = await Promise.all(
    NET_KEYS.map(net => networkRollup(net, fromSql, toSql, platform).catch(err => {
      console.error(`dashboard rollup ${net} failed:`, err.message);
      return { net, rows: [] };
    }))
  );

  // 2a) account→system bridge (for hostname + status). ES gives the headline
  // ad counts (below); per-system numbers come from the DB activities rollup.
  const acctToSystem = await buildAccountBridge(range).catch(() => new Map());

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
         cycles5m, ytProc5m, gdnCap5m, nativeCap5m, pluginEvt5m] = await Promise.all([
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
      const acctIds = (r.account_ids ? String(r.account_ids).split(',') : []).filter(Boolean);
      const lastActive = r.last_active ? new Date(r.last_active).getTime() : 0;
      if (lastActive && (!lastNet || lastActive > lastNet)) lastNet = lastActive;
      nAccounts += accts; nAds += ads; nUnique += uniq;

      let s = systems.get(sid);
      if (!s) {
        s = { system_id: sid, networks: [], accounts: 0, ads: 0, unique_ads: 0,
              last_active_ms: 0, account_ids: new Set(), perNetwork: {} };
        systems.set(sid, s);
      }
      if (!s.networks.includes(net)) s.networks.push(net);
      s.accounts += accts; s.ads += ads; s.unique_ads += uniq;
      if (lastActive > s.last_active_ms) s.last_active_ms = lastActive;
      acctIds.forEach(a => s.account_ids.add(a));
      s.perNetwork[net] = { accounts: accts, ads, unique_ads: uniq,
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
    systemRows.push({
      system_id: s.system_id,
      hostname: host,
      hostnames: hosts,
      networks: s.networks,
      accounts: s.accounts,
      ads: s.ads,
      unique_ads: s.unique_ads,
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

  cache.set(cacheKey, payload, 20); // short TTL so "live" auto-refresh stays cheap
  return res.json(payload);
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

  await Promise.all(NET_KEYS.map(async (net) => {
    const cfg = NETS[net];
    const dbName = process.env[cfg.env];
    if (!dbName) return;
    const params = [system_id, fromSql, toSql];
    let platClause = '';
    if (Array.isArray(platform) && platform.length) {
      platClause = ` AND platform IN (${platform.map(() => '?').join(',')})`;
      params.push(...platform);
    }
    try {
      if (cfg.hasAccount) {
        const sql = `SELECT account_id, COUNT(*) AS ads, COALESCE(SUM(is_unique),0) AS unique_ads,
            MAX(created_at) AS last_active
          FROM \`${cfg.acts}\`
          WHERE system_id = ? AND created_at BETWEEN ? AND ?${platClause}
          GROUP BY account_id ORDER BY ads DESC`;
        const rows = await queryDatabase(cfg.db_id, dbName, sql, params);
        let nAds = 0, nUniq = 0, last = 0;
        for (const r of (rows || [])) {
          const la = r.last_active ? new Date(r.last_active).getTime() : 0;
          nAds += toNum(r.ads); nUniq += toNum(r.unique_ads); if (la > last) last = la;
          accounts.push({
            account_id: r.account_id, network: net,
            ads: toNum(r.ads), unique_ads: toNum(r.unique_ads),
            last_active: la ? new Date(la).toISOString() : null,
            last_active_ago_sec: la ? Math.round((nowMs - la) / 1000) : null,
          });
        }
        if ((rows || []).length) {
          perNetwork.push({ network: net, accounts: rows.length, ads: nAds, unique_ads: nUniq,
            last_active: last ? new Date(last).toISOString() : null });
        }
      } else {
        const sql = `SELECT COUNT(*) AS ads, COALESCE(SUM(is_unique),0) AS unique_ads, MAX(created_at) AS last_active
          FROM \`${cfg.acts}\`
          WHERE system_id = ? AND created_at BETWEEN ? AND ?${platClause}`;
        const rows = await queryDatabase(cfg.db_id, dbName, sql, params);
        const r = rows && rows[0];
        if (r && toNum(r.ads) > 0) {
          const la = r.last_active ? new Date(r.last_active).getTime() : 0;
          perNetwork.push({ network: net, accounts: 0, ads: toNum(r.ads), unique_ads: toNum(r.unique_ads),
            last_active: la ? new Date(la).toISOString() : null });
        }
      }
    } catch (e) {
      console.error(`system drill ${net} failed:`, e.message);
    }
  }));

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
    a.name = dbName || p?.account_name || null;
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
    const r = await axios.get(SEND_METRICS_URL, {
      timeout: 10000,
      responseType: 'text',
      maxContentLength: 60 * 1024 * 1024, // guard: don't choke on a huge blob
      transformResponse: [(d) => d],       // keep as raw text
    });
    const text = typeof r.data === 'string' ? r.data : String(r.data || '');
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
      all_metric_names: allNames,    // full list (for mapping)
    };
    cache.set(cacheKey, payload, 15);
    return res.json(payload);
  } catch (e) {
    const payload = { up: false, configured: true, url: SEND_METRICS_URL,
      latency_ms: Date.now() - t0, error: e.message };
    cache.set(cacheKey, payload, 10);
    return res.json(payload);
  }
}

module.exports = { overview, systemDrill, accountsOverview, accountTimeline, platforms, systemDebug, exporterHealth };

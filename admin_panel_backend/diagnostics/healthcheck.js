/**
 * Prometheus + DB health-check / diagnostic script.
 *
 * RUN THIS ON THE PROD SERVER (where prod MySQL + Prometheus are reachable):
 *
 *     cd admin_panel_backend
 *     node diagnostics/healthcheck.js
 *
 * Optional overrides (compare a candidate Prometheus URL without touching .env):
 *
 *     node diagnostics/healthcheck.js --prom=https://prometheus.poweradspy.ai
 *     node diagnostics/healthcheck.js --prom=https://prometheus.poweradspy.ai --net=facebook --days=2
 *
 * It is READ-ONLY: no writes to DB / Prometheus / files. It mirrors the exact
 * queries used by src/system-metrics.js so the output maps 1:1 to real behaviour.
 * Paste the full output back and I'll pinpoint the fix.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');

// ---- tiny arg parser -------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);

const ENV_PROM = process.env.PROMETHEUS_URL || '';
const PROM = (args.prom || ENV_PROM || '').replace(/\/+$/, ''); // strip trailing slash
const NET = args.net || 'facebook';
const DAYS = parseInt(args.days, 10) || 1;
const NODE_ENV = process.env.NODE_ENV || 'development';
const MODE = NODE_ENV === 'production' ? 'prod' : 'dev'; // <-- exact same logic as system-metrics.js
const NETWORKS = process.env.NETWORKS ? process.env.NETWORKS.split(',') : [];
const HTTP_TIMEOUT = 15000;

// ---- pretty logging --------------------------------------------------------
const line = (c = '─') => console.log(c.repeat(78));
function head(t) { line('═'); console.log('  ' + t); line('═'); }
function sub(t) { console.log('\n• ' + t); }
const ok = (m) => console.log('   ✅ ' + m);
const bad = (m) => console.log('   ❌ ' + m);
const warn = (m) => console.log('   ⚠️  ' + m);
const info = (m) => console.log('   •  ' + m);

// ---- prometheus helpers ----------------------------------------------------
async function promInstant(base, query) {
  const url = `${base}/api/v1/query?query=${encodeURIComponent(query)}`;
  const t = Date.now();
  const r = await axios.get(url, { timeout: HTTP_TIMEOUT });
  return { ms: Date.now() - t, result: r.data?.data?.result || [], status: r.data?.status };
}
async function promRange(base, query, start, end, step) {
  const url = `${base}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${step}`;
  const t = Date.now();
  const r = await axios.get(url, { timeout: HTTP_TIMEOUT });
  return { ms: Date.now() - t, result: r.data?.data?.result || [], status: r.data?.status };
}

function dateRange(days) {
  const to = new Date();
  const from = new Date(Date.now() - days * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

// ===========================================================================
async function main() {
  head('PAS ADMIN — PROMETHEUS + DB HEALTHCHECK');
  info(`NODE_ENV            = ${NODE_ENV}`);
  info(`computed mode       = "${MODE}"   (queries that use \${mode} will filter mode="${MODE}")`);
  info(`PROMETHEUS_URL(.env)= ${ENV_PROM || '(unset)'}`);
  info(`Prometheus tested   = ${PROM || '(NONE!)'}`);
  info(`NETWORKS(.env)      = [${NETWORKS.join(', ')}]`);
  info(`sample network      = ${NET}   |  range days = ${DAYS}`);

  if (!PROM) { bad('No Prometheus URL. Pass --prom=<url> or set PROMETHEUS_URL.'); process.exit(1); }

  // -------------------------------------------------------------------------
  head('1) PROMETHEUS CONNECTIVITY');
  let promAlive = false;
  try {
    const r = await promInstant(PROM, 'up');
    promAlive = r.status === 'success';
    ok(`reachable — /api/v1/query?query=up → ${r.status} (${r.ms}ms, ${r.result.length} series)`);
  } catch (e) {
    bad(`UNREACHABLE: ${e.code || ''} ${e.message}`);
    warn('This alone breaks ALL system/account status. Fix PROMETHEUS_URL first, then re-run.');
  }

  if (promAlive) {
    // ---------------------------------------------------------------------
    head('2) MODE LABEL REALITY (why account/system data may be empty)');
    try {
      const r = await promInstant(PROM, 'count(scroll_plugin_counter_total) by (mode)');
      sub('scroll_plugin_counter_total series count per mode:');
      r.result.forEach(s => info(`mode="${s.metric.mode ?? '<nil>'}" → ${s.value[1]} series`));
      const live = r.result.sort((a, b) => +b.value[1] - +a.value[1])[0];
      if (live) {
        if (live.metric.mode !== MODE) {
          bad(`Live data is mostly mode="${live.metric.mode}", but code computes mode="${MODE}".`);
          bad(`→ systemActive() & pluginWithChart() filter mode="${MODE}" and will return little/no data.`);
        } else {
          ok(`Live mode ("${live.metric.mode}") matches computed mode ("${MODE}").`);
        }
      }
    } catch (e) { bad(`mode probe failed: ${e.message}`); }

    // ---------------------------------------------------------------------
    head('3) SYSTEM STATUS METRICS (on/off realtime)');

    // 3a. systemActive() discovery query — EXACT query from code
    sub(`systemActive discovery:  scroll_plugin_counter_total{network="${NET}",mode="${MODE}"}`);
    try {
      const r = await promInstant(PROM, `scroll_plugin_counter_total{network="${NET}",mode="${MODE}"}`);
      const systems = [...new Set(r.result.map(s => s.metric.server_name).filter(Boolean))];
      (systems.length ? ok : bad)(`${r.result.length} series → ${systems.length} distinct systems`);
      if (systems.length) info('systems: ' + systems.slice(0, 12).join(', ') + (systems.length > 12 ? ' …' : ''));
    } catch (e) { bad(e.message); }

    // 3b. same but mode="prod" — to prove the mode theory
    if (MODE !== 'prod') {
      sub(`SAME query but mode="prod" (proof):  scroll_plugin_counter_total{network="${NET}",mode="prod"}`);
      try {
        const r = await promInstant(PROM, `scroll_plugin_counter_total{network="${NET}",mode="prod"}`);
        const systems = [...new Set(r.result.map(s => s.metric.server_name).filter(Boolean))];
        info(`${r.result.length} series → ${systems.length} distinct systems with mode="prod"`);
      } catch (e) { bad(e.message); }
    }

    // 3c. system heartbeat (the actual on/off signal) — code uses irate(...[90s]) over last 30m
    sub('system heartbeat:  system_active_hb_total  (does it carry a mode label?)');
    try {
      const r = await promInstant(PROM, 'system_active_hb_total');
      const modes = [...new Set(r.result.map(s => s.metric.mode ?? '<none>'))];
      const systems = [...new Set(r.result.map(s => s.metric.server_name).filter(Boolean))];
      ok(`${r.result.length} series, ${systems.length} systems reporting heartbeat`);
      info(`mode labels on system hb: ${modes.join(', ')}  (heartbeat query does NOT filter mode → fine)`);
      // recency: how fresh is the newest sample
      const now = Math.floor(Date.now() / 1000);
      const newest = Math.max(...r.result.map(s => +s.value[0]));
      info(`newest system hb sample age: ${now - Math.floor(newest)}s`);
    } catch (e) { bad(e.message); }

    // 3d. active set via irate (exact code expression), last 30 min
    sub('active systems via:  irate(system_active_hb_total[90s])  over last 30m');
    try {
      const end = new Date().toISOString();
      const start = new Date(Date.now() - 30 * 60000).toISOString();
      const r = await promRange(PROM, 'irate(system_active_hb_total[90s])', start, end, '90s');
      const active = r.result.filter(s => (s.values || []).some(v => parseFloat(v[1]) > 0))
        .map(s => s.metric.server_name);
      ok(`${active.length} systems currently ACTIVE (irate>0): ${active.slice(0, 12).join(', ')}${active.length > 12 ? ' …' : ''}`);
    } catch (e) { bad(e.message); }

    // ---------------------------------------------------------------------
    head('4) ACCOUNT STATUS METRICS');

    sub('account heartbeat:  increase(account_active_hb_total[100s]) > 0');
    try {
      const r = await promInstant(PROM, 'increase(account_active_hb_total[100s]) > 0');
      const accts = [...new Set(r.result.map(s => s.metric.account_id).filter(Boolean))];
      const modes = [...new Set(r.result.map(s => s.metric.mode ?? '<none>'))];
      (accts.length ? ok : bad)(`${r.result.length} series → ${accts.length} accounts with a recent active heartbeat`);
      info(`mode labels on account hb: ${modes.join(', ')}`);
    } catch (e) { bad(e.message); }

    sub('account ads counter (accountsMetrics uses mode="prod" hardcoded here):');
    try {
      const r = await promInstant(PROM, `count(scroll_plugin_counter_total{network="${NET}",mode="prod"}) by (account_id)`);
      info(`${r.result.length} distinct ${NET} account_ids present in Prometheus (mode="prod")`);
    } catch (e) { bad(e.message); }
  }

  // -------------------------------------------------------------------------
  head('5) MySQL / DB CONNECTIVITY + ACCOUNT DATA');
  let queryDatabase, adCountAcrossSelectedNetworks;
  try {
    adCountAcrossSelectedNetworks = require('../utils/db-query-metrics').adCountAcrossSelectedNetworks;
    queryDatabase = require('../db-connections/connection');
    ok('db modules loaded');
  } catch (e) {
    bad(`could not load db modules: ${e.message}`);
  }

  let dbAccountIds = [];
  if (adCountAcrossSelectedNetworks) {
    const range = dateRange(DAYS);
    sub(`adCountAcrossSelectedNetworks({from:${range.from},to:${range.to}}, ['${NET}'], 'accountMetrics')`);
    try {
      const res = await adCountAcrossSelectedNetworks(range, [NET], 'accountMetrics', null);
      const block = (res || []).find(x => x && x.network === NET) || {};
      const q = block.query || [];
      const q3 = block.query3 || [];
      dbAccountIds = [...new Set(q.map(r => String(r.account_id)).filter(id => id && id !== 'N/A'))];
      const systems = [...new Set(q.map(r => r.system_name).filter(Boolean))];
      (q.length ? ok : bad)(`query rows: ${q.length}  |  query3(activities) rows: ${q3.length}`);
      info(`distinct systems from DB: ${systems.length}`);
      info(`distinct account_ids from DB: ${dbAccountIds.length}`);
      if (q[0]) info('sample row: ' + JSON.stringify(q[0]));
    } catch (e) {
      bad(`DB query failed: ${e.message}`);
    }
  }

  // -------------------------------------------------------------------------
  if (promAlive && dbAccountIds.length) {
    head('6) DB ↔ PROMETHEUS ACCOUNT OVERLAP  (why "account data nahi aata")');
    sub(`comparing ${NET} account_ids: DB vs Prometheus`);
    for (const m of [...new Set([MODE, 'prod'])]) {
      try {
        const r = await promInstant(PROM, `count(scroll_plugin_counter_total{network="${NET}",mode="${m}"}) by (account_id)`);
        const promIds = new Set(r.result.map(s => s.metric.account_id).filter(Boolean));
        const overlap = dbAccountIds.filter(id => promIds.has(id));
        const tag = overlap.length ? ok : bad;
        tag(`mode="${m}": prometheus has ${promIds.size} account_ids, overlap with DB(${dbAccountIds.length}) = ${overlap.length}`);
        if (!overlap.length && promIds.size) {
          const pSample = [...promIds].slice(0, 3);
          warn(`NO overlap. DB sample ids: ${dbAccountIds.slice(0, 3).join(', ')}  | Prom sample ids: ${pSample.join(', ')}`);
        }
      } catch (e) { bad(`mode="${m}" overlap check failed: ${e.message}`); }
    }
  }

  // -------------------------------------------------------------------------
  // Simulate the EXACT systemActive() flow to see why "active" is empty.
  // Frontend sends mode:"test"; backend systemActive() reads mode from req.body.
  head('7) systemActive() SIMULATION  (why "active" not showing)');
  if (promAlive && require('../utils/db-query-metrics').adCountAcrossSelectedNetworks) {
    const adFn = require('../utils/db-query-metrics').adCountAcrossSelectedNetworks;
    const range = dateRange(DAYS);
    const FE_MODE = 'test'; // <-- what the frontend actually sends (GlobalUiComponent.jsx)
    try {
      // (a) systems from DB (exact "systemActive" branch)
      const systemsFromAds = await adFn(range, [NET], 'systemActive', null);
      info(`DB systemsFromAds (system_name list): ${systemsFromAds.length}`);
      info('  DB sample: ' + systemsFromAds.slice(0, 8).join(', '));

      // (b) plugin systems with the mode the FRONTEND sends ("test") vs real ("prod")
      for (const m of [FE_MODE, 'prod']) {
        const r = await promInstant(PROM, `scroll_plugin_counter_total{network="${NET}",mode="${m}"}`);
        const sys = [...new Set(r.result.map(s => s.metric.server_name).filter(Boolean))];
        info(`plugin systems @ mode="${m}": ${sys.length}`);
      }

      // (c) active server_names from heartbeat (mode-agnostic, exactly like code)
      const end = new Date().toISOString();
      const start = new Date(Date.now() - 30 * 60000).toISOString();
      const hb = await promRange(PROM, 'irate(system_active_hb_total[90s])', start, end, '90s');
      const activeServerNames = new Set(
        hb.result.filter(s => (s.values || []).some(v => parseFloat(v[1]) > 0))
          .map(s => s.metric.server_name)
      );
      info(`heartbeat active server_names: ${activeServerNames.size}`);
      info('  HB sample: ' + [...activeServerNames].slice(0, 8).join(', '));

      // (d) OLD (buggy) logic: compare DB system_name directly to heartbeat server_name.
      const oldFinalActive = systemsFromAds.filter(s => activeServerNames.has(s));
      (oldFinalActive.length ? ok : bad)(`OLD logic finalActive (DB system_name ∩ heartbeat) = ${oldFinalActive.length}`);
      if (!oldFinalActive.length && systemsFromAds.length && activeServerNames.size) {
        warn('  → confirms join-key bug: DB ids ' + systemsFromAds.slice(0, 3).join(', ') +
             '  vs hosts ' + [...activeServerNames].slice(0, 3).join(', '));
      }

      // (e) NEW (fixed) logic: bridge system_id -> hostname via account_id on the
      //     plugin counter (mode="prod"), then check the hostname's heartbeat.
      const dbFull = await adFn(range, [NET], 'accountMetrics', null);
      const blk = (dbFull || []).find(x => x && x.network === NET) || {};
      const acctToSystem = new Map();
      for (const r of (blk.query || [])) {
        const acct = r.account_id != null ? String(r.account_id) : '';
        if (acct && acct !== 'N/A' && r.system_name) acctToSystem.set(acct, r.system_name);
      }
      const pc = await promInstant(PROM, `scroll_plugin_counter_total{network="${NET}",mode="prod"}`);
      const systemToHosts = new Map();
      for (const s of pc.result) {
        const host = s.metric.server_name;
        const acct = s.metric.account_id != null ? String(s.metric.account_id) : '';
        const sys = acctToSystem.get(acct);
        if (host && sys) {
          if (!systemToHosts.has(sys)) systemToHosts.set(sys, new Set());
          systemToHosts.get(sys).add(host);
        }
      }
      const newFinalActive = systemsFromAds.filter(sys => {
        const hosts = systemToHosts.get(sys);
        return hosts && [...hosts].some(h => activeServerNames.has(h));
      });
      const tag = newFinalActive.length ? ok : bad;
      tag(`NEW logic finalActive (bridged via account_id) = ${newFinalActive.length}   ← after fix`);
      info('  active sample: ' + newFinalActive.slice(0, 10).join(', '));
      info(`  systems mapped to a hostname: ${systemToHosts.size}/${systemsFromAds.length}`);
    } catch (e) { bad(`systemActive simulation failed: ${e.message}`); }
  }

  // -------------------------------------------------------------------------
  // Verify the accountsMetrics fixes: performance (ads counter) and heartbeat
  // both now key by account_id, so they should overlap the DB accounts heavily.
  head('8) accountsMetrics FIX VERIFICATION  (performance + active status)');
  if (promAlive && dbAccountIds.length) {
    try {
      // (a) ads counter WITH account_id in the `by` clause (the fixed query shape)
      const adsQ = `max by (account_id, account_name, network, server_name) (increase(scroll_plugin_counter_total{network="${NET}",mode="prod"}[24h]))`;
      const ads = await promInstant(PROM, adsQ);
      const adsIds = new Set(ads.result.map(s => s.metric.account_id).filter(Boolean));
      const perfOverlap = dbAccountIds.filter(id => adsIds.has(id));
      (perfOverlap.length ? ok : bad)(`PERFORMANCE: ads-counter account_ids ∩ DB = ${perfOverlap.length}/${dbAccountIds.length}  (perf now attaches to these)`);

      // (b) account heartbeat keyed by account_id
      const hb = await promInstant(PROM, 'increase(account_active_hb_total[100s]) > 0');
      const hbIds = new Set(hb.result.map(s => s.metric.account_id).filter(id => id && id !== '-'));
      const hbOverlap = dbAccountIds.filter(id => hbIds.has(id));
      (hbOverlap.length ? ok : bad)(`ACTIVE STATUS: heartbeat account_ids ∩ DB = ${hbOverlap.length}/${dbAccountIds.length}  (these show active)`);
    } catch (e) { bad(`accountsMetrics verification failed: ${e.message}`); }
  }

  // -------------------------------------------------------------------------
  // Verify the System Status Timeline fix: system_id must resolve to a hostname,
  // and the heartbeat timeline query must return data for that hostname.
  head('9) System Status Timeline FIX  (systemStateChart)');
  if (promAlive && require('../utils/db-query-metrics').adCountAcrossSelectedNetworks) {
    const adFn = require('../utils/db-query-metrics').adCountAcrossSelectedNetworks;
    const range = dateRange(DAYS);
    try {
      // build system_id -> hostname[] across all configured networks (same as backend)
      const dbResults = await Promise.all(NETWORKS.map(nw => adFn(range, [nw], null, null).catch(() => [])));
      const acctToSystem = new Map();
      for (const rows of dbResults) for (const r of (rows || [])) {
        if (r?.system_name && r.account_id && r.account_id !== 'N/A') acctToSystem.set(String(r.account_id), r.system_name);
      }
      const pc = await promInstant(PROM, `scroll_plugin_counter_total{mode="prod"}`);
      const sysToHosts = new Map();
      for (const s of pc.result) {
        const host = s.metric.server_name; const acct = s.metric.account_id != null ? String(s.metric.account_id) : '';
        const sys = acctToSystem.get(acct);
        if (host && sys) { if (!sysToHosts.has(sys)) sysToHosts.set(sys, new Set()); sysToHosts.get(sys).add(host); }
      }
      const allSys = [...new Set([...acctToSystem.values()])];
      (sysToHosts.size ? ok : bad)(`systems resolved to a hostname: ${sysToHosts.size}/${allSys.length}`);

      // pick one system and confirm its timeline query returns data
      const sample = [...sysToHosts.entries()][0];
      if (sample) {
        const [sys, hostSet] = sample;
        const hosts = [...hostSet];
        const escaped = hosts.map(h => h.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')).join('|');
        const end = Math.floor(Date.now() / 1000), start = end - DAYS * 86400;
        const tl = await promRange(PROM, `sum(increase(system_active_hb_total{server_name=~"${escaped}"}[135s]))`, start, end, 135);
        const pts = tl.result[0]?.values?.length || 0;
        info(`sample system "${sys}" -> hosts [${hosts.join(', ')}]`);
        (pts ? ok : bad)(`timeline points for "${sys}": ${pts}   (OLD query used server_name="${sys}" → 0)`);
      }
    } catch (e) { bad(`timeline verification failed: ${e.message}`); }
  }

  // -------------------------------------------------------------------------
  head('VERDICT HINTS');
  if (!promAlive) bad('Prometheus unreachable → THE root cause. Update PROMETHEUS_URL and re-run.');
  if (promAlive && MODE !== 'prod') {
    warn('mode mismatch detected: NODE_ENV is not "production" so mode="dev", but live data is "prod".');
    warn('→ systemActive() & pluginWithChart() will under-report. Either set NODE_ENV=production OR adjust the mode filter.');
  }
  line('═');
  console.log('Done. Paste this entire output back.');
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

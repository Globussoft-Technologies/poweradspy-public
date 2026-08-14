'use strict';

/**
 * Diagnose why Market Trends (/api/v1/intelligence/trends/*) is slow.
 *
 * marketTrends.js fans a SINGLE panel request out to up to 10-11 networks in
 * parallel via Promise.all — each network usually lives on its OWN Elasticsearch
 * cluster. Promise.all waits for the SLOWEST one, and the ES client's default
 * requestTimeout is 30s (src/database/DatabaseManager.js) — so if even ONE
 * network's cluster is slow/degraded/unreachable, EVERY panel on the page waits
 * for it, not just that network's data. This script times a representative call
 * per network so the slow one(s) can be identified directly instead of guessed.
 *
 * Read-only (max/terms aggregations only).
 *
 * Usage:
 *   node scripts/diagnose-market-trends.js
 */

require('dotenv').config();
const networksConfig = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');
const serviceRegistry = require('../src/services/ServiceRegistry');

const TREND_NETWORKS = ['facebook', 'instagram', 'google', 'youtube', 'linkedin', 'gdn', 'native', 'reddit', 'quora', 'pinterest', 'tiktok'];
const NET_DATE_CANDIDATES = {
  facebook: ['facebook_ad.last_seen'],
  instagram: ['instagram_ad.last_seen'],
  google: ['last_seen'],
  youtube: ['last_seen'],
  linkedin: ['last_seen'],
  gdn: ['last_seen', 'gdn_ad.last_seen'],
  native: ['last_seen', 'native_ad.last_seen'],
  reddit: ['last_seen', 'reddit_ad.last_seen'],
  quora: ['last_seen', 'quora_ad.last_seen'],
  pinterest: ['last_seen', 'pinterest_ad.last_seen'],
  tiktok: ['last_seen', 'tiktok_ad.last_seen'],
};

function getEs(net) {
  const s = serviceRegistry.getService(net);
  if (s && s.db && s.db.elastic) return s.db.elastic;
  return databaseManager.getElastic(net) || null;
}

async function timed(fn, timeoutMs = 35000) {
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`local watchdog timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { ok: true, ms: Date.now() - t0, result };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: err.message };
  }
}

async function main() {
  console.log('Connecting to all networks (same as the live app)...\n');
  await databaseManager.connectAll(networksConfig);

  const rows = [];
  for (const net of TREND_NETWORKS) {
    const es = getEs(net);
    if (!es) {
      rows.push({ net, status: 'NO CLIENT', ms: 0, detail: 'no ES connection configured for this network' });
      continue;
    }
    const index = es.indexName || 'search_mix';
    const fields = NET_DATE_CANDIDATES[net] || ['last_seen'];

    // Same call marketTrends.js's getAnchorMs/resolveNetDate makes — a single
    // `max` aggregation, tried against each candidate date field in turn.
    let fieldResult = null;
    for (const field of fields) {
      // eslint-disable-next-line no-await-in-loop
      const r = await timed(() => es.search({ index, request_cache: true, body: { size: 0, aggs: { a: { max: { field } } } } }));
      fieldResult = { field, ...r };
      if (r.ok) break;
    }
    rows.push({
      net,
      status: fieldResult.ok ? 'OK' : 'FAILED',
      ms: fieldResult.ms,
      detail: fieldResult.ok ? `index=${index} field=${fieldResult.field}` : `index=${index} field=${fieldResult.field} error=${fieldResult.error}`,
    });
  }

  console.log('Per-network max(last_seen) latency (what every panel resolves first, per network, in parallel):\n');
  rows.sort((a, b) => b.ms - a.ms);
  const width = Math.max(...rows.map((r) => r.net.length)) + 2;
  for (const r of rows) {
    const flag = r.ms >= 5000 ? '  <<< SLOW' : r.status !== 'OK' ? '  <<< FAILING' : '';
    console.log(`  ${r.net.padEnd(width)} ${String(r.ms).padStart(6)}ms  ${r.status.padEnd(8)} ${r.detail}${flag}`);
  }

  const slowest = rows[0];
  console.log('\n--- VERDICT ---');
  console.log(`A single Market Trends panel request waits for ALL ${TREND_NETWORKS.length} networks above (Promise.all)`);
  console.log(`before it can respond — so the panel's total latency is at minimum the SLOWEST one shown above.`);
  if (slowest && (slowest.ms >= 5000 || slowest.status !== 'OK')) {
    console.log(`\n"${slowest.net}" is the bottleneck (${slowest.ms}ms / ${slowest.status}). Fixing/isolating this network's`);
    console.log('cluster (or excluding it from the parallel fan-out with a per-network timeout) is the highest-leverage fix.');
  } else {
    console.log('\nNo single network stands out as pathologically slow right now — if the page still feels slow, the cause');
    console.log('is more likely the SUM of 6 independent panel requests each re-resolving the same per-network data with no');
    console.log('cross-request caching (see marketTrends.js\'s getCoalescedDateMax comment: "completed values are not retained").');
  }

  await databaseManager.disconnectAll();
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});

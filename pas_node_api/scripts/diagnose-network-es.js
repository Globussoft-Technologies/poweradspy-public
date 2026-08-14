'use strict';

/**
 * Generic per-network Elasticsearch health check — same diagnostic depth as
 * diagnose-google-load.js's ES section, but works for any network via
 * --network=<slug>. Built to chase down the 2026-08-14 Market Trends incident
 * (instagram_search_mix timed out completely — 30s, "Request timed out" — on
 * a trivial `size:0 max()` aggregation, while the other 10 networks' clusters
 * answered in under 4s), but is not instagram-specific.
 *
 * Read-only.
 *
 * Usage:
 *   node scripts/diagnose-network-es.js --network=instagram
 *   node scripts/diagnose-network-es.js --network=instagram --index=instagram_search_mix
 */

require('dotenv').config();
const networksConfig = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const [key, value] = token.replace(/^--/, '').split('=');
    args[key] = value;
  }
  return args;
}

function heading(t) { console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const net = args.network;
  if (!net || !networksConfig[net]) {
    throw new Error(`--network=<slug> is required and must be a known network (e.g. instagram). Got: ${net}`);
  }

  await databaseManager.connectAll({ [net]: networksConfig[net] });
  const conns = databaseManager.getConnections(net);
  if (!conns?.elastic) throw new Error(`Could not connect to ${net} Elasticsearch — check config.json / env on this host.`);
  const client = conns.elastic.client;
  const index = args.index || conns.elastic.indexName;

  heading(`${net.toUpperCase()} — ES CONNECTION`);
  console.log(`index: ${index}`);

  heading('PING (raw connectivity — lightweight, no query execution)');
  const t0 = Date.now();
  try {
    await client.ping();
    console.log(`ping OK in ${Date.now() - t0}ms`);
  } catch (err) {
    console.log(`ping FAILED after ${Date.now() - t0}ms: ${err.message}`);
  }

  heading('CLUSTER HEALTH');
  try {
    const t1 = Date.now();
    const health = (await client.cluster.health({ timeout: '10s' })).body || (await client.cluster.health({ timeout: '10s' }));
    console.log(`(${Date.now() - t1}ms) status=${health.status} nodes=${health.number_of_nodes} active_shards=${health.active_shards} unassigned_shards=${health.unassigned_shards} initializing_shards=${health.initializing_shards} relocating_shards=${health.relocating_shards}`);
    if (health.status !== 'green') console.log('  >> cluster is NOT green — this alone can explain slow/hanging queries.');
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }

  heading(`INDEX HEALTH: ${index}`);
  try {
    const t2 = Date.now();
    const idxHealth = (await client.cluster.health({ index, timeout: '10s' })).body || (await client.cluster.health({ index, timeout: '10s' }));
    console.log(`(${Date.now() - t2}ms) status=${idxHealth.status} active_shards=${idxHealth.active_shards} unassigned_shards=${idxHealth.unassigned_shards}`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }

  heading('NODE STATS (jvm / os / thread_pool)');
  try {
    const t3 = Date.now();
    const stats = (await client.nodes.stats({ metric: ['jvm', 'os', 'thread_pool'] })).body
      || (await client.nodes.stats({ metric: ['jvm', 'os', 'thread_pool'] }));
    console.log(`(${Date.now() - t3}ms)`);
    for (const node of Object.values(stats.nodes || {})) {
      console.log(`  node ${node.name}: heap=${node.jvm?.mem?.heap_used_percent}% cpu=${node.os?.cpu?.percent}% load1m=${node.os?.cpu?.load_average?.['1m']}`);
      for (const pool of ['search', 'write', 'bulk', 'get']) {
        const tp = node.thread_pool?.[pool];
        if (tp && (tp.active || tp.queue || tp.rejected)) {
          console.log(`    thread_pool.${pool}: active=${tp.active} queue=${tp.queue} rejected=${tp.rejected}`);
        }
      }
    }
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }

  heading('PENDING TASKS');
  try {
    const pending = (await client.cluster.pendingTasks()).body || (await client.cluster.pendingTasks());
    const tasks = pending.tasks || [];
    console.log(`${tasks.length} pending task(s)`);
    tasks.slice(0, 10).forEach((t) => console.log(`  [${t.time_in_queue}] priority=${t.priority} source=${t.source}`));
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }

  heading(`TEST QUERY: size:0 max(last_seen)-style agg against ${index}`);
  const t4 = Date.now();
  try {
    await client.search({ index, body: { size: 0, aggs: { a: { max: { field: 'last_seen' } } } } }, { requestTimeout: 15000 });
    console.log(`OK in ${Date.now() - t4}ms`);
  } catch (err) {
    console.log(`FAILED after ${Date.now() - t4}ms: ${err.message}`);
    console.log('  >> if this hangs/fails while PING above succeeded, the cluster is reachable but this INDEX');
    console.log('  >> specifically is unhealthy (unassigned shards, stuck merge, mapping issue, or overloaded).');
  }

  heading('HOT THREADS');
  try {
    const hot = (await client.nodes.hotThreads({ threads: 3 })).body || (await client.nodes.hotThreads({ threads: 3 }));
    console.log(String(hot).split('\n').slice(0, 40).join('\n'));
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }

  await databaseManager.disconnectAll();
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});

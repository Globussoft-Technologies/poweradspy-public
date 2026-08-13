'use strict';

/**
 * ONE script, ONLY the google network: finds the exact thing burning CPU on
 * google's MySQL + Elasticsearch right now, and prints a concrete fix for
 * whatever it finds. Read-only except the optional --kill-query flag.
 *
 * Must run where production config/.env is available (same host as the API,
 * or anywhere with network access to production MySQL/ES) — it reuses the
 * app's own DatabaseManager + networks config to connect to the real DBs.
 *
 * Usage:
 *   node scripts/diagnose-google-load.js
 *   node scripts/diagnose-google-load.js --threshold=3      # seconds to flag a query as slow
 *   node scripts/diagnose-google-load.js --kill-query=12345 # SQL KILL <id> — only this, nothing else writes
 */

require('dotenv').config();
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

function parseArgs(argv) {
  const args = { threshold: 3 };
  for (const token of argv) {
    const [key, value] = token.replace(/^--/, '').split('=');
    if (key === 'threshold') args.threshold = Number(value) || 3;
    if (key === 'kill-query') args.killQuery = Number(value);
  }
  return args;
}

function heading(title) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

function fix(title, ...lines) {
  console.log(`\n  >> FIX: ${title}`);
  lines.forEach((l) => console.log(`     ${l}`));
}

// ─── MySQL ──────────────────────────────────────────────────────────────

async function diagnoseSQL(sql, thresholdSec, killQueryId) {
  heading('GOOGLE — MySQL');

  if (killQueryId) {
    try {
      await sql.query(`KILL QUERY ${Number(killQueryId)}`);
      console.log(`Killed query id ${killQueryId}.`);
    } catch (err) {
      console.log(`Could not kill ${killQueryId}: ${err.message}`);
    }
  }

  const processlist = await sql.query('SHOW FULL PROCESSLIST');
  const busy = processlist.filter((r) => r.Command !== 'Sleep' && r.Command !== 'Daemon');
  const slow = busy.filter((r) => Number(r.Time) >= thresholdSec).sort((a, b) => Number(b.Time) - Number(a.Time));

  console.log(`connections: ${processlist.length} total, ${busy.length} active, ${slow.length} running >= ${thresholdSec}s\n`);

  if (!slow.length) {
    console.log('No slow/stuck queries right now. MySQL itself is not the bottleneck at this instant.');
    console.log('If it WAS the bottleneck a few minutes ago, check the slow query log instead:');
    fix('tail the slow query log for the exact query that was slow',
      'mysql -e "SHOW VARIABLES LIKE \'slow_query_log_file\';"',
      'tail -n 100 <that path>');
  } else {
    slow.slice(0, 10).forEach((r) => {
      const q = String(r.Info || '').replace(/\s+/g, ' ').slice(0, 200);
      console.log(`  [${r.Time}s] id=${r.Id} db=${r.db} state="${r.State || '-'}"`);
      console.log(`     ${q}`);
    });

    const longest = slow[0];
    if (/full join|Sending data/i.test(longest.State || '') || slow.length >= 3) {
      fix(`kill the stuck query and add an index — this is very likely a missing-index full scan`,
        `1. Confirm the plan:  EXPLAIN ${String(longest.Info || '').slice(0, 150)}...`,
        `2. If "type: ALL" / no key used → add an index on the filtered/sorted column(s).`,
        `3. Stop the bleed now:  node scripts/diagnose-google-load.js --kill-query=${longest.Id}`);
    } else {
      fix('inspect + kill the specific stuck query',
        `node scripts/diagnose-google-load.js --kill-query=${longest.Id}`);
    }
  }

  const status = await sql.query(
    "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running','Threads_connected','Max_used_connections','Slow_queries')",
  );
  const statusMap = Object.fromEntries(status.map((r) => [r.Variable_name, r.Value]));
  const maxConn = Number((await sql.query("SHOW VARIABLES LIKE 'max_connections'"))[0]?.Value || 0);
  console.log(`\nThreads_running=${statusMap.Threads_running} Threads_connected=${statusMap.Threads_connected}/${maxConn} Slow_queries(cumulative)=${statusMap.Slow_queries}`);

  if (maxConn && Number(statusMap.Threads_connected) / maxConn > 0.85) {
    fix('connection pool near exhaustion — a leak, not a slow query',
      'grep the app for db.getConnection()/pool.getConnection() calls missing a .release() in a finally block.',
      'Restarting the app frees connections immediately; the leak will recur until the code is fixed.');
  }
}

// ─── Elasticsearch ──────────────────────────────────────────────────────

async function diagnoseElastic(elastic, thresholdSec) {
  heading(`GOOGLE — Elasticsearch (index: ${elastic.indexName})`);
  const client = elastic.client;

  const health = (await client.cluster.health()).body || (await client.cluster.health());
  console.log(`cluster: status=${health.status} nodes=${health.number_of_nodes} unassigned_shards=${health.unassigned_shards}`);
  if (health.number_of_nodes === 1) {
    console.log('(single-node cluster — every query, merge, and GC competes for the SAME cpu, no relief valve)');
  }

  const stats = (await client.nodes.stats({ metric: ['jvm', 'os', 'process', 'thread_pool'] })).body
    || (await client.nodes.stats({ metric: ['jvm', 'os', 'process', 'thread_pool'] }));

  let worstPool = null;
  for (const node of Object.values(stats.nodes || {})) {
    const heapPct = node.jvm?.mem?.heap_used_percent;
    const cpuPct = node.os?.cpu?.percent;
    const load1m = node.os?.cpu?.load_average?.['1m'];
    console.log(`\nnode ${node.name}: heap=${heapPct}% cpu(instant)=${cpuPct}% load1m=${load1m}`);
    for (const pool of ['search', 'write', 'bulk', 'get', 'merge']) {
      const tp = node.thread_pool?.[pool];
      if (!tp) continue;
      if (tp.active || tp.queue || tp.rejected) {
        console.log(`  thread_pool.${pool}: active=${tp.active} queue=${tp.queue} rejected=${tp.rejected}`);
      }
      if (!worstPool || (tp.queue || 0) > (worstPool.tp.queue || 0)) worstPool = { name: pool, node: node.name, tp };
    }
  }

  console.log('\n--- Live tasks (what is actually running right now) ---');
  const tasks = (await client.tasks.list({ detailed: true, actions: '*search*,*bulk*' })).body
    || (await client.tasks.list({ detailed: true, actions: '*search*,*bulk*' }));
  const running = [];
  for (const node of Object.values(tasks.nodes || {})) {
    for (const [taskId, task] of Object.entries(node.tasks || {})) {
      running.push({ taskId, action: task.action, runningMs: Math.round((task.running_time_in_nanos || 0) / 1e6), description: task.description });
    }
  }
  running.sort((a, b) => b.runningMs - a.runningMs);
  running.slice(0, 10).forEach((t) => console.log(`  [${(t.runningMs / 1000).toFixed(1)}s] ${t.action} :: ${String(t.description || '').slice(0, 160)}`));

  const longRunning = running.filter((t) => t.runningMs >= thresholdSec * 1000);

  console.log('\n--- Hot threads (what the CPU is actually doing) ---');
  const hot = (await client.nodes.hotThreads({ threads: 3 })).body || (await client.nodes.hotThreads({ threads: 3 }));
  const hotText = String(hot);
  console.log(hotText.split('\n').slice(0, 40).join('\n'));

  // ─── Verdict for ES ───
  if (longRunning.length) {
    fix('one or more expensive queries are pinning the CPU — cancel them now, then fix the query pattern',
      ...longRunning.slice(0, 3).map((t) => `node scripts/diagnose-google-load.js does not cancel ES tasks; run: curl -X POST "http://<es-host>:9200/_tasks/${t.taskId}/_cancel"`),
      'Then look at the printed description above: deep pagination (large `from`), wildcard/regex queries, or a huge terms aggregation are the usual causes on a 200M+ doc index.');
  } else if (/GarbageCollect|G1|ConcurrentMarkSweep/i.test(hotText)) {
    fix('CPU is dominated by garbage collection, not queries — the JVM heap is under pressure',
      'Check node.jvm.mem.heap_used_percent above; if it is consistently >75%, either raise -Xms/-Xmx (bounded by RAM),',
      'or reduce query cost (lower aggregation precision / cardinality, add filters to shrink the working set).');
  } else if (/Lucene\d+.*Merge|MergeThread/i.test(hotText)) {
    fix('CPU is dominated by Lucene segment merging, not queries — indexing/bulk-write side is the driver',
      'This is normal after a large bulk-insert burst but shouldn\'t sustain for an hour;',
      'check whether an insertion/backfill job is running unusually large batches right now (crawler pipeline, backfill script).');
  } else if (worstPool && (worstPool.tp.queue > 20 || worstPool.tp.rejected > 0)) {
    fix(`thread_pool.${worstPool.name} is backed up (queue=${worstPool.tp.queue}, rejected=${worstPool.tp.rejected})`,
      'Requests are arriving faster than this single node can execute them.',
      'Short term: throttle/rate-limit the caller (search UI or crawler) hitting this index.',
      'Real fix: this cluster has only 1 node — add a second data node so search coordination + execution isn\'t all on one box.');
  } else {
    console.log('\nNo single smoking gun in ES right now — re-run this script while the graph shows the CPU spike (it needs to catch a live moment).');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await databaseManager.connectAll({ google: networks.google });
  const conns = databaseManager.getConnections('google');
  if (!conns) throw new Error('Could not connect to google network databases — check config.json / env on this host.');

  if (conns.sql) await diagnoseSQL(conns.sql, args.threshold, args.killQuery);
  else console.log('google has no SQL configured.');

  if (conns.elastic) await diagnoseElastic(conns.elastic, args.threshold);
  else console.log('google has no Elasticsearch configured.');

  await databaseManager.disconnectAll();
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});

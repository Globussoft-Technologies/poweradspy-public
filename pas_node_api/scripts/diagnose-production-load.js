'use strict';

/**
 * Point-in-time root-cause snapshot for "why is CPU/RAM suddenly high" on
 * production. Read-only everywhere (SHOW PROCESSLIST / STATUS, ES cluster
 * stats, Mongo serverStatus/currentOp, OS process list) — no writes, no
 * locks, safe to run directly against production.
 *
 * Must run on/against production (same config.json / env the API server
 * uses), since it reuses the app's own DatabaseManager + per-network
 * connection config to reach the real MySQL/Mongo/Elasticsearch instances.
 *
 * Usage:
 *   node scripts/diagnose-production-load.js
 *   node scripts/diagnose-production-load.js --networks=google,facebook
 *   node scripts/diagnose-production-load.js --threshold=10   # seconds to flag a query/op as "slow"
 *   node scripts/diagnose-production-load.js --json           # machine-readable output instead of the printed report
 */

require('dotenv').config();
const { execSync } = require('child_process');
const os = require('os');

const allNetworks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

function parseArgs(argv) {
  const args = { threshold: 5, top: 10, json: false };
  for (const token of argv) {
    if (token === '--json') { args.json = true; continue; }
    const [key, value] = token.replace(/^--/, '').split('=');
    if (key === 'networks') args.networks = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'threshold') args.threshold = Number(value) || 5;
    else if (key === 'top') args.top = Number(value) || 10;
  }
  return args;
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return 'n/a';
  const gb = n / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function heading(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

// ─── OS-level snapshot ────────────────────────────────────────────────

function osSnapshot(topN, flags) {
  heading('OS SNAPSHOT');
  const load = os.loadavg();
  const cpus = os.cpus().length;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPct = ((1 - freeMem / totalMem) * 100).toFixed(1);
  console.log(`Load avg (1/5/15m): ${load.map((n) => n.toFixed(2)).join(' / ')}  (cores: ${cpus})`);
  console.log(`Memory: ${fmtBytes(totalMem - freeMem)} used / ${fmtBytes(totalMem)} total (${usedPct}%), ${fmtBytes(freeMem)} free`);

  if (load[0] > cpus * 1.5) flags.push(`OS load avg ${load[0].toFixed(2)} exceeds ${cpus} cores by 1.5x+ — CPU is genuinely saturated, not just one slow query.`);
  if (Number(usedPct) > 90) flags.push(`System memory ${usedPct}% used, only ${fmtBytes(freeMem)} free — check swap/OOM below.`);

  // Linux-only extras; no-ops elsewhere.
  const topOut = sh(`ps -eo pid,ppid,pcpu,pmem,rss,etimes,comm --sort=-pcpu | head -n ${topN + 1}`);
  if (topOut) {
    console.log(`\nTop ${topN} processes by CPU:`);
    console.log(topOut);
  }
  const topMemOut = sh(`ps -eo pid,ppid,pcpu,pmem,rss,etimes,comm --sort=-rss | head -n ${topN + 1}`);
  if (topMemOut) {
    console.log(`\nTop ${topN} processes by RSS:`);
    console.log(topMemOut);
  }

  const swap = sh("free -m | awk '/Swap/{print $2, $3}'");
  if (swap) {
    const [swapTotal, swapUsed] = swap.split(/\s+/).map(Number);
    console.log(`\nSwap: ${swapUsed}MB used / ${swapTotal}MB total`);
    if (swapTotal > 0 && swapUsed / swapTotal > 0.3) {
      flags.push(`Swap is ${((swapUsed / swapTotal) * 100).toFixed(0)}% used — the box is paging, which alone can look like "everything got slow".`);
    }
  }

  const oom = sh('dmesg -T 2>/dev/null | grep -i "out of memory\\|oom-kill" | tail -n 5')
    || sh('journalctl -k --since "2 hours ago" 2>/dev/null | grep -i "out of memory\\|oom-kill" | tail -n 5');
  if (oom) {
    console.log(`\nRecent OOM-killer activity:\n${oom}`);
    flags.push('OOM-killer fired recently (see OS SNAPSHOT) — the kernel killed a process for memory, which explains sudden restarts/latency spikes.');
  }

  const diskOut = sh('df -h / /var /tmp 2>/dev/null');
  if (diskOut) console.log(`\nDisk usage:\n${diskOut}`);
}

// ─── Per-network MySQL ────────────────────────────────────────────────

async function checkSQL(slug, sql, thresholdSec, flags) {
  console.log(`\n[${slug}] MySQL`);
  try {
    const processlist = await sql.query('SHOW FULL PROCESSLIST');
    const busy = processlist.filter((r) => r.Command !== 'Sleep' && r.Command !== 'Daemon');
    const slow = busy.filter((r) => Number(r.Time) >= thresholdSec);
    console.log(`  connections: ${processlist.length} total, ${busy.length} active, ${slow.length} running >= ${thresholdSec}s`);
    slow
      .sort((a, b) => Number(b.Time) - Number(a.Time))
      .slice(0, 10)
      .forEach((r) => {
        const q = String(r.Info || '').replace(/\s+/g, ' ').slice(0, 160);
        console.log(`    [${r.Time}s] id=${r.Id} db=${r.db} state=${r.State || '-'} :: ${q}`);
      });
    if (slow.length) {
      const longest = slow[0];
      flags.push(`MySQL(${slug}): ${slow.length} quer${slow.length === 1 ? 'y' : 'ies'} running >= ${thresholdSec}s (longest ${longest.Time}s, state="${longest.State || '-'}") — this is very likely the CPU driver.`);
    }

    const status = await sql.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running','Threads_connected','Max_used_connections','Slow_queries')");
    const statusMap = Object.fromEntries(status.map((r) => [r.Variable_name, r.Value]));
    console.log(`  Threads_running=${statusMap.Threads_running} Threads_connected=${statusMap.Threads_connected} Max_used_connections=${statusMap.Max_used_connections} Slow_queries(cumulative)=${statusMap.Slow_queries}`);

    const maxConn = await sql.query("SHOW VARIABLES LIKE 'max_connections'");
    const maxConnVal = Number(maxConn[0]?.Value || 0);
    if (maxConnVal && Number(statusMap.Threads_connected) / maxConnVal > 0.85) {
      flags.push(`MySQL(${slug}): Threads_connected (${statusMap.Threads_connected}) is near max_connections (${maxConnVal}) — pool exhaustion risk, check for connection leaks.`);
    }
  } catch (err) {
    console.log(`  ! could not read MySQL state: ${err.message}`);
  }
}

// ─── Per-network MongoDB ───────────────────────────────────────────────

async function checkMongo(slug, mongo, thresholdSec, flags) {
  console.log(`\n[${slug}] MongoDB`);
  try {
    const admin = mongo.client.db().admin();
    const status = await admin.serverStatus();
    console.log(`  connections: current=${status.connections?.current} available=${status.connections?.available}`);
    console.log(`  opcounters: ${JSON.stringify(status.opcounters)}`);
    if (status.mem) console.log(`  mem: resident=${status.mem.resident}MB virtual=${status.mem.virtual}MB`);

    const current = await admin.command({ currentOp: 1, active: true, secs_running: { $gte: thresholdSec } });
    const ops = (current.inprog || []).filter((op) => !op.desc?.includes('conn') || op.secs_running >= thresholdSec);
    console.log(`  ops running >= ${thresholdSec}s: ${ops.length}`);
    ops.slice(0, 10).forEach((op) => {
      const q = JSON.stringify(op.command || op.query || {}).slice(0, 160);
      console.log(`    [${op.secs_running}s] op=${op.op} ns=${op.ns} :: ${q}`);
    });
    if (ops.length) {
      flags.push(`MongoDB(${slug}): ${ops.length} operation(s) running >= ${thresholdSec}s (longest ${Math.max(...ops.map((o) => o.secs_running))}s) — likely CPU/lock contributor.`);
    }
  } catch (err) {
    console.log(`  ! could not read Mongo state: ${err.message}`);
  }
}

// ─── Per-network Elasticsearch ─────────────────────────────────────────

async function checkElastic(slug, elastic, reportedNodes, flags) {
  const client = elastic.client;
  const nodeKey = elastic.indexName ? `${slug}:${elastic.indexName}` : slug;
  console.log(`\n[${slug}] Elasticsearch (index: ${elastic.indexName || 'n/a'})`);
  try {
    const health = (await client.cluster.health()).body || (await client.cluster.health());
    console.log(`  cluster: status=${health.status} nodes=${health.number_of_nodes} active_shards=${health.active_shards} relocating=${health.relocating_shards} initializing=${health.initializing_shards} unassigned=${health.unassigned_shards}`);
    if (health.status !== 'green') flags.push(`Elasticsearch(${slug}): cluster status is "${health.status}" (unassigned_shards=${health.unassigned_shards}).`);

    const stats = (await client.nodes.stats({ metric: ['jvm', 'os', 'process', 'thread_pool'] })).body
      || (await client.nodes.stats({ metric: ['jvm', 'os', 'process', 'thread_pool'] }));
    for (const [nodeId, node] of Object.entries(stats.nodes || {})) {
      const heapPct = node.jvm?.mem?.heap_used_percent;
      const cpuPct = node.os?.cpu?.percent;
      const loadAvg = node.os?.cpu?.load_average?.['1m'];
      console.log(`  node ${node.name}: heap=${heapPct}% cpu=${cpuPct}% load1m=${loadAvg}`);
      if (heapPct >= 85) flags.push(`Elasticsearch(${slug}) node "${node.name}": JVM heap at ${heapPct}% — GC pressure, classic cause of ES CPU spikes.`);
      if (cpuPct >= 90) flags.push(`Elasticsearch(${slug}) node "${node.name}": OS CPU at ${cpuPct}%.`);

      for (const pool of ['search', 'write', 'bulk', 'get']) {
        const tp = node.thread_pool?.[pool];
        if (!tp) continue;
        if (tp.rejected > 0 || tp.queue > 0) {
          console.log(`    thread_pool.${pool}: active=${tp.active} queue=${tp.queue} rejected=${tp.rejected}`);
        }
        if (tp.rejected > 0) {
          flags.push(`Elasticsearch(${slug}) node "${node.name}" thread_pool.${pool}: ${tp.rejected} rejected — clients are being refused, node is overloaded for that pool.`);
        } else if (tp.queue > 50) {
          flags.push(`Elasticsearch(${slug}) node "${node.name}" thread_pool.${pool}: queue depth ${tp.queue} — requests backing up.`);
        }
      }
    }

    if (!reportedNodes.has(nodeKey) && (health.status !== 'green')) {
      try {
        const hot = (await client.nodes.hotThreads()).body || (await client.nodes.hotThreads());
        console.log(`\n  hot threads (truncated):\n${String(hot).split('\n').slice(0, 25).join('\n')}`);
      } catch { /* hot threads is best-effort */ }
    }
    reportedNodes.add(nodeKey);
  } catch (err) {
    console.log(`  ! could not read Elasticsearch state: ${err.message}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slugs = args.networks && args.networks.length
    ? args.networks
    : Object.keys(allNetworks).filter((slug) => allNetworks[slug].enabled);

  const networksToLoad = Object.fromEntries(slugs.map((slug) => [slug, allNetworks[slug]]).filter(([, cfg]) => cfg));
  const missing = slugs.filter((slug) => !allNetworks[slug]);
  if (missing.length) console.log(`(unknown network(s) skipped: ${missing.join(', ')})`);

  const flags = [];
  osSnapshot(args.top, flags);

  await databaseManager.connectAll(networksToLoad);

  const reportedEsNodes = new Set();
  for (const slug of Object.keys(networksToLoad)) {
    const conns = databaseManager.getConnections(slug);
    if (!conns) continue;
    heading(`NETWORK: ${slug}`);
    if (conns.sql) await checkSQL(slug, conns.sql, args.threshold, flags);
    if (conns.mongo) await checkMongo(slug, conns.mongo, args.threshold, flags);
    if (conns.elastic) await checkElastic(slug, conns.elastic, reportedEsNodes, flags);
    if (!conns.sql && !conns.mongo && !conns.elastic) console.log('  (no databases configured for this network)');
  }

  heading('VERDICT');
  if (!flags.length) {
    console.log('No obvious root cause found in MySQL/Mongo/Elasticsearch/OS-level checks above.');
    console.log('If load is still high, re-run with a lower --threshold, or the cause may be outside');
    console.log('these systems (e.g. the Node process itself — check `pm2 monit` / event-loop lag, or an');
    console.log('external crawler/bot hammering an endpoint — check nginx/access logs for request rate).');
  } else {
    flags.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  }

  await databaseManager.disconnectAll();

  if (args.json) {
    console.log(`\n${JSON.stringify({ flags }, null, 2)}`);
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});

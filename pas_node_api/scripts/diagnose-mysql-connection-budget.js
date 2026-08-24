'use strict';

/**
 * Root-cause finder for "MySQL max_connections full" incidents on
 * PRODUCTION (2026-08-21: instagram_dbusr connections exhausted, mysqld had
 * to be bounced to recover — see prod mysqld error log around 05:20 UTC).
 *
 * This app can be double-clustered: config.cluster.enabled forks its OWN
 * internal workers (server.js), and PM2 `-i N` can ALSO run multiple copies
 * of that on top — see src/clusterWorkerIdentity.js's isSingletonOwner()
 * doc comment, which already flags this exact hazard. Every worker process
 * opens its OWN mysql2 pool PER ENABLED NETWORK (src/database/DatabaseManager.js
 * _connectSQL), sized to that network's poolSize. Nothing in the app caps
 * the TOTAL connections across processes — it's pure fan-out:
 *
 *   theoretical max to one MySQL host = (live worker process count)
 *                                        x sum(poolSize of every enabled
 *                                          network pointed at that host)
 *
 * If that number is anywhere near (or over) MySQL's max_connections, the
 * server WILL run out under load — independent of whether any query is
 * actually slow. This script measures every term in that equation directly
 * on the box where the app runs, instead of guessing.
 *
 * Read-only: ps / /proc/<pid>/environ reads, SHOW VARIABLES / SHOW STATUS /
 * SHOW FULL PROCESSLIST / information_schema.processlist. No KILL, no writes,
 * nothing is restarted. Safe to run directly against production.
 *
 * Must run ON the production box (or a host with the same config.json/.env
 * the app uses) FROM the pas_node_api directory, as the user the app runs
 * as (needed to read /proc/<pid>/environ for sibling processes on Linux).
 *
 * Usage:
 *   node scripts/diagnose-mysql-connection-budget.js
 *   node scripts/diagnose-mysql-connection-budget.js --grep=server.js
 *   node scripts/diagnose-mysql-connection-budget.js --networks=instagram,facebook
 *   node scripts/diagnose-mysql-connection-budget.js --json
 */

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const config = require('../src/config');
const allNetworks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

function parseArgs(argv) {
  const args = { grep: 'server.js', json: false };
  for (const token of argv) {
    if (token === '--json') { args.json = true; continue; }
    const [key, value] = token.replace(/^--/, '').split('=');
    if (key === 'grep') args.grep = value;
    else if (key === 'networks') args.networks = value.split(',').map((s) => s.trim()).filter(Boolean);
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

function heading(title) {
  console.log(`\n${'='.repeat(74)}\n${title}\n${'='.repeat(74)}`);
}

// ─── Step 1: how many copies of this app are actually running right now? ──
//
// Not "how many SHOULD be running per config.cluster.workers" — how many
// ARE. A bad deploy/restart can leave old generations of workers alive
// alongside new ones (each still holding its own full MySQL pool) long
// after config says there should only be N.

function findLiveWorkerProcesses(grepPattern) {
  if (os.platform() === 'win32') {
    return { supported: false, pids: [], note: 'ps/proc inspection is Linux-only; run this script on the production box.' };
  }

  const psOut = sh(`ps -eo pid,ppid,etimes,cmd`);
  if (!psOut) return { supported: false, pids: [], note: 'could not run `ps` on this host.' };

  const pids = [];
  for (const line of psOut.split('\n').slice(1)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, etimes, cmd] = m;
    if (!cmd.includes(grepPattern) || cmd.includes('grep')) continue;
    pids.push({ pid: Number(pid), ppid: Number(ppid), ageSec: Number(etimes), cmd: cmd.trim() });
  }
  return { supported: true, pids };
}

// Read WORKER_ID (this app's internal cluster.fork()) and NODE_APP_INSTANCE
// (PM2 `-i N`) out of each process's real environment — the only reliable
// way to see whether BOTH clustering layers are stacked, since neither is
// visible from `ps` output alone.
function readProcEnv(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
    const vars = Object.fromEntries(
      raw.split('\0').filter(Boolean).map((kv) => {
        const idx = kv.indexOf('=');
        return [kv.slice(0, idx), kv.slice(idx + 1)];
      })
    );
    return { ok: true, WORKER_ID: vars.WORKER_ID, NODE_APP_INSTANCE: vars.NODE_APP_INSTANCE };
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }
}

// ─── Step 2: theoretical connection budget from live config ───────────────

function computeHostBudgets(networksToCheck) {
  const groups = new Map(); // "host:port:user" -> { host, port, user, database: Set, poolSize sum, networks: [] }

  for (const [slug, net] of Object.entries(networksToCheck)) {
    const sqlCfg = net.database?.sql;
    if (!sqlCfg || !sqlCfg.enabled) continue;
    const key = `${sqlCfg.host}:${sqlCfg.port}:${sqlCfg.user}`;
    if (!groups.has(key)) {
      groups.set(key, { host: sqlCfg.host, port: sqlCfg.port, user: sqlCfg.user, poolSizeSum: 0, networks: [] });
    }
    const g = groups.get(key);
    g.poolSizeSum += Number(sqlCfg.poolSize) || 0;
    g.networks.push({ slug, poolSize: Number(sqlCfg.poolSize) || 0, database: sqlCfg.database });
  }
  return groups;
}

// ─── Step 3: ground-truth from MySQL itself ────────────────────────────────

async function checkMysqlHost(slug, sql, flags, jsonOut) {
  console.log(`\n[${slug}] querying live MySQL state...`);
  try {
    const maxConn = await sql.query("SHOW VARIABLES LIKE 'max_connections'");
    const maxConnVal = Number(maxConn[0]?.Value || 0);

    const status = await sql.query(
      "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Connection_errors_max_connections','Aborted_connects')"
    );
    const statusMap = Object.fromEntries(status.map((r) => [r.Variable_name, Number(r.Value)]));

    console.log(`  max_connections=${maxConnVal}`);
    console.log(`  Threads_connected=${statusMap.Threads_connected}  Threads_running=${statusMap.Threads_running}  Max_used_connections=${statusMap.Max_used_connections}`);
    console.log(`  Connection_errors_max_connections (cumulative refusals)=${statusMap.Connection_errors_max_connections}  Aborted_connects=${statusMap.Aborted_connects}`);

    const breakdown = await sql.query(
      `SELECT user, db, command, COUNT(*) AS cnt, MAX(time) AS longest_sec
       FROM information_schema.processlist
       GROUP BY user, db, command
       ORDER BY cnt DESC
       LIMIT 20`
    );
    console.log('  breakdown by user/db/command (top 20):');
    breakdown.forEach((r) => {
      console.log(`    user=${r.user} db=${r.db || '-'} command=${r.command} count=${r.cnt} longest=${r.longest_sec}s`);
    });

    if (statusMap.Connection_errors_max_connections > 0) {
      flags.push(`MySQL(${slug}): Connection_errors_max_connections=${statusMap.Connection_errors_max_connections} — this server HAS actually refused connections due to max_connections since last restart/flush. This is the smoking gun, not just a close call.`);
    }
    if (maxConnVal && statusMap.Threads_connected / maxConnVal > 0.85) {
      flags.push(`MySQL(${slug}): Threads_connected (${statusMap.Threads_connected}) is within 15% of max_connections (${maxConnVal}) RIGHT NOW.`);
    }

    if (jsonOut) jsonOut[slug] = { maxConnVal, statusMap, breakdown };
  } catch (err) {
    console.log(`  ! could not read MySQL state: ${err.message}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  heading('CLUSTER CONFIG (as this process resolves it)');
  console.log(`config.cluster.enabled = ${config.cluster.enabled}`);
  console.log(`config.cluster.workers = ${config.cluster.workers} (os.cpus().length = ${os.cpus().length})`);
  console.log('If this app is ALSO started under PM2 with `-i N` / `instances: N > 1`, each PM2 copy');
  console.log('forks its own set of the above internal workers again — see src/clusterWorkerIdentity.js.');

  heading('LIVE WORKER PROCESSES ON THIS HOST');
  const { supported, pids, note } = findLiveWorkerProcesses(args.grep);
  if (!supported) {
    console.log(`(skipped: ${note})`);
  } else if (!pids.length) {
    console.log(`No processes matched --grep="${args.grep}". Adjust --grep to match how this app is actually started (e.g. --grep=pas_node_api).`);
  } else {
    const fanout = new Map(); // "pmInstance|workerId" -> count
    let envReadable = 0;
    for (const p of pids) {
      const env = readProcEnv(p.pid);
      let tag;
      if (env.ok) {
        envReadable++;
        tag = `PM2_INSTANCE=${env.NODE_APP_INSTANCE ?? 'n/a'} | WORKER_ID=${env.WORKER_ID ?? 'n/a'}`;
      } else {
        tag = `(env unreadable: ${env.error})`;
      }
      fanout.set(tag, (fanout.get(tag) || 0) + 1);
      console.log(`  pid=${p.pid} ppid=${p.ppid} age=${p.ageSec}s ${tag}`);
    }

    console.log(`\nTotal live worker processes matching "${args.grep}": ${pids.length}`);

    if (envReadable > 0) {
      const distinctPm2 = new Set();
      const distinctWorkerId = new Set();
      for (const p of pids) {
        const env = readProcEnv(p.pid);
        if (env.ok) {
          distinctPm2.add(env.NODE_APP_INSTANCE ?? 'n/a');
          distinctWorkerId.add(env.WORKER_ID ?? 'n/a');
        }
      }
      console.log(`Distinct PM2 instance ids seen: ${distinctPm2.size} (${[...distinctPm2].join(', ')})`);
      console.log(`Distinct internal WORKER_ID values seen: ${distinctWorkerId.size} (${[...distinctWorkerId].join(', ')})`);
      if (distinctPm2.size > 1 && distinctWorkerId.size > 1) {
        console.log('\n*** DOUBLE CLUSTERING DETECTED: both PM2 -i N AND config.cluster.enabled internal');
        console.log('*** forking are active simultaneously. Effective process count = PM2 instances x');
        console.log('*** internal workers, not just one of them. Each process opens its own full MySQL');
        console.log('*** pool per network — this alone can multiply connections far past what config.cluster.workers suggests.');
      }
    } else if (pids.length > 0) {
      console.log('(could not read /proc/<pid>/environ for any matched process — run this script as the');
      console.log(' same user/root as the app to see the PM2/WORKER_ID breakdown. Falling back to raw process count.)');
    }
  }

  const liveWorkerCount = supported && pids.length ? pids.length : (config.cluster.enabled ? config.cluster.workers : 1);
  if (!supported || !pids.length) {
    console.log(`\n(using config.cluster value as the worker-count estimate: ${liveWorkerCount} — pass a correct --grep to measure the real number instead)`);
  }

  const slugs = args.networks && args.networks.length
    ? args.networks
    : Object.keys(allNetworks).filter((slug) => allNetworks[slug].enabled);
  const networksToCheck = Object.fromEntries(slugs.map((slug) => [slug, allNetworks[slug]]).filter(([, cfg]) => cfg));

  heading('CONFIGURED MySQL POOL BUDGET PER HOST (from live config.json/.env)');
  const hostGroups = computeHostBudgets(networksToCheck);
  const flags = [];
  for (const [key, g] of hostGroups) {
    const theoreticalMax = liveWorkerCount * g.poolSizeSum;
    console.log(`\n${key}`);
    g.networks.forEach((n) => console.log(`    network=${n.slug} database=${n.database} poolSize=${n.poolSize}`));
    console.log(`  sum(poolSize) across these networks = ${g.poolSizeSum}`);
    console.log(`  live worker processes = ${liveWorkerCount}`);
    console.log(`  THEORETICAL MAX connections this app alone can open to ${g.host}:${g.port} = ${liveWorkerCount} x ${g.poolSizeSum} = ${theoreticalMax}`);
  }

  heading('LIVE MySQL STATE (ground truth)');
  await databaseManager.connectAll(networksToCheck);
  const jsonOut = {};
  for (const slug of Object.keys(networksToCheck)) {
    const conns = databaseManager.getConnections(slug);
    if (conns?.sql) await checkMysqlHost(slug, conns.sql, flags, jsonOut);
  }

  // Cross-check theoretical budget against the live max_connections we just read.
  for (const [key, g] of hostGroups) {
    const theoreticalMax = liveWorkerCount * g.poolSizeSum;
    const anyNetworkResult = g.networks.map((n) => jsonOut[n.slug]).find(Boolean);
    if (anyNetworkResult?.maxConnVal && theoreticalMax > anyNetworkResult.maxConnVal) {
      flags.push(`${key}: this app's OWN theoretical max (${theoreticalMax}, from ${liveWorkerCount} live worker process(es) x poolSize sum ${g.poolSizeSum}) already EXCEEDS MySQL's max_connections (${anyNetworkResult.maxConnVal}) — other clients (PHP queue workers, admin scripts, phpMyAdmin) don't even need to connect for this server to run out. Fix by lowering poolSize per network, reducing live worker count (check for double-clustering above), or raising max_connections.`);
    }
  }

  heading('VERDICT');
  if (!flags.length) {
    console.log('No smoking gun found: theoretical pool budget is within max_connections and no refusals');
    console.log('recorded since last restart. If the incident already happened and mysqld was restarted,');
    console.log('Connection_errors_max_connections has been reset to 0 — re-run this during/near the next');
    console.log('spike, or check the mysqld error log timestamp against `pm2 logs` / worker restart times.');
  } else {
    flags.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  }

  await databaseManager.disconnectAll();

  if (args.json) {
    console.log(`\n${JSON.stringify({ liveWorkerCount, flags, mysql: jsonOut }, null, 2)}`);
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});

'use strict';

/**
 * Continuously watches google's ES node CPU and auto-captures a full
 * diagnostic snapshot (hot threads, live tasks, thread pool) the INSTANT cpu
 * crosses a threshold — instead of relying on someone manually running
 * diagnose-google-load.js at the exact right second, which keeps missing the
 * spike (confirmed 2026-08-14: multiple manual snapshots caught the cluster
 * calm right after/before a reported 100% CPU moment).
 *
 * Run this in the background (pm2/nohup/screen) for a while; when the next
 * spike happens, it gets captured to spike log lines automatically, with the
 * EXACT queries that were running at that moment.
 *
 * Read-only.
 *
 * Usage:
 *   node scripts/watch-google-es-spikes.js
 *   node scripts/watch-google-es-spikes.js --threshold=60 --interval=5
 *   nohup node scripts/watch-google-es-spikes.js > /tmp/google-es-spikes.log 2>&1 &
 */

require('dotenv').config();
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

function parseArgs(argv) {
  const args = { threshold: 50, interval: 5, cooldown: 30 };
  for (const token of argv) {
    const [key, value] = token.replace(/^--/, '').split('=');
    if (key === 'threshold') args.threshold = Number(value) || 50;
    if (key === 'interval') args.interval = Number(value) || 5;
    if (key === 'cooldown') args.cooldown = Number(value) || 30;
  }
  return args;
}

function ts() { return new Date().toISOString(); }
function log(...a) { console.log(`[${ts()}]`, ...a); }

async function captureSpike(client, cpuPct, loadAvg) {
  log(`>>> SPIKE DETECTED: cpu=${cpuPct}% load1m=${loadAvg} — capturing full snapshot...`);

  try {
    const tasksResp = (await client.tasks.list({ detailed: true, actions: 'indices:data/read/search' })).body
      || (await client.tasks.list({ detailed: true, actions: 'indices:data/read/search' }));
    const running = [];
    for (const node of Object.values(tasksResp.nodes || {})) {
      for (const [taskId, task] of Object.entries(node.tasks || {})) {
        if (task.action !== 'indices:data/read/search') continue;
        running.push({
          taskId,
          runningSec: Math.round((task.running_time_in_nanos || 0) / 1e8) / 10,
          description: String(task.description || '').slice(0, 300),
        });
      }
    }
    running.sort((a, b) => b.runningSec - a.runningSec);
    log(`  ${running.length} search task(s) in flight:`);
    running.slice(0, 15).forEach((t) => log(`    [${t.runningSec}s] ${t.taskId} :: ${t.description}`));
  } catch (err) {
    log(`  could not list tasks: ${err.message}`);
  }

  try {
    const hot = (await client.nodes.hotThreads({ threads: 5 })).body || (await client.nodes.hotThreads({ threads: 5 }));
    log('  hot threads:');
    console.log(String(hot).split('\n').slice(0, 60).join('\n'));
  } catch (err) {
    log(`  could not get hot threads: ${err.message}`);
  }

  try {
    const statsResp = (await client.nodes.stats({ metric: ['thread_pool'] })).body
      || (await client.nodes.stats({ metric: ['thread_pool'] }));
    for (const node of Object.values(statsResp.nodes || {})) {
      for (const pool of ['search', 'write', 'bulk', 'get', 'merge']) {
        const tp = node.thread_pool?.[pool];
        if (tp && (tp.active || tp.queue || tp.rejected)) {
          log(`  thread_pool.${pool} (${node.name}): active=${tp.active} queue=${tp.queue} rejected=${tp.rejected}`);
        }
      }
    }
  } catch (err) {
    log(`  could not get thread pool stats: ${err.message}`);
  }

  log('>>> snapshot complete\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await databaseManager.connectAll({ google: networks.google });
  const conns = databaseManager.getConnections('google');
  if (!conns?.elastic) throw new Error('Could not connect to google Elasticsearch.');
  const client = conns.elastic.client;

  log(`watching google ES — threshold=${args.threshold}% cpu, poll every ${args.interval}s, ${args.cooldown}s cooldown after a capture`);
  log('Ctrl+C to stop.\n');

  let lastCaptureAt = 0;
  let stopped = false;
  process.on('SIGINT', () => { stopped = true; });
  process.on('SIGTERM', () => { stopped = true; });

  while (!stopped) {
    try {
      const statsResp = (await client.nodes.stats({ metric: ['os'] })).body || (await client.nodes.stats({ metric: ['os'] }));
      let maxCpu = 0;
      let maxLoad = 0;
      for (const node of Object.values(statsResp.nodes || {})) {
        const cpu = node.os?.cpu?.percent;
        const load = node.os?.cpu?.load_average?.['1m'];
        if (Number.isFinite(cpu)) maxCpu = Math.max(maxCpu, cpu);
        if (Number.isFinite(load)) maxLoad = Math.max(maxLoad, load);
      }
      log(`cpu=${maxCpu}% load1m=${maxLoad}`);

      if (maxCpu >= args.threshold && Date.now() - lastCaptureAt > args.cooldown * 1000) {
        lastCaptureAt = Date.now();
        await captureSpike(client, maxCpu, maxLoad);
      }
    } catch (err) {
      log(`poll error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, args.interval * 1000));
  }

  log('stopping...');
  await databaseManager.disconnectAll();
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});

'use strict';

/**
 * Cancel long-running Elasticsearch search tasks on the google cluster —
 * the manual follow-up to scripts/diagnose-google-load.js's "FIX: cancel
 * these task ids" step, automated.
 *
 * Default (no flags) is a DRY RUN: lists every search task running longer
 * than --threshold and what it would cancel, but cancels nothing.
 *
 * Usage:
 *   node scripts/cancel-google-es-tasks.js                  # dry run, 5s threshold
 *   node scripts/cancel-google-es-tasks.js --threshold=10    # dry run, custom threshold
 *   node scripts/cancel-google-es-tasks.js --confirm         # actually cancel everything over threshold
 *   node scripts/cancel-google-es-tasks.js --task-id=nUDgOtIsRJmjukLIJ0vXjQ:26949   # cancel one specific task
 */

require('dotenv').config();
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

function parseArgs(argv) {
  const args = { threshold: 5, confirm: false };
  for (const token of argv) {
    if (token === '--confirm') { args.confirm = true; continue; }
    const [key, value] = token.replace(/^--/, '').split('=');
    if (key === 'threshold') args.threshold = Number(value) || 5;
    if (key === 'task-id') args.taskId = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await databaseManager.connectAll({ google: networks.google });
  const conns = databaseManager.getConnections('google');
  if (!conns?.elastic) throw new Error('Could not connect to google Elasticsearch — check config.json / env on this host.');
  const client = conns.elastic.client;

  // ─── Cancel one specific task id ───
  if (args.taskId) {
    console.log(`Cancelling task ${args.taskId} ...`);
    const res = await client.tasks.cancel({ taskId: args.taskId });
    console.log(JSON.stringify(res.body || res, null, 2));
    await databaseManager.disconnectAll();
    return;
  }

  // ─── Find + (optionally) cancel every long-running search task ───
  const tasks = (await client.tasks.list({ detailed: true, actions: '*search*' })).body
    || (await client.tasks.list({ detailed: true, actions: '*search*' }));

  const running = [];
  for (const [nodeId, node] of Object.entries(tasks.nodes || {})) {
    for (const [taskId, task] of Object.entries(node.tasks || {})) {
      // Only top-level coordinating search tasks (cancelling these also stops
      // their child shard-phase tasks) — skip the `[phase/query]` children.
      if (task.action !== 'indices:data/read/search') continue;
      running.push({
        taskId,
        runningSec: Math.round((task.running_time_in_nanos || 0) / 1e8) / 10,
        description: String(task.description || '').slice(0, 180),
      });
    }
  }
  running.sort((a, b) => b.runningSec - a.runningSec);

  const toCancel = running.filter((t) => t.runningSec >= args.threshold);

  console.log(`${running.length} search task(s) running, ${toCancel.length} at/over ${args.threshold}s:\n`);
  toCancel.forEach((t) => console.log(`  [${t.runningSec}s] ${t.taskId} :: ${t.description}`));

  if (!toCancel.length) {
    console.log('\nNothing to cancel.');
    await databaseManager.disconnectAll();
    return;
  }

  if (!args.confirm) {
    console.log(`\nDRY RUN — nothing cancelled. Re-run with --confirm to actually cancel the ${toCancel.length} task(s) above,`);
    console.log('or cancel just one: node scripts/cancel-google-es-tasks.js --task-id=<id>');
    await databaseManager.disconnectAll();
    return;
  }

  for (const t of toCancel) {
    try {
      await client.tasks.cancel({ taskId: t.taskId });
      console.log(`cancelled ${t.taskId}`);
    } catch (err) {
      console.log(`could not cancel ${t.taskId}: ${err.message}`);
    }
  }

  await databaseManager.disconnectAll();
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});

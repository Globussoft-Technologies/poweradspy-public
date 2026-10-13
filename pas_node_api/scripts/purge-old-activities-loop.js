'use strict';

/**
 * Purge user_activities docs older than 90 days directly from Elasticsearch
 * (no API call), in small batches: delete --docs docs, wait --interval seconds,
 * repeat until nothing older than 90 days is left.
 *
 * Each batch is a delete_by_query with max_docs=--docs that waits for completion,
 * so batches never overlap and every log line shows the real deleted count.
 *
 * Uses the same user_activity ES connection as the app (config.json / UA_ELASTIC_* env).
 *
 * Usage:
 *   node scripts/purge-old-activities-loop.js --docs=500 --interval=30
 *   node scripts/purge-old-activities-loop.js --docs=500 --interval=30 --max-runs=10
 *   node scripts/purge-old-activities-loop.js --dry-run          # only count matching docs, delete nothing
 *
 * Options:
 *   --docs=N        docs to delete per batch (default 500)
 *   --interval=S    seconds to wait between batches (default 30)
 *   --days=D        delete docs older than D days (default 90)
 *   --max-runs=N    stop after N batches (default: run until 0 docs remain)
 *   --dry-run       count only, delete nothing
 */

require('dotenv').config();
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

const DAY_S = 24 * 60 * 60;

function parseArgs(argv) {
  const args = { docs: 500, interval: 30, days: 90, maxRuns: null, dryRun: false };
  for (const token of argv) {
    if (token === '--dry-run') { args.dryRun = true; continue; }
    const [key, value] = token.replace(/^--/, '').split('=');
    if (key === 'docs') args.docs = parseInt(value, 10);
    if (key === 'interval') args.interval = Number(value);
    if (key === 'days') args.days = parseInt(value, 10);
    if (key === 'max-runs') args.maxRuns = parseInt(value, 10);
  }
  if (!Number.isInteger(args.docs) || args.docs <= 0) throw new Error('--docs must be a positive integer');
  if (!(args.interval > 0)) throw new Error('--interval must be a positive number of seconds');
  if (!Number.isInteger(args.days) || args.days <= 0) throw new Error('--days must be a positive integer');
  if (args.maxRuns !== null && (!Number.isInteger(args.maxRuns) || args.maxRuns <= 0)) {
    throw new Error('--max-runs must be a positive integer');
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ts = () => new Date().toISOString();

let stopping = false;
process.on('SIGINT', () => {
  console.log(`\n[${ts()}] Ctrl+C received — stopping after the current batch.`);
  stopping = true;
});

async function countOld(client, index, rangeQuery) {
  const res = await client.count({ index, body: { query: rangeQuery } });
  return res?.body?.count ?? res?.count ?? 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Connect only the user_activity Elasticsearch (skip its Mongo).
  const ua = networks.user_activity;
  await databaseManager.connectAll({
    user_activity: { ...ua, database: { elastic: ua.database.elastic } },
  });
  const conn = databaseManager.getElastic('user_activity');
  if (!conn?.client) throw new Error('Could not connect to user_activity Elasticsearch — check config.json / UA_ELASTIC_* env.');
  const client = conn.client;
  const index = conn.indexName || 'user_activities';
  // delete_by_query doc limit: ES 7.3+ uses max_docs, ES 6.x uses size.
  const limitParam = conn.esMajor && conn.esMajor < 7 ? 'size' : 'max_docs';

  const cutoffTs = () => Math.floor(Date.now() / 1000) - args.days * DAY_S;
  const rangeQuery = () => ({ range: { dateTime: { lt: cutoffTs() } } });

  const initial = await countOld(client, index, rangeQuery());
  console.log(`[${ts()}] Index: ${index} (ES ${conn.esMajor || '?'}.x, limit param: ${limitParam})`);
  console.log(`[${ts()}] Cutoff: ${new Date(cutoffTs() * 1000).toISOString()} (older than ${args.days} days)`);
  console.log(`[${ts()}] Docs matching: ${initial}`);

  if (args.dryRun) {
    const runs = Math.ceil(initial / args.docs);
    const hours = (runs * args.interval) / 3600;
    console.log(`[${ts()}] DRY RUN — nothing deleted. At ${args.docs} docs / ${args.interval}s: ${runs} batch(es), ≈${hours.toFixed(1)}h`);
    return;
  }
  if (initial === 0) {
    console.log(`[${ts()}] Nothing to delete.`);
    return;
  }

  console.log(`[${ts()}] Deleting ${args.docs} docs every ${args.interval}s` +
    (args.maxRuns ? `, max ${args.maxRuns} batch(es)` : ', until 0 remain'));

  let runs = 0;
  let totalDeleted = 0;
  let consecutiveErrors = 0;

  while (!stopping) {
    if (args.maxRuns && runs >= args.maxRuns) {
      console.log(`[${ts()}] Reached --max-runs=${args.maxRuns}. Stopping.`);
      break;
    }
    runs++;

    try {
      const started = Date.now();
      const res = await client.deleteByQuery(
        {
          index,
          body: { query: rangeQuery() },
          [limitParam]: args.docs,
          conflicts: 'proceed',
          refresh: true,
        },
        { requestTimeout: 120000, maxRetries: 0 }
      );
      const body = res?.body ?? res ?? {};
      const deleted = body.deleted ?? 0;
      const failures = (body.failures || []).length;
      totalDeleted += deleted;
      consecutiveErrors = 0;

      const remaining = Math.max(initial - totalDeleted, 0);
      const etaHours = (Math.ceil(remaining / args.docs) * args.interval) / 3600;
      console.log(
        `[${ts()}] Batch #${runs}: deleted=${deleted} failures=${failures} took=${Date.now() - started}ms ` +
        `total_deleted=${totalDeleted} remaining≈${remaining} eta≈${etaHours.toFixed(1)}h`
      );

      if (deleted === 0) {
        const left = await countOld(client, index, rangeQuery());
        if (left === 0) {
          console.log(`[${ts()}] No docs older than ${args.days} days left. Done.`);
          break;
        }
      }
    } catch (err) {
      consecutiveErrors++;
      console.error(`[${ts()}] Batch #${runs}: failed: ${err.message}`);
      if (consecutiveErrors >= 5) {
        console.error(`[${ts()}] 5 consecutive errors — stopping.`);
        process.exitCode = 1;
        break;
      }
    }

    if (!stopping) await sleep(args.interval * 1000);
  }

  console.log(`[${ts()}] Finished. Batches=${runs}, total deleted=${totalDeleted}`);
}

main()
  .catch((err) => {
    console.error(`[${ts()}] Fatal:`, err.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit());

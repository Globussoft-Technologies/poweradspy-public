'use strict';

/**
 * Kill long-running queries on instagram's MySQL — the manual follow-up to
 * watch-instagram-sql-spikes.js's captured snapshots, automated. The MySQL
 * analog of cancel-google-es-tasks.js (KILL <id> instead of tasks.cancel).
 *
 * Default (no flags) is a DRY RUN: lists every active query running longer
 * than --threshold and what it would kill, but kills nothing.
 *
 * Only non-Sleep/Daemon connections are ever considered — this never kills
 * an idle pooled connection, only a query actually in flight.
 *
 * Usage:
 *   node scripts/kill-instagram-sql-queries.js                  # dry run, 5s threshold
 *   node scripts/kill-instagram-sql-queries.js --threshold=10    # dry run, custom threshold
 *   node scripts/kill-instagram-sql-queries.js --confirm         # actually kill everything over threshold
 *   node scripts/kill-instagram-sql-queries.js --process-id=12345   # kill one specific connection id
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
    if (key === 'process-id') args.processId = value;
  }
  return args;
}

// KILL does not reliably accept a bound placeholder on every MySQL/mysql2
// combination — validate then inline, same convention used everywhere else
// in this codebase for values that can't safely go through a prepared
// statement (see docs/KEYWORDS_EXPLORER_MANIFEST.md §6).
function safeIntOrThrow(value, label) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== String(value).trim()) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await databaseManager.connectAll({ instagram: networks.instagram });
  const conns = databaseManager.getConnections('instagram');
  if (!conns?.sql) throw new Error('Could not connect to instagram MySQL — check config.json / env on this host.');
  const sql = conns.sql;

  // ─── Kill one specific connection id ───
  if (args.processId) {
    const id = safeIntOrThrow(args.processId, 'process-id');
    console.log(`Killing MySQL connection ${id} ...`);
    await sql.query(`KILL ${id}`);
    console.log('done.');
    await databaseManager.disconnectAll();
    return;
  }

  // ─── Find + (optionally) kill every long-running query ───
  const processlist = await sql.query('SHOW FULL PROCESSLIST');
  const busy = processlist.filter((r) => r.Command !== 'Sleep' && r.Command !== 'Daemon');
  const toKill = busy
    .filter((r) => Number(r.Time) >= args.threshold)
    .sort((a, b) => Number(b.Time) - Number(a.Time));

  console.log(`${busy.length} active connection(s), ${toKill.length} at/over ${args.threshold}s:\n`);
  toKill.forEach((r) => {
    const q = String(r.Info || '').replace(/\s+/g, ' ').slice(0, 180);
    console.log(`  [${r.Time}s] id=${r.Id} db=${r.db} state=${r.State || '-'} :: ${q}`);
  });

  if (!toKill.length) {
    console.log('\nNothing to kill.');
    await databaseManager.disconnectAll();
    return;
  }

  if (!args.confirm) {
    console.log(`\nDRY RUN — nothing killed. Re-run with --confirm to actually kill the ${toKill.length} connection(s) above,`);
    console.log('or kill just one: node scripts/kill-instagram-sql-queries.js --process-id=<id>');
    await databaseManager.disconnectAll();
    return;
  }

  for (const r of toKill) {
    try {
      const id = safeIntOrThrow(r.Id, 'Id');
      await sql.query(`KILL ${id}`);
      console.log(`killed ${id}`);
    } catch (err) {
      console.log(`could not kill ${r.Id}: ${err.message}`);
    }
  }

  await databaseManager.disconnectAll();
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});

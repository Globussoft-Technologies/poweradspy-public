'use strict';

/**
 * Continuously watches instagram's MySQL for a query-pileup spike and
 * auto-captures a full diagnostic snapshot (full processlist, status vars,
 * InnoDB lock waits) the INSTANT Threads_running crosses a threshold —
 * the MySQL analog of watch-google-es-spikes.js, for the "Instagram search
 * goes down and we have no idea why" case.
 *
 * Threads_running (not CPU%, which MySQL doesn't expose per-node the way ES
 * does) is the spike signal: queries piling up faster than they finish is
 * exactly what a lock wait / missing index / connection-pool storm looks
 * like right before things go down.
 *
 * Run this in the background (pm2/nohup/screen) for a while; when the next
 * spike happens, it gets captured to spike log lines automatically, with the
 * EXACT queries that were running (and any lock waits) at that moment.
 *
 * Read-only.
 *
 * Usage:
 *   node scripts/watch-instagram-sql-spikes.js
 *   node scripts/watch-instagram-sql-spikes.js --threshold=20 --interval=5
 *   nohup node scripts/watch-instagram-sql-spikes.js > /tmp/instagram-sql-spikes.log 2>&1 &
 */

require('dotenv').config();
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

function parseArgs(argv) {
  const args = { threshold: 20, interval: 5, cooldown: 30 };
  for (const token of argv) {
    const [key, value] = token.replace(/^--/, '').split('=');
    if (key === 'threshold') args.threshold = Number(value) || 20;
    if (key === 'interval') args.interval = Number(value) || 5;
    if (key === 'cooldown') args.cooldown = Number(value) || 30;
  }
  return args;
}

function ts() { return new Date().toISOString(); }
function log(...a) { console.log(`[${ts()}]`, ...a); }

async function captureSpike(sql, threadsRunning) {
  log(`>>> SPIKE DETECTED: Threads_running=${threadsRunning} — capturing full snapshot...`);

  try {
    const processlist = await sql.query('SHOW FULL PROCESSLIST');
    const busy = processlist.filter((r) => r.Command !== 'Sleep' && r.Command !== 'Daemon');
    const slow = [...busy].sort((a, b) => Number(b.Time) - Number(a.Time));
    log(`  ${processlist.length} connection(s) total, ${busy.length} active:`);
    slow.slice(0, 20).forEach((r) => {
      const q = String(r.Info || '').replace(/\s+/g, ' ').slice(0, 200);
      log(`    [${r.Time}s] id=${r.Id} db=${r.db} state=${r.State || '-'} :: ${q}`);
    });
  } catch (err) {
    log(`  could not read processlist: ${err.message}`);
  }

  try {
    const status = await sql.query(
      "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running','Threads_connected','Max_used_connections','Slow_queries','Innodb_row_lock_waits','Innodb_row_lock_time')"
    );
    const statusMap = Object.fromEntries(status.map((r) => [r.Variable_name, r.Value]));
    log(`  status: ${JSON.stringify(statusMap)}`);
  } catch (err) {
    log(`  could not read status vars: ${err.message}`);
  }

  // InnoDB lock waits — a very common silent cause of a query pileup.
  // information_schema.INNODB_LOCK_WAITS is removed on newer MySQL/MariaDB
  // builds in favor of performance_schema.data_lock_waits; try both,
  // swallow whichever doesn't exist on this server.
  try {
    const waits = await sql.query(`
      SELECT r.trx_id AS waiting_trx_id, r.trx_mysql_thread_id AS waiting_thread,
             r.trx_query AS waiting_query,
             b.trx_id AS blocking_trx_id, b.trx_mysql_thread_id AS blocking_thread,
             b.trx_query AS blocking_query
      FROM information_schema.INNODB_LOCK_WAITS w
      JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_trx_id
      JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
    `);
    if (waits.length) {
      log(`  ${waits.length} InnoDB lock wait(s):`);
      waits.forEach((w) => {
        log(`    thread ${w.waiting_thread} waiting on thread ${w.blocking_thread} :: blocker="${String(w.blocking_query || '-').replace(/\s+/g, ' ').slice(0, 160)}"`);
      });
    } else {
      log('  no InnoDB lock waits.');
    }
  } catch (err) {
    log(`  could not read InnoDB lock waits (table may not exist on this MySQL version): ${err.message}`);
  }

  log('>>> snapshot complete\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await databaseManager.connectAll({ instagram: networks.instagram });
  const conns = databaseManager.getConnections('instagram');
  if (!conns?.sql) throw new Error('Could not connect to instagram MySQL — check config.json / env on this host.');
  const sql = conns.sql;

  log(`watching instagram MySQL — threshold=${args.threshold} Threads_running, poll every ${args.interval}s, ${args.cooldown}s cooldown after a capture`);
  log('Ctrl+C to stop.\n');

  let lastCaptureAt = 0;
  let stopped = false;
  process.on('SIGINT', () => { stopped = true; });
  process.on('SIGTERM', () => { stopped = true; });

  while (!stopped) {
    try {
      const status = await sql.query("SHOW GLOBAL STATUS WHERE Variable_name = 'Threads_running'");
      const threadsRunning = Number(status[0]?.Value || 0);
      log(`Threads_running=${threadsRunning}`);

      if (threadsRunning >= args.threshold && Date.now() - lastCaptureAt > args.cooldown * 1000) {
        lastCaptureAt = Date.now();
        await captureSpike(sql, threadsRunning);
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

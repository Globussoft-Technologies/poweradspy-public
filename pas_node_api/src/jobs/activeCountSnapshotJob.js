'use strict';

/**
 * Active-count snapshot job.
 *
 * Just after midnight, freezes each network's "active ads" count for the day that
 * just ended — `COUNT(id) FROM <net>_ad WHERE last_seen ∈ [day, day+1)` — into a
 * per-network `active_count_snapshots` table. The admin panel reads these frozen
 * values for past dates, so Total Ads stays CONSISTENT (a live last_seen query
 * keeps shrinking as ads are re-crawled). Today is still computed live by the API.
 *
 * Storage is per-network (the table lives in each network's own DB) so it reuses
 * the existing per-network routing on both sides — pas_node_api writes here with
 * its write-capable connection, the admin panel reads with its read-only one.
 */

const databaseManager = require('../database/DatabaseManager');
const logger = require('../logger');
const config = require('../config');

const log = logger.createChild('active-count-snapshot');

// network slug → main ad table. Mirrors the admin get-count DB_DATA. Networks
// without a configured SQL connection (e.g. bing/tiktok here) are skipped.
const NETWORK_TABLES = {
  facebook: 'facebook_ad',
  instagram: 'instagram_ad',
  google: 'google_text_ad',
  gdn: 'gdn_ad',
  native: 'native_ad',
  pinterest: 'pinterest_ad',
  quora: 'quora_ad',
  reddit: 'reddit_ad',
  youtube: 'youtube_ad',
  bing: 'bing_text_ad',
  linkedin: 'linkedin_ad',
};

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS active_count_snapshots (
  snapshot_date DATE NOT NULL PRIMARY KEY,
  active_count  BIGINT NOT NULL,
  taken_at      DATETIME NOT NULL
)`;

// "YYYY-MM-DD" for the given instant in a timezone (so "yesterday" is the day that
// just ended in that TZ, regardless of server TZ).
function dateInTz(tz, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Add `n` calendar days to a YYYY-MM-DD string (UTC-safe).
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "YYYY-MM-DD HH:mm:ss" now, in a timezone (for the taken_at audit column).
function nowInTz(tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// Snapshot one network for one date. Returns a result object (never throws to the loop).
async function snapshotNetwork(network, date, retentionDays, tz) {
  const table = NETWORK_TABLES[network];
  if (!table) return { network, skipped: 'no table mapping' };

  const sqlConn = databaseManager.getSQL(network);
  if (!sqlConn) return { network, skipped: 'no sql connection' };

  const conn = await sqlConn.getConnection();
  try {
    await conn.query(CREATE_TABLE_SQL);

    const from = `${date} 00:00:00`;
    const to = `${addDays(date, 1)} 00:00:00`;
    const [rows] = await conn.query(
      `SELECT COUNT(id) AS cnt FROM ${table} WHERE last_seen >= ? AND last_seen < ?`,
      [from, to],
    );
    const count = Number(rows?.[0]?.cnt || 0);

    await conn.query(
      `INSERT INTO active_count_snapshots (snapshot_date, active_count, taken_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE active_count = VALUES(active_count), taken_at = VALUES(taken_at)`,
      [date, count, nowInTz(tz)],
    );

    const cutoff = addDays(date, -retentionDays);
    const [del] = await conn.query(
      `DELETE FROM active_count_snapshots WHERE snapshot_date < ?`,
      [cutoff],
    );

    return { network, date, count, pruned: del?.affectedRows || 0 };
  } finally {
    conn.release();
  }
}

/**
 * Snapshot every network for a date (default: the day that just ended, in the
 * cron timezone). Safe to re-run (idempotent upsert). Returns a per-network summary.
 *
 * @param {Object}   [opts]
 * @param {string}   [opts.date]          YYYY-MM-DD to snapshot (default: yesterday in TZ)
 * @param {number}   [opts.retentionDays] keep this many days (default 365)
 * @param {string[]} [opts.networks]      subset of networks (default: all mapped)
 */
async function runActiveCountSnapshot({ date, retentionDays = 365, networks } = {}) {
  const tz = config.crons?.timezone || 'Asia/Kolkata';
  const targetDate = date || addDays(dateInTz(tz), -1);
  const list = (networks && networks.length) ? networks : Object.keys(NETWORK_TABLES);

  const results = [];
  for (const net of list) {
    try {
      results.push(await snapshotNetwork(net, targetDate, retentionDays, tz));
    } catch (err) {
      log.error('snapshot failed', { network: net, date: targetDate, error: err.message });
      results.push({ network: net, error: err.message });
    }
  }

  const done = results.filter((r) => r.count !== undefined);
  log.info(`active-count snapshot ${targetDate}: ${done.length}/${list.length} networks stored`, {
    date: targetDate,
    counts: done.map((r) => `${r.network}=${r.count}`).join(' '),
  });
  return { date: targetDate, results };
}

module.exports = {
  runActiveCountSnapshot,
  snapshotNetwork,
  NETWORK_TABLES,
  CREATE_TABLE_SQL,
  _internals: { dateInTz, addDays, nowInTz },
};

'use strict';

/**
 * One-time repair: ES docs hidden with copyright_status 0 while their SQL row says 1 (approved).
 * Cause: before the index-hook fix, a re-index of facebook / instagram / gdn / reddit / quora / pinterest /
 * native could not read the flat 'x_ad.id' key and wrote 0. Nothing else would ever fix those docs.
 *
 *   node src/services/copyrightVerification/repairEs.js                       # dry-run: count only
 *   node src/services/copyrightVerification/repairEs.js --apply               # set those docs to 1
 *   node src/services/copyrightVerification/repairEs.js --networks=facebook --apply
 *
 * Reads ES docs with copyright_status = 0 in pages (scroll, 1000 at a time), looks their ids up in SQL by
 * primary key, and sets ES to 1 only where SQL is 1. SQL 0 (still pending) and 2 (failed) are left alone,
 * and so are docs whose SQL row does not exist. SQL is never written.
 */

require('dotenv').config();
const networksConfig = require('../../config/networks');
const databaseManager = require('../../database/DatabaseManager');
const { NETWORKS, APPROVED, PENDING } = require('./status');

const apply = process.argv.includes('--apply');
const only = (process.argv.find((a) => a.startsWith('--networks=')) || '').split('=')[1];
const selected = (only ? only.split(',') : Object.keys(NETWORKS)).map((n) => n.trim()).filter((n) => NETWORKS[n]);
const PAGE = 1000;

const bodyOf = (res) => res?.body || res;

function idOf(source, field) {
  const [outer, inner] = field.split('.');
  return source?.[field] ?? (inner ? source?.[outer]?.[inner] : undefined);
}

async function repair(network, db) {
  const [table, field, defaultIndex] = NETWORKS[network];
  const index = db.elastic.indexName || defaultIndex;
  const client = db.elastic.client;
  const old = Number(db.elastic.esMajor) <= 6;
  const counts = { hidden: 0, fixed: 0, sqlPending: 0, sqlFailed: 0, noSqlRow: 0 };
  let res = bodyOf(await client.search({ index, scroll: '2m', size: PAGE,
    body: { query: { term: { copyright_status: PENDING } }, _source: [field] } }));
  let scrollId = res._scroll_id;
  try {
    for (;;) {
      const hits = res?.hits?.hits || [];
      if (!hits.length) break;
      counts.hidden += hits.length;
      const ids = [...new Set(hits.map((h) => idOf(h._source, field)).filter((v) => /^\d+$/.test(String(v ?? ''))).map(String))];
      const rows = ids.length ? await db.sql.query(`SELECT id, copyright_status FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [];
      const sqlStatus = new Map(rows.map((r) => [String(r.id), Number(r.copyright_status)]));
      const toFix = [];
      for (const h of hits) {
        const st = sqlStatus.get(String(idOf(h._source, field)));
        if (st === APPROVED) toFix.push(h);
        else if (st === undefined) counts.noSqlRow += 1;
        else if (st === PENDING) counts.sqlPending += 1;
        else counts.sqlFailed += 1;
      }
      if (toFix.length && apply) {
        const body = toFix.flatMap((h) => [
          { update: { _index: h._index || index, _id: h._id, ...(old ? { _type: h._type || 'doc' } : {}) } },
          { doc: { copyright_status: APPROVED } },
        ]);
        const out = bodyOf(await client.bulk({ body, refresh: false }));
        const bad = (out.items || []).filter((i) => i.update?.error).length;
        counts.fixed += toFix.length - bad;
        if (bad) console.log(`  warn      ${bad} ES updates failed in this page`);
      } else counts.fixed += toFix.length;
      res = bodyOf(await client.scroll({ scroll_id: scrollId, scroll: '2m' }));
      scrollId = res._scroll_id || scrollId;
    }
  } finally {
    if (scrollId) await client.clearScroll({ scroll_id: scrollId }).catch(() => {});
  }
  console.log(`  ES docs at 0: ${counts.hidden} | ${apply ? 'set to 1' : 'would set to 1'} (SQL = 1): ${counts.fixed}`
    + ` | left: SQL pending ${counts.sqlPending}, SQL failed ${counts.sqlFailed}, no SQL row ${counts.noSqlRow}`);
}

async function main() {
  const scoped = {};
  for (const n of selected) {
    const c = networksConfig[n]?.database;
    if (c?.sql && c?.elastic) scoped[n] = { enabled: true, database: { sql: { ...c.sql, enabled: true }, elastic: { ...c.elastic, enabled: true } } };
  }
  await databaseManager.connectAll(scoped);
  let failures = 0;
  for (const network of selected) {
    const db = databaseManager.getConnections(network);
    console.log(`\n${network}`);
    if (!db?.sql || !db?.elastic) { console.log('  FAIL      SQL or ES not connected'); failures++; continue; }
    try { await repair(network, db); }
    catch (error) { console.log(`  FAIL      ${error.message}`); failures++; }
  }
  if (!apply) console.log('\nDry-run only. Re-run with --apply to update ES.');
  return failures ? 1 : 0;
}

if (require.main === module) {
  main()
    .then(async (code) => { await databaseManager.disconnectAll().catch(() => {}); process.exit(code); })
    .catch(async (error) => { console.error('[copyright-repair-es] FATAL', error.message); await databaseManager.disconnectAll().catch(() => {}); process.exit(1); });
}

module.exports = { repair, idOf };

'use strict';

/**
 * One-time setup for Google custom keywords (the `custom_keyword` field on ads).
 *
 *   ES  : adds `custom_keyword` (keyword) to the live Google index mapping. The index is
 *         dynamic:false, so without this the field is stored but NOT searchable. Additive —
 *         no reindex; only ads written after this carry the field.
 *   SQL : adds `custom_keyword TEXT NULL` to google_text_ad_variants with ALGORITHM=INSTANT
 *         (metadata-only: no table rewrite, no backfill). If MySQL cannot do it INSTANT the
 *         statement FAILS instead of rewriting the table. It still takes a very brief
 *         metadata lock, so run it in a quiet window.
 *
 * Usage:
 *   node scripts/apply-custom-keywords-schema.js                       # dry run (default)
 *   node scripts/apply-custom-keywords-schema.js --apply               # ES + SQL
 *   node scripts/apply-custom-keywords-schema.js --apply --only=es     # just ES
 *   node scripts/apply-custom-keywords-schema.js --apply --only=sql    # just SQL (quiet window)
 *
 * Run this BEFORE setting customKeywords.enabled = true.
 */
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

const apply = process.argv.includes('--apply');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const doEs = !onlyArg || onlyArg === 'es';
const doSql = !onlyArg || onlyArg === 'sql';

const TABLE = 'google_text_ad_variants';
const COLUMN = 'custom_keyword';
const ALTER_SQL = `ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} TEXT NULL, ALGORITHM=INSTANT`;
const ES_FIELDS = { properties: { [COLUMN]: { type: 'keyword' } } };

const selectRows = (result) => (!Array.isArray(result) ? [] : (Array.isArray(result[0]) ? result[0] : result));

async function applyEs(indexName) {
  const elastic = databaseManager.getElastic('google');
  if (!elastic?.client) throw new Error('Google Elasticsearch connection is unavailable');
  const current = await elastic.client.indices.getMapping({ index: indexName });
  const body = current?.body || current || {};
  const mappings = body[indexName]?.mappings || {};
  const props = mappings.doc?.properties || mappings.properties || {};
  if (props[COLUMN]) {
    if (props[COLUMN].type !== 'keyword') throw new Error(`${COLUMN} already exists in ${indexName} as '${props[COLUMN].type}', expected keyword`);
    console.log(`ES : ${COLUMN} already mapped on ${indexName} — nothing to do.`);
    return;
  }
  const params = { index: indexName, body: ES_FIELDS };
  if (elastic.esMajor && elastic.esMajor < 7) params.type = 'doc';
  await elastic.client.indices.putMapping(params);
  console.log(`ES : mapped ${COLUMN} on ${indexName}.`);
}

async function applySql() {
  const sql = databaseManager.getSQL('google');
  if (!sql) throw new Error('Google SQL connection is unavailable');
  const [{ v }] = selectRows(await sql.query('SELECT VERSION() AS v'));
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v));
  const ver = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const instantOk = ver[0] > 8 || (ver[0] === 8 && (ver[1] > 0 || ver[2] >= 12));
  if (String(v).toLowerCase().includes('mariadb') || !instantOk) {
    throw new Error(`MySQL ${v} cannot be trusted to add a column INSTANT (needs MySQL >= 8.0.12). Not running the ALTER.`);
  }
  const exists = selectRows(await sql.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [TABLE, COLUMN]
  ));
  if (exists.length) { console.log(`SQL: ${TABLE}.${COLUMN} already exists — nothing to do.`); return; }
  await sql.query(ALTER_SQL);
  console.log(`SQL: added ${TABLE}.${COLUMN} (MySQL ${v}, INSTANT).`);
}

async function main() {
  const indexName = networks.google?.database?.elastic?.index || 'google_ads_data_v2';
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (pass --apply to execute)'}`);
  if (doEs) console.log(`ES : PUT mapping on ${networks.google?.database?.elastic?.node}/${indexName}: ${JSON.stringify(ES_FIELDS)}`);
  if (doSql) console.log(`SQL: ${ALTER_SQL}`);
  if (!apply) return;

  await databaseManager.connectAll({ google: networks.google });
  if (doEs) await applyEs(indexName);
  if (doSql) await applySql();
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error.message || error); process.exitCode = 1; })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = { main, ALTER_SQL, ES_FIELDS };

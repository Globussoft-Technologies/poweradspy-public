'use strict';

/**
 * Backfill / audit: repair MySQL → Elasticsearch drift on the Ecommerce
 * Platform (`built_with`) and Funnel Type (`built_with_analytics_tracking`)
 * fields that the "Ecommerce Platform" and "Funnel" search filters query.
 *
 * Background: `api/app/Jobs/BuiltWithProcessing.php` (Facebook's async
 * tech-detection callback job — duplicated at `user_activity/app/Jobs/...`)
 * wrote both fields correctly to MySQL but only pushed
 * `built_with_analytics_tracking` in its Elasticsearch partial-document
 * update, silently dropping `built_with`. Effect: an ad whose detection
 * discovered BOTH an ecommerce platform and a funnel tool in the same pass
 * ends up with the funnel value in ES but not the ecommerce value (unless a
 * later full reindex catches it up) — so combining the two filters together
 * returns "No ads found" for ads that actually qualify for both. Confirmed
 * live: MySQL `facebook_ad_meta_data` has 134 ads with both fields set, 0 of
 * which the search_mix index agreed on before this fix (2026-07-15 dev
 * snapshot). The PHP job itself has been fixed to include `built_with` in the
 * ES doc going forward — this script repairs ads that already drifted.
 *
 * The other 9 networks (instagram, gdn, native, pinterest, quora, reddit,
 * linkedin, youtube, google) were audited and their equivalent callback jobs
 * already sync both fields correctly — they're included here anyway as a
 * standing drift-detector (any future regression, ES outage, etc. would show
 * up as a non-zero mismatch count) rather than because a bug is expected.
 *
 * What it does per network:
 *   1. Read every SQL row where `built_with` and/or the funnel field is set
 *      (paginated by primary id, no OFFSET — safe on large tables).
 *   2. Look up the matching Elasticsearch doc(s) by the network's ad-id field
 *      (a `terms` query per batch — updates EVERY matching doc, since a given
 *      ad id can have more than one document in these indices).
 *   3. For any ES doc missing a field MySQL has, report the drift; in
 *      --apply mode, push just the missing field(s) via a partial `bulk`
 *      update (never touches fields that already agree).
 *
 * Usage:
 *   node scripts/backfill-built-with-es-sync.js                       # DRY RUN — report only
 *   node scripts/backfill-built-with-es-sync.js --apply                # repair drifted docs
 *   node scripts/backfill-built-with-es-sync.js --network=facebook     # scope to one/some networks
 *   node scripts/backfill-built-with-es-sync.js --apply --network=facebook,instagram
 *
 * Idempotent — a doc already in sync is left untouched; safe to re-run.
 * PROD: run with the prod environment loaded; it prints the SQL host/schema
 * and ES node per network before touching anything.
 */

require('dotenv').config();
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');

const SQL_BATCH_SIZE = 500;
const ES_TERMS_CHUNK = 500;

// network → { SQL table + id column that carry built_with/funnel, and the
// ES field paths the search filters actually query (see the per-network
// `_getBuiltWithEnv`/`_getFunnelEnv` in each SearchQueryBuilder). `esIdField`
// is the ES field the network's ad id is stored under.
// `pkCol` is the table's own primary key, used only to paginate the SQL scan
// (never sent to ES). Defaults to `id` below — overridden per network where
// the ad-id column itself IS the primary key (verified via `SHOW KEYS`).
const NETWORK_CONFIGS = {
  facebook: {
    table: 'facebook_ad_meta_data', sqlIdCol: 'facebook_ad_id', pkCol: 'facebook_ad_id',
    esIdField: 'facebook_ad.id',
    esBuiltWithField: 'facebook_ad_meta_data.built_with',
    esFunnelField: 'facebook_ad_meta_data.built_with_analytics_tracking',
  },
  instagram: {
    table: 'instagram_ad_meta_data', sqlIdCol: 'instagram_ad_id',
    esIdField: 'instagram_ad.id',
    esBuiltWithField: 'instagram_ad_meta_data.built_with',
    esFunnelField: 'instagram_ad_meta_data.built_with_analytics_tracking',
  },
  gdn: {
    table: 'gdn_ad_meta_data', sqlIdCol: 'gdn_ad_id',
    esIdField: 'gdn_ad.id',
    esBuiltWithField: 'gdn_ad_meta_data.built_with',
    esFunnelField: 'gdn_ad_meta_data.built_with_analytics_tracking',
  },
  native: {
    table: 'native_ad_meta_data', sqlIdCol: 'native_ad_id',
    esIdField: 'native_ad.id',
    esBuiltWithField: 'native_ad_meta_data.built_with',
    esFunnelField: 'native_ad_meta_data.built_with_analytics_tracking',
  },
  pinterest: {
    table: 'pinterest_ad_meta_data', sqlIdCol: 'pinterest_ad_id',
    esIdField: 'pinterest_ad.id',
    esBuiltWithField: 'pinterest_ad_meta_data.built_with',
    esFunnelField: 'pinterest_ad_meta_data.built_with_analytics_tracking',
  },
  quora: {
    table: 'quora_ad_meta_data', sqlIdCol: 'quora_ad_id',
    esIdField: 'quora_ad.id',
    esBuiltWithField: 'quora_ad_meta_data.built_with',
    esFunnelField: 'quora_ad_meta_data.built_with_analytics_tracking',
  },
  reddit: {
    table: 'reddit_ad_meta_data', sqlIdCol: 'reddit_ad_id',
    esIdField: 'reddit_ad.id',
    esBuiltWithField: 'reddit_ad_meta_data.built_with',
    esFunnelField: 'reddit_ad_meta_data.built_with_analytics_tracking',
  },
  // LinkedIn keeps built_with/funnel in a dedicated table (not *_ad_meta_data)
  // whose primary key IS linkedin_ad_id, and its ES doc uses flat, renamed
  // field names.
  linkedin: {
    table: 'linkedin_ad_built_with', sqlIdCol: 'linkedin_ad_id', pkCol: 'linkedin_ad_id',
    esIdField: 'ad_id',
    esBuiltWithField: 'ecommerce_platform',
    esFunnelField: 'funnel',
  },
  // YouTube's ES doc also uses flat, renamed field names.
  youtube: {
    table: 'youtube_ad_meta_data', sqlIdCol: 'youtube_ad_id',
    esIdField: 'ad_id',
    esBuiltWithField: 'ecommerce_platform',
    esFunnelField: 'funnel',
  },
  // Google's ES doc uses flat (but NOT renamed) field names.
  google: {
    table: 'google_text_ad_meta_data', sqlIdCol: 'google_text_ad_id',
    esIdField: 'id',
    esBuiltWithField: 'built_with',
    esFunnelField: 'built_with_analytics_tracking',
  },
};
const ALL_NETWORKS = Object.keys(NETWORK_CONFIGS);

function parseArgs(argv) {
  const args = { apply: false, networks: ALL_NETWORKS };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--network=')) {
      args.networks = a.slice('--network='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  const unknown = args.networks.filter((n) => !NETWORK_CONFIGS[n]);
  if (unknown.length) throw new Error(`Unknown network(s): ${unknown.join(', ')}. Valid: ${ALL_NETWORKS.join(', ')}`);
  return args;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function schemaHost(sql) {
  try {
    const r = await sql.query('SELECT @@hostname host, DATABASE() db');
    return r && r[0] ? `${r[0].host}/${r[0].db}` : '(unknown)';
  } catch { return '(unknown)'; }
}

// Reads every SQL row with a non-empty built_with or funnel value, paginated
// by primary key (no OFFSET) so this stays cheap on large tables.
async function* readSqlRows(sql, cfg) {
  const pkCol = cfg.pkCol || 'id';
  let lastId = 0;
  for (;;) {
    // LIMIT is a script-controlled constant (SQL_BATCH_SIZE), not user input —
    // interpolated directly since mysql2's prepared-statement protocol
    // (pool.execute) can reject a bound placeholder in the LIMIT position.
    const rows = await sql.query(
      `SELECT ${pkCol} AS pk, ${cfg.sqlIdCol} AS ad_id, built_with, built_with_analytics_tracking
       FROM ${cfg.table}
       WHERE ${pkCol} > ?
         AND ((built_with IS NOT NULL AND built_with != '')
              OR (built_with_analytics_tracking IS NOT NULL AND built_with_analytics_tracking != ''))
       ORDER BY ${pkCol}
       LIMIT ${SQL_BATCH_SIZE}`,
      [lastId]
    );
    if (!rows || !rows.length) return;
    yield rows;
    lastId = rows[rows.length - 1].pk;
    if (rows.length < SQL_BATCH_SIZE) return;
  }
}

function esValue(source, field) {
  // ES `_source` for dotted paths (e.g. "facebook_ad_meta_data.built_with")
  // comes back as a nested object unless the field is genuinely stored flat;
  // support both shapes.
  if (field in source) return source[field];
  return field.split('.').reduce((o, k) => (o == null ? o : o[k]), source);
}

async function main() {
  const { apply, networks } = parseArgs(process.argv.slice(2));
  console.log(`\n=== backfill-built-with-es-sync — ${apply ? 'APPLY' : 'DRY RUN (no changes)'} ===`);
  console.log(`networks: ${networks.join(', ')}\n`);

  await databaseManager.connectAll(networksConfig);

  const summary = [];
  for (const net of networks) {
    const cfg = NETWORK_CONFIGS[net];
    const sql = databaseManager.getSQL(net);
    const elastic = databaseManager.getElastic(net);
    if (!sql || !elastic) {
      console.log(`[${net}] SKIP — missing ${!sql ? 'SQL' : 'Elasticsearch'} connection`);
      summary.push({ net, skipped: !sql ? 'no-sql' : 'no-elastic' });
      continue;
    }

    const where = await schemaHost(sql);
    console.log(`[${net}] ${cfg.table} @ ${where} → index "${elastic.indexName}"`);

    let sqlRowsScanned = 0;
    let esDocsChecked = 0;
    let missingEcommerce = 0;
    let missingFunnel = 0;
    let docsFixed = 0;
    const sampleDrift = [];

    for await (const rows of readSqlRows(sql, cfg)) {
      sqlRowsScanned += rows.length;
      const byAdId = new Map();
      for (const r of rows) {
        // `id` is a MySQL AUTO_INCREMENT PK — several networks (this one
        // included) can have more than one meta row per ad id; keep the
        // latest (highest `id`, already the query's natural iteration order).
        byAdId.set(String(r.ad_id), r);
      }
      const adIds = [...byAdId.keys()];

      for (const idBatch of chunk(adIds, ES_TERMS_CHUNK)) {
        const res = await elastic.search({
          index: elastic.indexName,
          body: {
            size: ES_TERMS_CHUNK * 2, // a given ad id can legitimately span >1 doc
            _source: [cfg.esIdField, cfg.esBuiltWithField, cfg.esFunnelField],
            query: { terms: { [cfg.esIdField]: idBatch.map((v) => (Number.isFinite(+v) ? +v : v)) } },
          },
        });
        const hits = (res.hits || res.body.hits).hits || [];
        esDocsChecked += hits.length;

        const bulkOps = [];
        for (const hit of hits) {
          const src = hit._source || {};
          const adId = String(esValue(src, cfg.esIdField));
          const sqlRow = byAdId.get(adId);
          if (!sqlRow) continue;

          const esBw = esValue(src, cfg.esBuiltWithField);
          const esFn = esValue(src, cfg.esFunnelField);
          const wantBw = sqlRow.built_with || null;
          const wantFn = sqlRow.built_with_analytics_tracking || null;

          const doc = {};
          if (wantBw && !esBw) { doc[cfg.esBuiltWithField] = wantBw; missingEcommerce++; }
          if (wantFn && !esFn) { doc[cfg.esFunnelField] = wantFn; missingFunnel++; }

          if (Object.keys(doc).length) {
            if (sampleDrift.length < 10) {
              sampleDrift.push({ ad_id: adId, es_doc_id: hit._id, missing: Object.keys(doc), mysql: { built_with: wantBw, built_with_analytics_tracking: wantFn } });
            }
            if (apply) {
              bulkOps.push({ update: { _index: elastic.indexName, _id: hit._id, ...(elastic.esMajor === 6 ? { _type: 'doc' } : {}) } });
              bulkOps.push({ doc });
            }
          }
        }

        if (apply && bulkOps.length) {
          const bulkRes = await elastic.bulk({ body: bulkOps, refresh: false });
          const body = bulkRes.body || bulkRes;
          const errored = (body.items || []).filter((it) => it.update && it.update.error);
          if (errored.length) {
            console.log(`   ! ${errored.length} bulk update error(s), e.g. ${JSON.stringify(errored[0].update.error)}`);
          }
          docsFixed += (bulkOps.length / 2) - errored.length;
        }
      }
    }

    console.log(`   scanned ${sqlRowsScanned} SQL row(s), checked ${esDocsChecked} ES doc(s)`);
    console.log(`   drift: ${missingEcommerce} doc(s) missing built_with, ${missingFunnel} doc(s) missing funnel`);
    if (apply) console.log(`   ✓ repaired ${docsFixed} doc(s)`);
    if (sampleDrift.length) console.log(`   sample:`, JSON.stringify(sampleDrift.slice(0, 5), null, 2));

    summary.push({
      net, sqlRowsScanned, esDocsChecked, missingEcommerce, missingFunnel,
      ...(apply ? { docsFixed } : {}),
    });
  }

  console.log('\n=== summary ===');
  for (const s of summary) console.log('  ', JSON.stringify(s));
  await databaseManager.disconnectAll();
}

main().catch((e) => { console.error('FATAL', e); databaseManager.disconnectAll().finally(() => process.exit(1)); });

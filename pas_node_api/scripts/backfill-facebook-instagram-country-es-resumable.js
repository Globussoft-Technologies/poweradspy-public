'use strict';

/**
 * Resumable SQL -> Elasticsearch country backfill for Facebook and Instagram.
 *
 * ES is the driving side: it returns only the small fields needed for the
 * repair, ordered newest-to-oldest by the indexed last_seen field. Each page
 * is then resolved against SQL with bounded primary-key IN queries. The cursor
 * is saved only after a page has completed, so an interrupted page is safely
 * retried on the next run.
 *
 * Dry-run is the default. --apply sends partial ES updates containing only the
 * relevant country field. A state file is used per mode by default; delete the
 * selected state file if a completely fresh traversal is required.
 *
 * Usage:
 *   node scripts/backfill-facebook-instagram-country-es-resumable.js
 *   node scripts/backfill-facebook-instagram-country-es-resumable.js --apply
 *   node scripts/backfill-facebook-instagram-country-es-resumable.js --apply --network=facebook
 *   node scripts/backfill-facebook-instagram-country-es-resumable.js --apply --es-batch-size=250 --sql-batch-size=100
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');

// Keep these conservative for production. They are intentionally easy to edit
// here and can also be overridden per run with the CLI flags below.
const ES_DOC_BATCH_SIZE = 500;
const SQL_ROW_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 5000;
const ES_REQUEST_TIMEOUT_MS = 120000;
const STATE_VERSION = 1;
const STATE_DIRECTORY = path.join(__dirname, '.state');
const APPLY_STATE_FILE = path.join(STATE_DIRECTORY, 'backfill-facebook-instagram-country-es.apply.json');
const DRY_RUN_STATE_FILE = path.join(STATE_DIRECTORY, 'backfill-facebook-instagram-country-es.dry-run.json');

const NETWORK_CONFIGS = {
  facebook: {
    adTable: 'facebook_ad',
    esIdField: 'facebook_ad.id',
    esLastSeenField: 'facebook_ad.last_seen',
    esCountryField: 'country_only.country',
    onlyRelationTable: 'facebook_ad_countries_only',
    legacyRelationTable: 'facebook_ad_countries',
    countryTable: 'country_only',
    relationAdColumn: 'facebook_ad_id',
  },
  instagram: {
    adTable: 'instagram_ad',
    esIdField: 'instagram_ad.id',
    esLastSeenField: 'instagram_ad.last_seen',
    esCountryField: 'instagram_country_only.country',
    onlyRelationTable: 'instagram_ad_countries_only',
    legacyRelationTable: 'instagram_ad_countries',
    countryTable: 'instagram_country_only',
    relationAdColumn: 'instagram_ad_id',
  },
};

const ALL_NETWORKS = Object.keys(NETWORK_CONFIGS);

function defaultStateFile(apply) {
  return apply ? APPLY_STATE_FILE : DRY_RUN_STATE_FILE;
}

function usage() {
  return [
    'Resumable Facebook/Instagram country SQL -> Elasticsearch backfill.',
    '',
    'Usage:',
    '  node scripts/backfill-facebook-instagram-country-es-resumable.js [options]',
    '',
    'Options:',
    '  --apply                 write SQL country values to Elasticsearch',
    '  --network=a,b            process only selected network(s)',
    `  --es-batch-size=N        ES documents fetched per page (default: ${ES_DOC_BATCH_SIZE})`,
    `  --sql-batch-size=N       ad IDs per SQL lookup (default: ${SQL_ROW_BATCH_SIZE})`,
    '  --state-file=PATH        checkpoint file (defaults to a mode-specific file under scripts/.state)',
    '  --help                   show this help',
    '',
    'The state file is updated after every completed page. Stop with Ctrl+C and rerun the same command to resume.',
  ].join('\n');
}

function parseBatchSize(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    throw new Error(`--${name} must be a safe integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    apply: false,
    networks: ALL_NETWORKS,
    esBatchSize: ES_DOC_BATCH_SIZE,
    sqlBatchSize: SQL_ROW_BATCH_SIZE,
    stateFile: null,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--network=')) {
      args.networks = arg.slice('--network='.length).split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    } else if (arg.startsWith('--es-batch-size=')) {
      args.esBatchSize = parseBatchSize(arg.slice('--es-batch-size='.length), 'es-batch-size');
    } else if (arg.startsWith('--sql-batch-size=')) {
      args.sqlBatchSize = parseBatchSize(arg.slice('--sql-batch-size='.length), 'sql-batch-size');
    } else if (arg.startsWith('--state-file=')) {
      const value = arg.slice('--state-file='.length).trim();
      if (!value) throw new Error('--state-file requires a path');
      args.stateFile = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const unknown = args.networks.filter((network) => !NETWORK_CONFIGS[network]);
  if (unknown.length) throw new Error(`Unknown network(s): ${unknown.join(', ')}. Valid: ${ALL_NETWORKS.join(', ')}`);
  if (!args.networks.length) throw new Error('At least one network must be selected');

  args.stateFile ||= defaultStateFile(args.apply);
  return args;
}

function responseBody(response) {
  return response?.body || response || {};
}

function esMethod(elastic, method) {
  const client = elastic?.client || elastic;
  if (typeof client?.[method] === 'function') return client[method].bind(client);
  throw new Error(`Elasticsearch client does not support ${method}()`);
}

function readSourceField(source, field) {
  if (!source || typeof source !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(source, field)) return source[field];
  return field.split('.').reduce((value, key) => (value == null ? value : value[key]), source);
}

function normalizeCountries(value) {
  const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return [...new Set(values
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
    .map((item) => String(item ?? '').trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function countriesEqual(left, right) {
  const a = normalizeCountries(left);
  const b = normalizeCountries(right);
  return a.length === b.length && a.every((country, index) => country === b[index]);
}

function uniqueIds(ids) {
  return [...new Set(ids
    .filter((id) => id !== null && id !== undefined && id !== '')
    .map(String))];
}

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

/**
 * Bounded SQL lookup. The first query uses the relation written by current
 * updates. Only IDs without a usable *_only country value use the legacy
 * fallback, keeping the normal path to one small indexed query.
 */
function sqlCountryQuery(cfg, relationTable, ids) {
  const placeholders = ids.map(() => '?').join(',');
  return `SELECT a.id AS ad_id,
                 a.last_seen AS last_seen,
                 GROUP_CONCAT(DISTINCT c.country ORDER BY c.country SEPARATOR ',') AS country_csv
            FROM ${cfg.adTable} AS a
            LEFT JOIN ${relationTable} AS ac ON ac.${cfg.relationAdColumn} = a.id
            LEFT JOIN ${cfg.countryTable} AS c ON c.id = ac.country_only_id
           WHERE a.id IN (${placeholders})
           GROUP BY a.id, a.last_seen`;
}

async function loadSqlRows(sql, cfg, ids) {
  const wantedIds = uniqueIds(ids);
  if (!wantedIds.length) return new Map();

  const primaryRows = await sql.query(sqlCountryQuery(cfg, cfg.onlyRelationTable, wantedIds), wantedIds);
  const byId = new Map((primaryRows || []).map((row) => [String(row.ad_id), row]));
  const fallbackIds = wantedIds.filter((id) => !normalizeCountries(byId.get(id)?.country_csv).length);

  if (fallbackIds.length) {
    const legacyRows = await sql.query(sqlCountryQuery(cfg, cfg.legacyRelationTable, fallbackIds), fallbackIds);
    for (const row of legacyRows || []) {
      const id = String(row.ad_id);
      if (!normalizeCountries(byId.get(id)?.country_csv).length) byId.set(id, row);
    }
  }

  return byId;
}

function sqlCountries(row) {
  return normalizeCountries(row?.country_csv);
}

function esPageQuery(cfg, size, cursor) {
  const body = {
    size,
    // Sorting by the indexed date plus the ad id gives search_after a cheap,
    // deterministic cursor without the deep OFFSET cost of from/size.
    sort: [
      { [cfg.esLastSeenField]: { order: 'desc', missing: '_last' } },
      { [cfg.esIdField]: { order: 'asc' } },
    ],
    track_total_hits: false,
    _source: [cfg.esIdField, cfg.esLastSeenField, cfg.esCountryField],
    query: {
      bool: {
        filter: [
          { exists: { field: cfg.esIdField } },
          { exists: { field: cfg.esLastSeenField } },
        ],
      },
    },
  };
  if (cursor) body.search_after = cursor;
  return body;
}

async function fetchEsPage(elastic, cfg, size, cursor) {
  const response = await esMethod(elastic, 'search')({
    index: elastic.indexName,
    body: esPageQuery(cfg, size, cursor),
  }, {
    requestTimeout: ES_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });
  return responseBody(response).hits?.hits || [];
}

function nextCursor(hits) {
  const sort = hits[hits.length - 1]?.sort;
  if (!Array.isArray(sort) || sort.length < 2) {
    throw new Error('Elasticsearch did not return sort values; refusing to advance the resumable cursor');
  }
  return sort;
}

function bulkUpdateOperations(elastic, cfg, updates) {
  const operations = [];
  for (const update of updates) {
    operations.push({
      update: {
        _index: elastic.indexName,
        _id: update.esDocumentId,
        ...(elastic.esMajor === 6 ? { _type: 'doc' } : {}),
      },
    });
    operations.push({ doc: { [cfg.esCountryField]: update.countries } });
  }
  return operations;
}

async function applyUpdates(elastic, operations) {
  if (!operations.length) return 0;

  const body = responseBody(await esMethod(elastic, 'bulk')({
    body: operations,
    refresh: false,
  }));
  const expected = operations.length / 2;
  const items = body.items || [];
  if (items.length !== expected) {
    throw new Error(`Elasticsearch bulk returned ${items.length} item(s) for ${expected} requested update(s)`);
  }

  const errors = items.filter((item) => {
    const result = item.update || {};
    return result.error || Number(result.status) >= 300;
  });
  if (errors.length) {
    throw new Error(`Elasticsearch bulk returned ${errors.length} error(s): ${JSON.stringify(errors[0].update?.error || errors[0])}`);
  }
  return expected;
}

function emptyProgress() {
  return {
    pages: 0,
    esDocumentsScanned: 0,
    sqlRowsMatched: 0,
    sqlRowsMissing: 0,
    sqlRowsWithoutCountry: 0,
    countryInSync: 0,
    countryDriftedDocuments: 0,
    esDocumentsUpdated: 0,
    invalidEsIds: 0,
    samples: [],
    lastSeen: null,
  };
}

function loadState(file, apply) {
  if (!fs.existsSync(file)) {
    return { version: STATE_VERSION, mode: apply ? 'apply' : 'dry-run', networks: {} };
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read state file ${file}: ${error.message}`);
  }
  if (state.version !== STATE_VERSION) throw new Error(`Unsupported state file version: ${state.version}`);
  const mode = apply ? 'apply' : 'dry-run';
  if (state.mode !== mode) {
    throw new Error(`State file mode is ${state.mode}, but this run is ${mode}; use a separate --state-file`);
  }
  if (!state.networks || typeof state.networks !== 'object') throw new Error('State file has no networks object');
  return state;
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  // Rename after the complete write so Ctrl+C cannot leave a half-written JSON checkpoint.
  fs.renameSync(tempFile, file);
}

function checkpointFor(cfg, elastic, cursor, progress, done) {
  return {
    index: elastic.indexName,
    esLastSeenField: cfg.esLastSeenField,
    cursor,
    done,
    progress,
    updatedAt: new Date().toISOString(),
    ...(done ? { completedAt: new Date().toISOString() } : {}),
  };
}

function progressLine(network, page, hits, progress, startedAt, lastSeen, log) {
  const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
  const rate = Math.round(progress.esDocumentsScanned / elapsedSeconds);
  log(`[${network}] page ${page}: fetched ${hits.length}; scanned ${progress.esDocumentsScanned}; drift ${progress.countryDriftedDocuments}; updated ${progress.esDocumentsUpdated}; rate ${rate} doc/s; last_seen ${lastSeen}`);
}

async function backfillCountryNetwork({
  sql,
  elastic,
  network,
  apply = false,
  esBatchSize = ES_DOC_BATCH_SIZE,
  sqlBatchSize = SQL_ROW_BATCH_SIZE,
  checkpoint = {},
  saveCheckpoint = () => {},
  shouldStop = () => false,
  log = () => {},
}) {
  const cfg = NETWORK_CONFIGS[network];
  if (!cfg) throw new Error(`Unsupported network: ${network}`);
  if (checkpoint.index && checkpoint.index !== elastic.indexName) {
    throw new Error(`[${network}] state belongs to ES index "${checkpoint.index}", current index is "${elastic.indexName}"`);
  }
  if (checkpoint.done) return { ...(checkpoint.progress || emptyProgress()), done: true, resumed: true };

  const progress = { ...emptyProgress(), ...(checkpoint.progress || {}) };
  progress.samples = Array.isArray(progress.samples) ? progress.samples : [];
  let cursor = checkpoint.cursor || null;
  let page = Number(progress.pages || 0);
  const startedAt = Date.now();

  for (;;) {
    if (shouldStop()) return { ...progress, done: false, stopped: true };

    const hits = await fetchEsPage(elastic, cfg, esBatchSize, cursor);
    if (!hits.length) {
      saveCheckpoint(network, checkpointFor(cfg, elastic, cursor, progress, true));
      return { ...progress, done: true, stopped: false };
    }

    page += 1;
    progress.pages = page;
    progress.esDocumentsScanned += hits.length;

    const ids = uniqueIds(hits.map((hit) => readSourceField(hit._source || {}, cfg.esIdField)));
    progress.invalidEsIds += hits.filter((hit) => {
      const id = readSourceField(hit._source || {}, cfg.esIdField);
      return id === null || id === undefined || id === '';
    }).length;

    const sqlById = new Map();
    for (const idBatch of chunk(ids, sqlBatchSize)) {
      const rows = await loadSqlRows(sql, cfg, idBatch);
      for (const [id, row] of rows) sqlById.set(id, row);
    }

    progress.sqlRowsMatched += ids.filter((id) => sqlById.has(id)).length;
    progress.sqlRowsMissing += ids.filter((id) => !sqlById.has(id)).length;
    progress.sqlRowsWithoutCountry += ids.filter((id) => sqlById.has(id) && !sqlCountries(sqlById.get(id)).length).length;

    const updates = [];
    for (const hit of hits) {
      const source = hit._source || {};
      const rawAdId = readSourceField(source, cfg.esIdField);
      if (rawAdId === null || rawAdId === undefined || rawAdId === '') continue;

      const adId = String(rawAdId);
      const sqlRow = sqlById.get(adId);
      if (!sqlRow) continue;

      const wanted = sqlCountries(sqlRow);
      if (!wanted.length) continue;

      const current = normalizeCountries(readSourceField(source, cfg.esCountryField));
      if (countriesEqual(current, wanted)) {
        progress.countryInSync += 1;
        continue;
      }

      progress.countryDriftedDocuments += 1;
      if (progress.samples.length < 10) {
        progress.samples.push({
          ad_id: adId,
          es_document_id: hit._id,
          sql_country: wanted,
          es_country: current,
          sql_last_seen: sqlRow.last_seen ?? null,
          es_last_seen: readSourceField(source, cfg.esLastSeenField) ?? null,
        });
      }
      if (apply) updates.push({ esDocumentId: hit._id, countries: wanted });
    }

    if (apply && updates.length) {
      progress.esDocumentsUpdated += await applyUpdates(elastic, bulkUpdateOperations(elastic, cfg, updates));
    }

    cursor = nextCursor(hits);
    progress.lastSeen = readSourceField(hits[hits.length - 1]._source || {}, cfg.esLastSeenField) ?? null;
    const isLastPage = hits.length < esBatchSize;
    saveCheckpoint(network, checkpointFor(cfg, elastic, cursor, progress, isLastPage));
    progressLine(network, page, hits, progress, startedAt, progress.lastSeen, log);

    if (shouldStop()) return { ...progress, done: false, stopped: true };
    if (isLastPage) return { ...progress, done: true, stopped: false };
  }
}

async function schemaHost(sql) {
  try {
    const rows = await sql.query('SELECT @@hostname AS host, DATABASE() AS db');
    return rows?.[0] ? `${rows[0].host}/${rows[0].db}` : '(unknown)';
  } catch {
    return '(unknown)';
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return null;
  }

  const state = loadState(args.stateFile, args.apply);
  let stopRequested = false;
  const onSigint = () => {
    if (!stopRequested) {
      stopRequested = true;
      console.log('\nStop requested; the current page will finish and its checkpoint will be saved.');
    }
  };
  process.once('SIGINT', onSigint);

  console.log(`\n=== backfill-facebook-instagram-country-es-resumable — ${args.apply ? 'APPLY' : 'DRY RUN (no changes)'} ===`);
  console.log(`networks: ${args.networks.join(', ')}`);
  console.log(`ES page: ${args.esBatchSize} document(s) | SQL lookup: ${args.sqlBatchSize} ad ID(s) | state: ${args.stateFile}\n`);

  const selectedConfig = Object.fromEntries(args.networks.map((network) => [network, networksConfig[network]]));
  const summary = [];
  try {
    await databaseManager.connectAll(selectedConfig);

    for (const network of args.networks) {
      const sql = databaseManager.getSQL(network);
      const elastic = databaseManager.getElastic(network);
      if (!sql || !elastic) {
        console.log(`[${network}] SKIP — missing ${!sql ? 'SQL' : 'Elasticsearch'} connection`);
        summary.push({ network, skipped: !sql ? 'no-sql' : 'no-elastic' });
        continue;
      }

      const checkpoint = state.networks[network] || {};
      if (checkpoint.done) {
        console.log(`[${network}] already complete in checkpoint; use a new --state-file to restart`);
        summary.push({ network, ...checkpoint.progress, done: true, resumed: true });
        continue;
      }

      console.log(`[${network}] SQL ${await schemaHost(sql)} → index "${elastic.indexName}"`);
      const result = await backfillCountryNetwork({
        sql,
        elastic,
        network,
        apply: args.apply,
        esBatchSize: args.esBatchSize,
        sqlBatchSize: args.sqlBatchSize,
        checkpoint,
        shouldStop: () => stopRequested,
        saveCheckpoint: (net, value) => {
          state.networks[net] = value;
          saveState(args.stateFile, state);
        },
        log: (message) => console.log(`   ${message}`),
      });
      console.log(`[${network}] scanned ${result.esDocumentsScanned} ES doc(s); ${result.countryDriftedDocuments} drift(s); ${result.sqlRowsMissing} SQL row(s) missing`);
      if (args.apply) console.log(`[${network}] ✓ updated ${result.esDocumentsUpdated} ES doc(s)`);
      if (result.stopped) console.log(`[${network}] paused; rerun the same command to resume`);
      if (result.samples?.length) console.log(`[${network}] sample: ${JSON.stringify(result.samples.slice(0, 5), null, 2)}`);
      summary.push({ network, ...result });

      if (result.stopped) break;
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    await databaseManager.disconnectAll();
  }

  console.log('\n=== summary ===');
  for (const result of summary) console.log('  ', JSON.stringify(result));
  return summary;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FATAL: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ALL_NETWORKS,
  APPLY_STATE_FILE,
  DRY_RUN_STATE_FILE,
  ES_DOC_BATCH_SIZE,
  NETWORK_CONFIGS,
  SQL_ROW_BATCH_SIZE,
  applyUpdates,
  backfillCountryNetwork,
  bulkUpdateOperations,
  countriesEqual,
  defaultStateFile,
  esPageQuery,
  loadSqlRows,
  loadState,
  normalizeCountries,
  parseArgs,
  readSourceField,
  responseBody,
  saveState,
  sqlCountryQuery,
  sqlCountries,
  usage,
};

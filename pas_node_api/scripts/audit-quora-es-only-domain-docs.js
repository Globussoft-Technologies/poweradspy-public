#!/usr/bin/env node
'use strict';

/**
 * Count Quora ES documents whose destination URL exists in ES, while SQL has
 * neither a usable domain relation nor a usable destination URL.
 *
 * This is read-only. ES drives the scan with a lightweight scroll query that
 * projects only the ad ID and destination URL; SQL receives bounded IN-list
 * lookups for each ES page. No full SQL ad-table scan or ES document payload
 * download is performed.
 *
 * Usage:
 *   node scripts/audit-quora-es-only-domain-docs.js
 *   node scripts/audit-quora-es-only-domain-docs.js --es-batch-size=250 --sql-batch-size=250
 *   node scripts/audit-quora-es-only-domain-docs.js --max-docs=1000 --sample-size=10
 */

require('dotenv').config();

const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');

const NETWORK = 'quora';
const DEFAULT_INDEX = 'quora_search_mix';

// Keep production defaults conservative. These are intentionally editable and
// can also be overridden for a short verification run with CLI flags.
const ES_BATCH_SIZE = 500;
const SQL_BATCH_SIZE = 500;
const SCROLL_KEEPALIVE = '2m';
const ES_REQUEST_TIMEOUT_MS = 120000;
const MAX_BATCH_SIZE = 5000;
const DEFAULT_SAMPLE_SIZE = 20;

function responseBody(response) {
  return response?.body || response || {};
}

function rows(result) {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : result;
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

function usableValue(value) {
  if (Array.isArray(value)) return value.some(usableValue);
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  return Boolean(text) && !/^(?:null|undefined)$/i.test(text);
}

function uniqueIds(ids) {
  return [...new Set(ids
    .map((id) => String(id ?? '').trim())
    .filter(Boolean))];
}

function chunk(values, size) {
  const output = [];
  for (let i = 0; i < values.length; i += size) output.push(values.slice(i, i + size));
  return output;
}

function parsePositiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    throw new Error(`--${name} must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    esBatchSize: ES_BATCH_SIZE,
    sqlBatchSize: SQL_BATCH_SIZE,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    maxDocs: null,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--es-batch-size=')) options.esBatchSize = parsePositiveInt(arg.slice(16), 'es-batch-size');
    else if (arg.startsWith('--sql-batch-size=')) options.sqlBatchSize = parsePositiveInt(arg.slice(17), 'sql-batch-size');
    else if (arg.startsWith('--sample-size=')) options.sampleSize = parsePositiveInt(arg.slice(14), 'sample-size');
    else if (arg.startsWith('--max-docs=')) options.maxDocs = parsePositiveInt(arg.slice(11), 'max-docs');
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Read-only Quora ES-only domain data audit.',
    '',
    'The reported ES-only count means: ES has a usable destination URL, but SQL has',
    'no usable domain and no usable destination URL for the same ad ID.',
    '',
    'Options:',
    `  --es-batch-size=N   ES documents per scroll page (default: ${ES_BATCH_SIZE})`,
    `  --sql-batch-size=N  SQL IDs per lookup chunk (default: ${SQL_BATCH_SIZE})`,
    `  --sample-size=N     matching ad IDs to print (default: ${DEFAULT_SAMPLE_SIZE})`,
    '  --max-docs=N        stop after scanning N ES documents; useful for a test run',
    '  --help              show this help',
  ].join('\n');
}

function sqlFlagsQuery(ids) {
  const placeholders = ids.map(() => '?').join(',');
  return `
    SELECT a.id AS ad_id,
           MAX(CASE
                 WHEN d.domain IS NOT NULL
                  AND TRIM(d.domain) <> ''
                  AND LOWER(TRIM(d.domain)) NOT IN ('null', 'undefined')
                 THEN 1 ELSE 0
               END) AS has_domain,
           MAX(CASE
                 WHEN m.destination_url IS NOT NULL
                  AND TRIM(m.destination_url) <> ''
                  AND LOWER(TRIM(m.destination_url)) NOT IN ('null', 'undefined')
                 THEN 1 ELSE 0
               END) AS has_destination_url
      FROM quora_ad AS a
      LEFT JOIN quora_ad_domain AS d ON d.id = a.domain_id
      LEFT JOIN quora_ad_meta_data AS m ON m.quora_ad_id = a.id
     WHERE a.id IN (${placeholders})
     GROUP BY a.id`;
}

async function loadSqlFlags(sql, ids, sqlBatchSize) {
  const result = new Map();
  for (const idChunk of chunk(uniqueIds(ids), sqlBatchSize)) {
    // eslint-disable-next-line no-await-in-loop
    const queryResult = await sql.query(sqlFlagsQuery(idChunk), idChunk);
    for (const row of rows(queryResult)) result.set(String(row.ad_id), row);
  }
  return result;
}

function emptySummary(options, indexName) {
  return {
    index: indexName,
    esBatchSize: options.esBatchSize,
    sqlBatchSize: options.sqlBatchSize,
    esDocumentsScanned: 0,
    esDocumentsWithUrl: 0,
    esDocumentsWithoutUsableId: 0,
    sqlAdRowsChecked: 0,
    sqlAdRowsMissing: 0,
    sqlRowsMissingBothValues: 0,
    esOnlyDocuments: 0,
    sampleAdIds: [],
    pages: 0,
  };
}

async function audit({ sql, elastic, options }) {
  const indexName = elastic.indexName || DEFAULT_INDEX;
  const summary = emptySummary(options, indexName);
  const search = esMethod(elastic, 'search');
  const scroll = esMethod(elastic, 'scroll');
  const clearScroll = esMethod(elastic, 'clearScroll');
  const requestOptions = { requestTimeout: ES_REQUEST_TIMEOUT_MS, maxRetries: 0 };
  let scrollId = null;

  try {
    let response = await search({
      index: indexName,
      scroll: SCROLL_KEEPALIVE,
      body: {
        size: options.esBatchSize,
        sort: ['_doc'],
        _source: ['quora_ad.id', 'quora_ad_meta_data.destination_url'],
        query: {
          bool: {
            filter: [{ exists: { field: 'quora_ad_meta_data.destination_url' } }],
          },
        },
      },
    }, requestOptions);

    while (true) {
      const body = responseBody(response);
      scrollId = body._scroll_id || scrollId;
      const hits = body.hits?.hits || [];
      if (!hits.length) break;

      const remaining = options.maxDocs === null
        ? hits
        : hits.slice(0, Math.max(0, options.maxDocs - summary.esDocumentsScanned));
      summary.pages += 1;
      summary.esDocumentsScanned += remaining.length;

      const candidates = remaining.filter((hit) => usableValue(
        readSourceField(hit._source, 'quora_ad_meta_data.destination_url'),
      ));
      summary.esDocumentsWithUrl += candidates.length;

      const ids = uniqueIds(candidates.map((hit) => (
        readSourceField(hit._source, 'quora_ad.id') ?? hit._id
      )));
      summary.esDocumentsWithoutUsableId += candidates.length - ids.length;

      if (ids.length) {
        // One SQL query per bounded ID chunk keeps memory and SQL packet size
        // predictable even when the ES page contains duplicate ad IDs.
        const sqlById = await loadSqlFlags(sql, ids, options.sqlBatchSize);
        summary.sqlAdRowsChecked += ids.length;

        for (const hit of candidates) {
          const id = String(readSourceField(hit._source, 'quora_ad.id') ?? hit._id ?? '').trim();
          if (!id) continue;
          const sqlRow = sqlById.get(id);
          if (!sqlRow) {
            summary.sqlAdRowsMissing += 1;
            summary.esOnlyDocuments += 1;
          } else {
            const hasDomain = Number(sqlRow.has_domain) === 1;
            const hasDestinationUrl = Number(sqlRow.has_destination_url) === 1;
            if (!hasDomain && !hasDestinationUrl) summary.sqlRowsMissingBothValues += 1;
            if (!hasDomain && !hasDestinationUrl) summary.esOnlyDocuments += 1;
          }

          if (summary.sampleAdIds.length < options.sampleSize
              && !summary.sampleAdIds.includes(id)
              && (summary.esOnlyDocuments > summary.sampleAdIds.length)) {
            summary.sampleAdIds.push(id);
          }
        }
      }

      console.log(
        `[progress] pages=${summary.pages} ES scanned=${summary.esDocumentsScanned}`
        + ` ES URL docs=${summary.esDocumentsWithUrl}`
        + ` SQL checked=${summary.sqlAdRowsChecked}`
        + ` ES-only=${summary.esOnlyDocuments}`,
      );

      if (options.maxDocs !== null && summary.esDocumentsScanned >= options.maxDocs) break;
      if (!scrollId) throw new Error('Elasticsearch did not return a scroll ID');

      // eslint-disable-next-line no-await-in-loop
      response = await scroll({ body: { scroll: SCROLL_KEEPALIVE, scroll_id: scrollId } }, requestOptions);
    }
  } finally {
    if (scrollId) {
      await clearScroll({ body: { scroll_id: scrollId } }, requestOptions).catch(() => {});
    }
  }

  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  console.log('\n=== Quora ES-only domain data audit (READ-ONLY) ===');
  await databaseManager.connectAll({ [NETWORK]: networksConfig[NETWORK] });

  try {
    const sql = databaseManager.getSQL(NETWORK);
    const elastic = databaseManager.getElastic(NETWORK);
    if (!sql || !elastic?.client) throw new Error('Quora SQL and Elasticsearch connections are required');

    const summary = await audit({ sql, elastic, options });
    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await databaseManager.disconnectAll();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', error.message);
    databaseManager.disconnectAll().finally(() => process.exit(1));
  });
}

module.exports = {
  audit,
  parseArgs,
  sqlFlagsQuery,
  usableValue,
};

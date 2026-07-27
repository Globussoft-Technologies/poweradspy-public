'use strict';

const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

const LEGACY_INDEX = 'google_ads_data';
const TARGET_INDEX = 'google_ads_data_v2';

function rows(result) {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : result;
}

function responseBody(response) {
  return response?.body || response || {};
}

async function fetchDocuments(client, index, ids) {
  if (!ids.length) return new Map();
  const response = await client.mget({
    index,
    type: 'doc',
    body: { ids: ids.map(String) },
  });
  const documents = responseBody(response).docs || [];
  return new Map(documents
    .filter((document) => document.found)
    .map((document) => [Number(document._id), document._source]));
}

async function main() {
  const apply = process.argv.includes('--apply');
  await databaseManager.connectAll({ google: networks.google });
  const db = databaseManager.getConnections('google');
  if (!db?.sql || !db?.elastic?.client) {
    throw new Error('Google SQL/Elasticsearch connection is unavailable');
  }

  const configuredIndex = db.elastic.indexName || TARGET_INDEX;
  if (configuredIndex !== TARGET_INDEX) {
    throw new Error(`Refusing repair: configured Google index is ${configuredIndex}, expected ${TARGET_INDEX}`);
  }

  const sqlAds = rows(await db.sql.query(
    `SELECT a.id
       FROM google_text_ad a
       JOIN google_text_ad_meta_data m ON m.google_text_ad_id = a.id
      WHERE m.platform = 18
      ORDER BY a.id`,
  ));
  const ids = sqlAds.map((row) => Number(row.id));
  const targetDocuments = await fetchDocuments(db.elastic.client, TARGET_INDEX, ids);
  const missingIds = ids.filter((id) => !targetDocuments.has(id));
  const legacyDocuments = await fetchDocuments(db.elastic.client, LEGACY_INDEX, missingIds);
  const recoverableIds = missingIds.filter((id) => legacyDocuments.has(id));
  const unrecoverableIds = missingIds.filter((id) => !legacyDocuments.has(id));

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    sql_platform_18_ads: ids.length,
    target_index: TARGET_INDEX,
    missing_ids: missingIds,
    recoverable_from_legacy_index: recoverableIds,
    missing_from_both_indexes: unrecoverableIds,
  }, null, 2));

  if (!apply || !recoverableIds.length) return;

  const body = [];
  for (const id of recoverableIds) {
    body.push({ index: { _index: TARGET_INDEX, _type: 'doc', _id: String(id) } });
    body.push({ ...legacyDocuments.get(id), id, platform: 18 });
  }
  const result = responseBody(await db.elastic.client.bulk({ refresh: 'wait_for', body }));
  if (result.errors) {
    const failures = (result.items || [])
      .filter((item) => item.index?.error)
      .map((item) => ({ id: item.index?._id, error: item.index?.error }));
    throw new Error(`Elasticsearch bulk repair failed: ${JSON.stringify(failures)}`);
  }
  console.log(`Restored ${recoverableIds.length} document(s) into ${TARGET_INDEX}.`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = { main, rows, responseBody, fetchDocuments };

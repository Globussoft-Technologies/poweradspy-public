'use strict';

/**
 * Add platform-18 fields to the configured live Google index.
 *
 * Usage:
 *   node scripts/apply-google-transparency-es-mapping.js          # dry run
 *   node scripts/apply-google-transparency-es-mapping.js --apply  # connect + PUT mapping
 */
const fs = require('fs');
const path = require('path');
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

const apply = process.argv.includes('--apply');
const fragmentPath = path.join(__dirname, 'google_transparency_es_fields.mapping.json');
const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));

function mappingProperties(response, indexName) {
  const body = response?.body || response || {};
  const indexMapping = body[indexName]?.mappings || {};
  return indexMapping.doc?.properties || indexMapping.properties || {};
}

function mappingForExisting(properties) {
  const body = JSON.parse(JSON.stringify(fragment));
  return { body, skipped: [] };
}

async function main() {
  const elasticCfg = networks.google?.database?.elastic;
  const indexName = elasticCfg?.index || 'google_ads_data';
  console.log(`Google Transparency ES mapping target: ${elasticCfg?.node}/${indexName}`);
  console.log(`Fields: ${Object.keys(fragment.properties).join(', ')}`);
  console.log(apply ? 'Mode: APPLY' : 'Mode: DRY RUN (pass --apply to execute)');
  if (!apply) return;

  await databaseManager.connectAll({ google: networks.google });
  const elastic = databaseManager.getElastic('google');
  if (!elastic?.client) throw new Error('Google Elasticsearch connection is unavailable');

  const current = await elastic.client.indices.getMapping({ index: indexName });
  const properties = mappingProperties(current, indexName);
  const existingCountryDetails = properties.country_details;
  if (existingCountryDetails && existingCountryDetails.type !== 'nested') {
    throw new Error(
      `country_details already exists as '${existingCountryDetails.type || 'object'}'; ` +
      'Elasticsearch cannot change it to nested in place. Create/reindex a new index with google_ads_data_v2.mapping.json.'
    );
  }

  const prepared = mappingForExisting(properties);
  if (prepared.skipped.length) {
    console.log(`Preserving existing mapping for: ${prepared.skipped.join(', ')}`);
  }
  const params = { index: indexName, body: prepared.body };
  if (elastic.esMajor && elastic.esMajor < 7) params.type = 'doc';
  await elastic.client.indices.putMapping(params);
  console.log(`Mapping applied successfully to ${indexName}.`);
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = { mappingProperties, mappingForExisting, main };

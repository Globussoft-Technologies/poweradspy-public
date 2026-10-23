"use strict";

/**
 * Add destination_url.keyword and repopulate it for existing TikTok documents.
 * Usage: node scripts/apply-tiktok-domain-search-mapping.js [--apply]
 */
const networks = require("../src/config/networks");
const databaseManager = require("../src/database/DatabaseManager");

const mapping = {
  properties: {
    destination_url: {
      type: "text",
      analyzer: "custom_analyzer",
      fields: {
        keyword: {
          type: "keyword",
          normalizer: "lowercase_normalizer",
          ignore_above: 4096,
        },
      },
    },
  },
};

const bodyOf = (response) => response?.body || response || {};

async function main() {
  const apply = process.argv.includes("--apply");
  const elasticCfg = networks.tiktok?.database?.elastic_tiktok;
  const indexName = elasticCfg?.index || "tiktok_ads";
  console.log(`TikTok domain-search mapping target: ${indexName}`);
  console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN (pass --apply to execute)");
  if (!apply) return;

  await databaseManager.connectAll({ tiktok: networks.tiktok });
  const elastic = databaseManager.getElastic("tiktok");
  if (!elastic?.client) throw new Error("TikTok Elasticsearch connection is unavailable");

  const params = { index: indexName, body: mapping };
  if (elastic.esMajor && elastic.esMajor < 7) params.type = "doc";
  await elastic.client.indices.putMapping(params);

  // New multi-fields are populated only when a document is indexed again.
  const result = bodyOf(await elastic.client.updateByQuery({
    index: indexName,
    conflicts: "proceed",
    refresh: true,
    body: {
      query: { exists: { field: "destination_url" } },
      script: {
        lang: "painless",
        source: "ctx._source.destination_url = ctx._source.destination_url",
      },
    },
  }));
  console.log(`Updated ${result.updated || 0} documents; ${result.failures?.length || 0} failures.`);
  if (result.failures?.length) throw new Error("TikTok domain-search backfill failed");
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = { mapping, bodyOf, main };

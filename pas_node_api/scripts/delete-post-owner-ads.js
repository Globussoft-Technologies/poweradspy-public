'use strict';

/**
 * Production-safe, exact-post-owner ad cleanup across every searchable network.
 *
 * Safety model:
 *   - dry-run unless --apply is supplied;
 *   - exact normalized owner matching (never substring/wildcard deletion);
 *   - --apply requires production config, an exact confirmation phrase, and
 *     expected ES counts for every selected network;
 *   - all networks are preflighted before the first write;
 *   - the 10 Node insertion networks must already block the owner in config;
 *   - existing per-network transactional cascade-delete pipelines are reused;
 *   - Elasticsearch is refreshed and verified after deletion;
 *   - rerunning is safe and produces a JSON report.
 *
 * TikTok is different: this repository is read-only for TikTok ads and the
 * authoritative records live in Elasticsearch. The script deletes exact owner
 * hits there and removes matching analytics/hide/favourite SQL rows.
 */

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const networksConfig = require('../src/config/networks');
const dbManager = require('../src/database/DatabaseManager');
const { normalizePostOwnerName } = require('../src/insertion/helpers/postOwnerRejection');

const DEFAULT_NETWORKS = [
  'facebook', 'instagram', 'gdn', 'youtube', 'google', 'native',
  'linkedin', 'reddit', 'quora', 'pinterest', 'tiktok',
];

const NETWORKS = {
  facebook: {
    mainTable: 'facebook_ad',
    ownerTable: 'facebook_ad_post_owners',
    ownerSourceFields: ['facebook_ad_post_owners.post_owner_name'],
    ownerQueryFields: [
      'facebook_ad_post_owners.post_owner_name_exactly',
      'facebook_ad_post_owners.post_owner_name',
    ],
    internalIdFields: ['facebook_ad.id'],
    processDelete: require('../src/services/facebook/insertion/deletePipeline').processDelete,
    repository: require('../src/services/facebook/insertion/repository'),
    extraChildDeletes: [['facebook_ad_html_lander_content', 'facebook_ad_id']],
  },
  instagram: {
    mainTable: 'instagram_ad',
    ownerTable: 'instagram_ad_post_owners',
    ownerSourceFields: ['instagram_ad_post_owners.post_owner_name'],
    ownerQueryFields: [
      'instagram_ad_post_owners.post_owner_name_exactly',
      'instagram_ad_post_owners.post_owner_name',
    ],
    internalIdFields: ['instagram_ad.id'],
    searchBuilder: require('../src/services/instagram/builders/SearchMixQueryBuilder'),
    processDelete: require('../src/services/instagram/insertion/deletePipeline').processDelete,
    repository: require('../src/services/instagram/insertion/repository'),
    esDrivenOneByOne: true,
  },
  gdn: {
    mainTable: 'gdn_ad',
    ownerTable: 'gdn_ad_post_owners',
    ownerSourceFields: ['gdn_ad_post_owners.post_owner_name'],
    ownerQueryFields: [
      'gdn_ad_post_owners.post_owner_name_exactly',
      'gdn_ad_post_owners.post_owner_name',
    ],
    internalIdFields: ['gdn_ad.id'],
    processDelete: require('../src/services/gdn/insertion/deletePipeline').processDelete,
  },
  youtube: {
    mainTable: 'youtube_ad',
    ownerTable: 'youtube_ad_post_owners',
    ownerSourceFields: ['post_owner', 'post_owner_name'],
    ownerQueryFields: ['post_owner', 'post_owner_name'],
    internalIdFields: ['id'],
    processDelete: require('../src/services/youtube/insertion/deletePipeline').processDelete,
  },
  google: {
    mainTable: 'google_text_ad',
    ownerTable: 'google_text_ad_post_owners',
    ownerSourceFields: ['post_owner_name', 'post_owner'],
    ownerQueryFields: ['post_owner_name', 'post_owner'],
    internalIdFields: ['id'],
    processDelete: require('../src/services/google/insertion/deletePipeline').processDelete,
  },
  native: {
    mainTable: 'native_ad',
    ownerTable: 'native_ad_post_owners',
    ownerSourceFields: ['native_ad_post_owners.post_owner_name'],
    ownerQueryFields: [
      'native_ad_post_owners.post_owner_name_exactly',
      'native_ad_post_owners.post_owner_name',
    ],
    internalIdFields: ['native_ad.id'],
    processDelete: require('../src/services/native/insertion/deletePipeline').processDelete,
  },
  linkedin: {
    mainTable: 'linkedin_ad',
    ownerTable: 'linkedin_ad_post_owners',
    ownerSourceFields: ['post_owner', 'post_owner_name'],
    ownerQueryFields: ['post_owner', 'post_owner_name'],
    internalIdFields: ['id'],
    processDelete: require('../src/services/linkedin/insertion/deletePipeline').processDelete,
  },
  reddit: {
    mainTable: 'reddit_ad',
    ownerTable: 'reddit_ad_post_owners',
    ownerSourceFields: ['reddit_ad_post_owners.post_owner_name', 'post_owner'],
    ownerQueryFields: [
      'reddit_ad_post_owners.post_owner_name_exactly',
      'reddit_ad_post_owners.post_owner_name',
      'post_owner',
    ],
    internalIdFields: ['reddit_ad.id'],
    processDelete: require('../src/services/reddit/insertion/deletePipeline').processDelete,
    deleteArg: (id) => ({ body: { id } }),
  },
  quora: {
    mainTable: 'quora_ad',
    ownerTable: 'quora_ad_post_owners',
    ownerSourceFields: ['quora_ad_post_owners.post_owner_name', 'post_owner'],
    ownerQueryFields: ['quora_ad_post_owners.post_owner_name', 'post_owner'],
    internalIdFields: ['quora_ad.id'],
    processDelete: require('../src/services/quora/insertion/deletePipeline').processDelete,
  },
  pinterest: {
    mainTable: 'pinterest_ad',
    ownerTable: 'pinterest_ad_post_owners',
    ownerSourceFields: ['pinterest_ad_post_owners.post_owner_name', 'post_owner'],
    ownerQueryFields: [
      'pinterest_ad_post_owners.post_owner_name_exactly',
      'pinterest_ad_post_owners.post_owner_name',
      'post_owner',
    ],
    internalIdFields: ['pinterest_ad.id'],
    processDelete: require('../src/services/pinterest/insertion/deletePipeline').processDelete,
  },
  tiktok: {
    esOnly: true,
    ownerSourceFields: ['post_owner'],
    ownerQueryFields: ['post_owner'],
    internalIdFields: ['sql_id'],
    esSourceFields: ['post_owner_id'],
  },
};

const log = {
  info: (message, meta) => console.log(message, meta || ''),
  warn: (message, meta) => console.warn(message, meta || ''),
  error: (message, meta) => console.error(message, meta || ''),
};

function usage() {
  return `
Dry-run (default):
  node scripts/delete-post-owner-ads.js --post-owner "TwinklingTree"

Limit the dry-run to selected networks:
  node scripts/delete-post-owner-ads.js --post-owner "TwinklingTree" --networks facebook,instagram,google

Apply after reviewing the dry-run:
  node scripts/delete-post-owner-ads.js --post-owner "TwinklingTree" --apply \\
    --confirm "DELETE_POST_OWNER_ADS:TwinklingTree" \\
    --expected-counts "facebook=221,instagram=2238,gdn=0,youtube=9,google=23,native=0,linkedin=0,reddit=0,quora=0,pinterest=0,tiktok=1"

Required before --apply:
  1. config.server.nodeEnv must be "production".
  2. For the 10 insertion networks, add the owner to
     networks.<network>.insertion.rejectedPostOwnerNames.
  3. --expected-counts must exactly match this script's latest dry-run ES counts.

Options:
  --post-owner <name>       Required exact advertiser/post-owner name.
  --networks <csv|all>      Default: all 11 searchable networks.
  --apply                   Perform deletion; otherwise read-only dry-run.
  --confirm <phrase>        Must equal DELETE_POST_OWNER_ADS:<post-owner>.
  --expected-counts <csv>   Required with --apply; one network=count per selected network.
  --concurrency <1-4>       Per-network SQL cascade concurrency. Default: 1.
  --allow-count-mismatch    Allow SQL and ES counts to differ after explicit review.
  --help                    Show this help.
`.trim();
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseExpectedCounts(value) {
  const result = {};
  if (!value) return result;
  for (const token of String(value).split(',')) {
    const [rawNetwork, rawCount, extra] = token.split('=');
    const network = String(rawNetwork || '').trim().toLowerCase();
    const countText = String(rawCount || '').trim();
    if (!network || extra !== undefined || !/^\d+$/.test(countText)) {
      throw new Error(`Invalid --expected-counts entry "${token}". Use network=number.`);
    }
    if (!NETWORKS[network]) throw new Error(`Unknown network in --expected-counts: ${network}`);
    if (Object.prototype.hasOwnProperty.call(result, network)) {
      throw new Error(`Duplicate expected count for network: ${network}`);
    }
    result[network] = Number(countText);
  }
  return result;
}

function parseArgs(argv) {
  const opts = {
    apply: false,
    networks: [...DEFAULT_NETWORKS],
    expectedCounts: {},
    concurrency: 1,
    allowCountMismatch: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--post-owner') opts.postOwner = takeValue(argv, i++, arg);
    else if (arg === '--networks') {
      const value = takeValue(argv, i++, arg);
      opts.networks = value.toLowerCase() === 'all'
        ? [...DEFAULT_NETWORKS]
        : value.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    } else if (arg === '--apply') opts.apply = true;
    else if (arg === '--confirm') opts.confirm = takeValue(argv, i++, arg);
    else if (arg === '--expected-counts') {
      opts.expectedCounts = parseExpectedCounts(takeValue(argv, i++, arg));
    } else if (arg === '--concurrency') {
      opts.concurrency = Number(takeValue(argv, i++, arg));
    } else if (arg === '--allow-count-mismatch') opts.allowCountMismatch = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  opts.networks = [...new Set(opts.networks)];
  for (const network of opts.networks) {
    if (!NETWORKS[network]) throw new Error(`Unsupported network: ${network}`);
  }
  if (!opts.help && !normalizePostOwnerName(opts.postOwner)) {
    throw new Error('--post-owner must be a non-empty name.');
  }
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1 || opts.concurrency > 4) {
    throw new Error('--concurrency must be an integer from 1 to 4.');
  }
  return opts;
}

function extractHits(response) {
  return response?.hits?.hits || response?.body?.hits?.hits || [];
}

function extractTotal(response) {
  const total = response?.hits?.total ?? response?.body?.hits?.total ?? 0;
  return typeof total === 'object' ? Number(total.value || 0) : Number(total || 0);
}

function sourceValue(source, field) {
  if (!source || typeof source !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(source, field)) return source[field];
  return field.split('.').reduce((value, key) => value?.[key], source);
}

function sourceMatchesOwner(source, fields, normalizedOwner) {
  return fields.some((field) => normalizePostOwnerName(sourceValue(source, field)) === normalizedOwner);
}

function internalIdFromHit(hit, spec) {
  for (const field of spec.internalIdFields || []) {
    const value = sourceValue(hit?._source, field);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return hit?._id;
}

async function discoverSqlAds(sql, spec, esHits) {
  if (spec.esOnly) return [];
  const ids = [...new Set(
    esHits.map((hit) => internalIdFromHit(hit, spec))
      .filter((id) => id !== undefined && id !== null && id !== '')
  )];
  // Instagram is driven directly from ES IDs so its huge SQL tables are never
  // scanned during preflight. A missing SQL row is safe on a resumed cleanup.
  if (spec.esDrivenOneByOne) return ids.map((id) => ({ id }));

  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    const marks = chunk.map(() => '?').join(',');
    const found = await sql.query(
      `SELECT id, ad_id, post_owner_id
         FROM ${spec.mainTable}
        WHERE id IN (${marks})
        ORDER BY id ASC`,
      chunk
    );
    if (Array.isArray(found)) rows.push(...found);
  }
  return rows;
}

async function discoverEsHits(elastic, spec, postOwner, useSearchMatches = false) {
  const normalizedOwner = normalizePostOwnerName(postOwner);
  let query;
  if (useSearchMatches) {
    if (!spec.searchBuilder) throw new Error('Search-API matching is not configured for this network.');
    const builder = new spec.searchBuilder(elastic.indexName);
    builder.setFrom(0).setSize(10000).setPostOwnerName(postOwner);
    query = builder.build().body.query;
  } else {
    query = {
      bool: {
        minimum_should_match: 1,
        should: spec.ownerQueryFields.map((field) => ({
          match_phrase: { [field]: postOwner },
        })),
      },
    };
  }
  const response = await elastic.search({
    index: elastic.indexName,
    body: {
      query,
      size: 10000,
      track_total_hits: true,
      _source: [...new Set([
        ...spec.ownerSourceFields,
        ...(spec.internalIdFields || []),
        ...(spec.esSourceFields || []),
      ])],
    },
  });
  const hits = extractHits(response);
  const candidateTotal = extractTotal(response);
  if (candidateTotal > hits.length) {
    throw new Error(
      `Elasticsearch owner query returned ${candidateTotal} candidates, above the safe 10000-hit inspection limit. No deletion was performed.`
    );
  }
  return useSearchMatches
    ? hits
    : hits.filter(
      (hit) => sourceMatchesOwner(hit._source, spec.ownerSourceFields, normalizedOwner)
    );
}

function usesSearchApiMatching(network) {
  // Instagram's public search uses translated owner fields and prefix matching.
  // Always mirror it so cleanup cannot leave ads visible through that API.
  return network === 'instagram';
}

function ownerIsBlocked(network, postOwner) {
  if (network === 'tiktok') return true;
  const blocked = networksConfig[network]?.insertion?.rejectedPostOwnerNames || [];
  const normalizedOwner = normalizePostOwnerName(postOwner);
  return blocked.some((name) => normalizePostOwnerName(name) === normalizedOwner);
}

function scopedNetworkConfig(networkNames) {
  const scoped = {};
  for (const name of networkNames) {
    const original = networksConfig[name];
    scoped[name] = {
      ...original,
      enabled: true,
      database: {
        sql: original?.database?.sql,
        elastic: original?.database?.elastic,
        elastic_tiktok: original?.database?.elastic_tiktok,
      },
    };
  }
  return scoped;
}

async function preflight(opts) {
  await dbManager.connectAll(scopedNetworkConfig(opts.networks));
  const report = [];

  for (const network of opts.networks) {
    const spec = NETWORKS[network];
    const db = dbManager.getConnections(network);
    if (!db?.sql) throw new Error(`[${network}] SQL connection is required but unavailable.`);
    if (!db?.elastic) throw new Error(`[${network}] Elasticsearch connection is required but unavailable.`);

    const esHits = await discoverEsHits(
      db.elastic,
      spec,
      opts.postOwner,
      usesSearchApiMatching(network)
    );
    const sqlRows = await discoverSqlAds(db.sql, spec, esHits);
    report.push({
      network,
      database: networksConfig[network]?.database?.sql?.database || null,
      esIndex: db.elastic.indexName,
      sqlCount: sqlRows.length,
      esCount: esHits.length,
      sqlRows,
      esHits,
    });
  }
  return report;
}

function validateApply(opts, report) {
  if (config.env !== 'production') {
    throw new Error(`Refusing --apply because config.server.nodeEnv is "${config.env || 'unset'}", not "production".`);
  }
  const expectedPhrase = `DELETE_POST_OWNER_ADS:${opts.postOwner}`;
  if (opts.confirm !== expectedPhrase) {
    throw new Error(`Refusing --apply: --confirm must exactly equal "${expectedPhrase}".`);
  }

  for (const item of report) {
    if (!Object.prototype.hasOwnProperty.call(opts.expectedCounts, item.network)) {
      throw new Error(`Refusing --apply: missing expected count for ${item.network}.`);
    }
    if (opts.expectedCounts[item.network] !== item.esCount) {
      throw new Error(
        `Refusing --apply: ${item.network} expected ${opts.expectedCounts[item.network]} ES ads, dry-run found ${item.esCount}.`
      );
    }
    if (!opts.allowCountMismatch && item.network !== 'tiktok' && item.sqlCount !== item.esCount) {
      throw new Error(
        `Refusing --apply: ${item.network} SQL=${item.sqlCount}, ES=${item.esCount}. Review and rerun with --allow-count-mismatch only if expected.`
      );
    }
    if (!ownerIsBlocked(item.network, opts.postOwner)) {
      throw new Error(
        `Refusing --apply: add "${opts.postOwner}" to networks.${item.network}.insertion.rejectedPostOwnerNames first.`
      );
    }
  }

  const unexpected = Object.keys(opts.expectedCounts).filter((name) => !opts.networks.includes(name));
  if (unexpected.length) {
    throw new Error(`Expected counts include unselected network(s): ${unexpected.join(', ')}`);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  async function lane() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, lane)
  );
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}

async function deleteSqlAd(spec, sql, internalId) {
  if (!spec.repository) return null;
  return spec.repository.withTransaction(sql, async (tx) => {
    for (const [table, column] of spec.extraChildDeletes || []) {
      try {
        await tx.query(`DELETE FROM ${table} WHERE ${column} = ?`, [internalId]);
      } catch (error) {
        if (!(error && (error.errno === 1146 || error.code === 'ER_NO_SUCH_TABLE'))) throw error;
      }
    }
    return spec.repository.deleteAdCascade(tx, internalId);
  });
}

async function bulkDeleteEsHits(elastic, hits, refresh = true) {
  if (!hits.length) return 0;
  let deleted = 0;
  for (let offset = 0; offset < hits.length; offset += 500) {
    const chunk = hits.slice(offset, offset + 500);
    const body = [];
    for (const hit of chunk) {
      const action = { _index: elastic.indexName, _id: hit._id };
      if (elastic.esMajor && elastic.esMajor < 8) action._type = hit._type || 'doc';
      body.push({ delete: action });
    }
    const response = await elastic.bulk({
      refresh: refresh && offset + chunk.length >= hits.length,
      body,
    });
    const payload = response?.body || response;
    const failures = (payload?.items || [])
      .map((item) => item.delete)
      .filter((item) => item && item.status !== 404 && item.status >= 300);
    if (failures.length) {
      throw new Error(`Elasticsearch bulk delete failed for ${failures.length} document(s).`);
    }
    deleted += chunk.length;
  }
  return deleted;
}

async function deleteEsDrivenAdsOneByOne(spec, db, hits, network, concurrency = 1) {
  const sqlDeletes = new Map();
  let completed = 0;

  await mapWithConcurrency(hits, concurrency, async (hit) => {
    const internalId = internalIdFromHit(hit, spec);
    if (internalId === undefined || internalId === null || internalId === '') {
      throw new Error(`[${network}] ES document ${hit._id} has no internal SQL ad ID.`);
    }

    const key = String(internalId);
    if (!sqlDeletes.has(key)) {
      sqlDeletes.set(key, deleteSqlAd(spec, db.sql, internalId));
    }
    // SQL first, then delete the exact ES document which provided that SQL ID.
    // Zero affected SQL rows is valid when resuming an interrupted cleanup.
    await sqlDeletes.get(key);
    await bulkDeleteEsHits(db.elastic, [hit], false);

    completed += 1;
    if (completed % 10 === 0 || completed === hits.length) {
      console.log(`[${network}] ES-driven SQL+ES deletes ${completed}/${hits.length}`);
    }
  });

  if (hits.length) {
    await db.elastic.client.indices.refresh({ index: db.elastic.indexName });
  }
  return { sqlIdsAttempted: sqlDeletes.size, esDocumentsDeleted: completed };
}

async function withSqlTransaction(sql, fn) {
  const connection = await sql.getConnection();
  const tx = { query: async (query, params) => (await connection.execute(query, params))[0] };
  try {
    await connection.beginTransaction();
    const result = await fn(tx);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* preserve original error */ }
    throw error;
  } finally {
    connection.release();
  }
}

async function cleanupTiktokSql(sql, esHits) {
  const sqlIds = [...new Set(esHits.map((hit) => hit._source?.sql_id).filter((id) => id !== undefined && id !== null))];
  const ownerIds = [...new Set(esHits.map((hit) => hit._source?.post_owner_id).filter((id) => id !== undefined && id !== null))];
  if (!sqlIds.length && !ownerIds.length) return;

  await withSqlTransaction(sql, async (tx) => {
    if (sqlIds.length) {
      const marks = sqlIds.map(() => '?').join(',');
      await tx.query(`DELETE FROM tiktok_ad_analytics WHERE ad_id IN (${marks})`, sqlIds);
      await tx.query(`DELETE FROM hide_favourite_ads WHERE ad_id IN (${marks})`, sqlIds.map(String));
    }
    if (ownerIds.length) {
      const marks = ownerIds.map(() => '?').join(',');
      await tx.query(`DELETE FROM hide_favourite_ads WHERE post_owner_id IN (${marks})`, ownerIds);
    }
  });
}

async function deleteNetwork(item, opts) {
  const spec = NETWORKS[item.network];
  const db = dbManager.getConnections(item.network);

  if (item.network === 'tiktok') {
    await cleanupTiktokSql(db.sql, item.esHits);
    await bulkDeleteEsHits(db.elastic, item.esHits);
  } else if (spec.esDrivenOneByOne) {
    await deleteEsDrivenAdsOneByOne(spec, db, item.esHits, item.network, opts.concurrency);
  } else {
    let completed = 0;
    await mapWithConcurrency(item.sqlRows, opts.concurrency, async (row) => {
      if (spec.repository) {
        const deleted = await deleteSqlAd(spec, db.sql, row.id);
        if (!deleted) throw new Error(`[${item.network}] SQL row ${row.id} was not deleted.`);
      } else {
        const arg = spec.deleteArg ? spec.deleteArg(row.id) : { id: row.id };
        const result = await spec.processDelete(arg, { db, log, network: item.network });
        if (!result || result.code < 200 || result.code >= 300) {
          throw new Error(
            `[${item.network}] cascade delete failed for internal id ${row.id}: ${result?.message || 'unknown error'}`
          );
        }
      }
      completed += 1;
      if (completed % 100 === 0 || completed === item.sqlRows.length) {
        console.log(`[${item.network}] SQL cascades ${completed}/${item.sqlRows.length}`);
      }
    });

    // Delete ES-only or duplicate owner hits that had no matching canonical SQL row.
    const remainingHits = await discoverEsHits(
      db.elastic,
      spec,
      opts.postOwner,
      usesSearchApiMatching(item.network)
    );
    await bulkDeleteEsHits(db.elastic, remainingHits);
  }

  const [remainingSql, remainingEs] = await Promise.all([
    discoverEsHits(
      db.elastic,
      spec,
      opts.postOwner,
      usesSearchApiMatching(item.network)
    ).then((hits) => discoverSqlAds(db.sql, spec, hits)),
    discoverEsHits(
      db.elastic,
      spec,
      opts.postOwner,
      usesSearchApiMatching(item.network)
    ),
  ]);
  if (remainingSql.length || remainingEs.length) {
    throw new Error(
      `[${item.network}] verification failed: SQL=${remainingSql.length}, ES=${remainingEs.length} still remain.`
    );
  }
  return {
    network: item.network,
    sqlDeleted: item.sqlRows.length,
    esMatchedBeforeDelete: item.esHits.length,
    verifiedRemainingSql: 0,
    verifiedRemainingEs: 0,
  };
}

function printableReport(report) {
  return report.map((item) => ({
    network: item.network,
    sqlDatabase: item.database,
    esIndex: item.esIndex,
    sqlExactAds: item.sqlCount,
    esExactAds: item.esCount,
  }));
}

function writeReport(postOwner, payload) {
  const dir = path.resolve(process.cwd(), 'data', 'post-owner-deletion-reports');
  fs.mkdirSync(dir, { recursive: true });
  const safeOwner = normalizePostOwnerName(postOwner).replace(/[^a-z0-9_-]+/g, '-').slice(0, 60) || 'owner';
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeOwner}.json`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return fullPath;
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(usage());
    return { code: 0 };
  }

  console.log(`Mode: ${opts.apply ? 'APPLY' : 'DRY-RUN (read-only)'}`);
  console.log(`Exact post owner: ${opts.postOwner}`);
  console.log(`Networks: ${opts.networks.join(', ')}`);

  try {
    const report = await preflight(opts);
    console.table(printableReport(report));

    if (!opts.apply) {
      console.log('No data was deleted. Review these counts, block the owner in config, then use the printed --apply format.');
      return { code: 0, dryRun: true, report: printableReport(report) };
    }

    validateApply(opts, report);
    const results = [];
    for (const item of report) {
      console.log(`[${item.network}] deleting exact owner ads...`);
      results.push(await deleteNetwork(item, opts));
    }

    const reportPath = writeReport(opts.postOwner, {
      completedAt: new Date().toISOString(),
      postOwner: opts.postOwner,
      networks: opts.networks,
      preflight: printableReport(report),
      results,
    });
    console.table(results);
    console.log(`Deletion verified. Report: ${reportPath}`);
    return { code: 0, dryRun: false, results, reportPath };
  } finally {
    await dbManager.disconnectAll();
  }
}

if (require.main === module) {
  main().then(
    (result) => { process.exitCode = result.code; },
    (error) => {
      console.error(`FAILED: ${error.message}`);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  DEFAULT_NETWORKS,
  NETWORKS,
  usage,
  parseExpectedCounts,
  parseArgs,
  sourceValue,
  sourceMatchesOwner,
  discoverSqlAds,
  discoverEsHits,
  internalIdFromHit,
  mapWithConcurrency,
  deleteEsDrivenAdsOneByOne,
  validateApply,
  printableReport,
  main,
};

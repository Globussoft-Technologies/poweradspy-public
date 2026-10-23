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
 *
 * Search-API mode (--keyword, or --post-owner with --match search-api):
 *   - selects exactly the ads the public search API matches. The script calls
 *     each network's real searchAds controller, captures the Elasticsearch
 *     query it builds (no re-implemented matching), then pages through every
 *     match with that same query (scroll — no 10000 cap; --max-ads guards size);
 *   - the dry-run also runs the real controller and prints its total next to
 *     ours, so the count can be checked against the search API.
 *
 * NAS media (default on, --skip-nas to disable):
 *   - every NAS file referenced by a matched ad (image, video, thumbnail,
 *     carousel media, post-owner image) is deleted after its ad is removed;
 *   - a file is deleted only if it lives in the configured NAS bucket and no
 *     remaining (not-deleted) ad in that network still references it;
 *   - every file NOT deleted (still referenced, other bucket, not ours, failed)
 *     is written with its reason to a JSONL log next to the JSON report.
 */

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const networksConfig = require('../src/config/networks');
const dbManager = require('../src/database/DatabaseManager');
const { normalizePostOwnerName } = require('../src/insertion/helpers/postOwnerRejection');
const axios = require('axios');
const https = require('https');

// user_id sent to the search controllers. Must not be a real user so per-user
// hidden-ad filtering never changes the match set.
const SEARCH_API_USER_ID = 999999999;
const SCROLL_PAGE_SIZE = 500;
const DEFAULT_MAX_ADS = 10000;
// Ads per batched cascade transaction (one DELETE ... IN (...) per child table per batch).
const BATCH_DELETE_SIZE = 100;

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

Keyword (search-API matching — exactly what the search API returns):
  node scripts/delete-post-owner-ads.js --keyword "weight loss gummies" --exact-search
  node scripts/delete-post-owner-ads.js --keyword "weight loss gummies" --exact-search --apply \\
    --confirm "DELETE_KEYWORD_ADS:weight loss gummies" --expected-counts "facebook=12,..."

One-shot (find + delete everything + summary), no expected counts:
  node scripts/delete-post-owner-ads.js --keyword "Twinkling Tree" --auto --apply --confirm "DELETE_KEYWORD_ADS:Twinkling Tree"

Post owner, matched the way the search API's advertiser search does:
  node scripts/delete-post-owner-ads.js --post-owner "TwinklingTree" --match search-api --exact-search

Required before --apply:
  1. config.server.nodeEnv must be "production".
  2. With --post-owner: for the 10 insertion networks, add the owner to
     networks.<network>.insertion.rejectedPostOwnerNames.
  3. --expected-counts must exactly match this script's latest dry-run ES counts.

Options:
  --post-owner <name>       Advertiser/post-owner name (this and/or --keyword).
  --keyword <text>          Keyword search text (always search-API matching).
  --match <mode>            exact-owner (default for --post-owner) | search-api.
  --exact-search            Send exact_search=1 to the search API (precise search).
  --max-ads <n>             Refuse a network with more matches. Default: 10000.
  --skip-nas                Do not delete NAS media files.
  --auto                    One run: find matches fresh, delete DB+ES+NAS on every network, verify, print a
                            final summary. No --expected-counts needed (still needs --apply + --confirm).
  --nas-from-plan <file>    Delete only the NAS files a dry-run plan (.._nas-plan.jsonl) marked "delete",
                            for --networks (e.g. ads already deleted earlier). Same safety checks; --apply to delete.
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
    match: null,
    exactSearch: false,
    maxAds: DEFAULT_MAX_ADS,
    skipNas: false,
    nasFromPlan: null,
    auto: false,
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
    else if (arg === '--keyword') opts.keyword = takeValue(argv, i++, arg);
    else if (arg === '--match') opts.match = takeValue(argv, i++, arg).toLowerCase();
    else if (arg === '--exact-search') opts.exactSearch = true;
    else if (arg === '--max-ads') opts.maxAds = Number(takeValue(argv, i++, arg));
    else if (arg === '--skip-nas') opts.skipNas = true;
    else if (arg === '--nas-from-plan') opts.nasFromPlan = takeValue(argv, i++, arg);
    else if (arg === '--auto') opts.auto = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  opts.networks = [...new Set(opts.networks)];
  for (const network of opts.networks) {
    if (!NETWORKS[network]) throw new Error(`Unsupported network: ${network}`);
  }
  if (opts.keyword !== undefined && !String(opts.keyword).trim()) {
    throw new Error('--keyword must be non-empty.');
  }
  if (!opts.help && !opts.nasFromPlan && !opts.keyword && !normalizePostOwnerName(opts.postOwner)) {
    throw new Error('--post-owner must be a non-empty name.');
  }
  // Keyword searches can only be matched the way the search API matches them.
  if (!opts.match) opts.match = opts.keyword ? 'search-api' : 'exact-owner';
  if (!['exact-owner', 'search-api'].includes(opts.match)) {
    throw new Error('--match must be exact-owner or search-api.');
  }
  if (opts.keyword && opts.match !== 'search-api') {
    throw new Error('--keyword always uses --match search-api.');
  }
  if (!Number.isInteger(opts.maxAds) || opts.maxAds < 1) {
    throw new Error('--max-ads must be a positive integer.');
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

async function discoverEsHits(elastic, spec, postOwner, useSearchMatches = false, fullSource = false) {
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
      _source: fullSource ? true : [...new Set([
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

// ── Search-API matching ─────────────────────────────────────────────────────

/** Request params exactly as the frontend sends them to POST /<network>/ads/search. */
function searchApiParams(opts, size = 1) {
  const params = {
    user_id: SEARCH_API_USER_ID,
    exact_search: opts.exactSearch ? 1 : 0,
    from: 0,
    skip: 0,
    take: size,
    size,
  };
  if (opts.keyword) params.keyword = opts.keyword;
  if (opts.postOwner) params.advertiser = opts.postOwner;
  return params;
}

function quietLogger() {
  const noop = () => {};
  return { info: noop, debug: noop, warn: noop, error: (m, meta) => console.error(m, meta || '') };
}

function loadSearchController(network) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(`../src/services/${network}/controllers/adSearchController`).searchAds;
}

function searchApiRequest(opts, size) {
  return {
    body: searchApiParams(opts, size),
    query: {},
    params: {},
    headers: {},
    user: { id: SEARCH_API_USER_ID, user_id: SEARCH_API_USER_ID },
  };
}

/**
 * Runs the network's real searchAds controller against a stand-in ES client
 * that records the query instead of executing it. The recorded query is the
 * exact one the search API runs, so the delete set can never drift from what
 * users see in search.
 */
async function captureSearchApiQuery(network, db, opts, deps = {}) {
  const searchAds = deps.searchAds || loadSearchController(network);
  const captured = [];
  const realEs = db.elastic;
  const recorder = new Proxy(realEs, {
    get(target, prop) {
      if (prop === 'search') {
        return async (request) => {
          captured.push(JSON.parse(JSON.stringify(request || {})));
          return { hits: { total: { value: 0, relation: 'eq' }, hits: [] }, aggregations: {} };
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  // GDN's search API merges YouTube DISPLAY ads (YouTube's own search hides them)
  // through gdn/helpers/youtubeDisplayMerge.js, which queries the YouTube index
  // directly. Record that query too, so those ads are deleted with YouTube's pipeline.
  const ytCaptured = [];
  const ytConns = network === 'gdn' && !deps.searchAds ? dbManager.getConnections('youtube') : null;
  const ytOriginalSearch = ytConns?.elastic?.search;
  if (ytOriginalSearch) {
    ytConns.elastic.search = async (request) => {
      ytCaptured.push(JSON.parse(JSON.stringify(request || {})));
      return { hits: { total: { value: 0, relation: 'eq' }, hits: [] } };
    };
  }
  try {
    await searchAds(searchApiRequest(opts, 20), { ...db, elastic: recorder }, quietLogger());
  } finally {
    if (ytOriginalSearch) ytConns.elastic.search = ytOriginalSearch;
  }
  const main = captured.find((c) => c && c.body && c.body.query && (!c.index || c.index === realEs.indexName))
    || captured.find((c) => c && c.body && c.body.query);
  if (!main) throw new Error(`[${network}] the search API built no Elasticsearch query for these params.`);
  const result = { index: main.index || realEs.indexName, query: main.body.query };
  const yt = ytCaptured.find((c) => c && c.body && c.body.query);
  if (yt) result.youtubeDisplay = { index: yt.index || ytConns.elastic.indexName, query: yt.body.query };
  return result;
}

/** The total the real search API reports (read-only), shown next to ours in the dry-run. */
async function searchApiReportedTotal(network, db, opts, deps = {}) {
  const searchAds = deps.searchAds || loadSearchController(network);
  try {
    const res = await searchAds(searchApiRequest(opts, 1), db, quietLogger());
    const total = res?.total ?? res?.meta?.total ?? res?.data?.total;
    return Number.isFinite(Number(total)) ? Number(total) : null;
  } catch {
    return null;
  }
}

const unwrapEs = (res) => (res && res.body !== undefined && (res.body.hits || res.body._scroll_id) ? res.body : res);

// Only these fields are kept in memory per matched ad (ids for SQL/ES deletes,
// owner name for the dry-run breakdown). Full documents can be very large
// (lander HTML text etc.) — holding thousands of them ran Node out of heap.
function slimSourceFields(spec) {
  return [...new Set([
    ...(spec?.internalIdFields || []),
    ...(spec?.ownerSourceFields || []),
    ...(spec?.esSourceFields || []),
    'sql_id', 'post_owner_id', 'post_owner_name', 'post_owner', 'advertiser',
  ])];
}

function slimHit(hit, fields) {
  const src = {};
  for (const field of fields) {
    const value = sourceValue(hit?._source, field);
    if (value !== undefined) src[field] = value;
  }
  return { _id: hit._id, _type: hit._type, _index: hit._index, _source: src };
}

/**
 * Every hit for `query` (scroll). Throws above maxAds — nothing is deleted then.
 * `sourceFields` limits what ES returns; `mapHit` runs per hit as each page
 * arrives, so a full page can be reduced before the next one is fetched.
 */
async function scrollAllHits(elastic, index, query, maxAds, { sourceFields = true, pageSize = SCROLL_PAGE_SIZE, mapHit = null } = {}) {
  const client = elastic.client;
  const first = unwrapEs(await client.search({
    index,
    scroll: '2m',
    size: pageSize,
    track_total_hits: true,
    body: { query, sort: ['_doc'], _source: sourceFields },
  }));
  const total = extractTotal(first);
  if (total > maxAds) {
    if (first._scroll_id) await client.clearScroll({ scroll_id: first._scroll_id }).catch(() => {});
    throw new Error(`${total} matching ads is above --max-ads ${maxAds}. Review, then re-run with a larger --max-ads. Nothing was deleted.`);
  }
  const take = (batch) => (mapHit ? batch.map(mapHit) : batch);
  const hits = take(extractHits(first));
  let scrollId = first._scroll_id;
  let seen = hits.length;
  while (scrollId && seen < total) {
    const page = unwrapEs(await client.scroll({ scroll_id: scrollId, scroll: '2m' }));
    const batch = extractHits(page);
    if (!batch.length) break;
    seen += batch.length;
    hits.push(...take(batch));
    scrollId = page._scroll_id;
  }
  if (scrollId) await client.clearScroll({ scroll_id: scrollId }).catch(() => {});
  return hits;
}

/**
 * Ads to delete for this network, by the selected match mode. Returns slim hits.
 * With `nasRefs` (preflight only) full documents are read a page at a time and
 * their NAS paths are added to that map before the document is discarded.
 */
async function discoverHits(db, spec, network, opts, captured = null, { nasRefs = null } = {}) {
  const fields = slimSourceFields(spec);
  const mediaBase = nasSettings().mediaUrl;
  const bucket = nasBucket();
  const mapHit = (hit) => {
    if (nasRefs) {
      for (const [p, skip] of nasRefsFromSource(hit._source, mediaBase, bucket)) {
        if (!nasRefs.has(p)) nasRefs.set(p, skip);
      }
    }
    return slimHit(hit, fields);
  };
  const scrollOpts = nasRefs
    ? { sourceFields: true, pageSize: 100, mapHit }
    : { sourceFields: fields, pageSize: 1000, mapHit };

  if (opts.match === 'search-api') {
    const q = captured || await captureSearchApiQuery(network, db, opts);
    const hits = await scrollAllHits(db.elastic, q.index, q.query, opts.maxAds, scrollOpts);
    for (const extra of q.extraQueries || []) {
      const seenIds = new Set(hits.map((h) => h._id));
      for (const h of await scrollAllHits(db.elastic, extra.index, extra.query, opts.maxAds, scrollOpts)) {
        if (!seenIds.has(h._id)) { hits.push(h); seenIds.add(h._id); }
      }
    }
    return hits;
  }
  const hits = await discoverEsHits(db.elastic, spec, opts.postOwner, usesSearchApiMatching(network), !!nasRefs);
  return hits.map(mapHit);
}

// ── Self-contained NAS delete ───────────────────────────────────────────────
// Production's src/ can be older than this script, so the NAS delete contract is
// embedded here instead of depending on that server's nasClient.js version.
// Same contract as nasClient.deleteFromNas (commit 9b3f018fd):
//   HTTP  DELETE {originUrl}/{bucket}/{key}   Authorization: Bearer {mediaToken}
//         2xx or 404 = success (404 = already gone)
//   SFTP  fallback: delete {key} relative to the SFTP root (ssh2-sftp-client), if configured
// Settings: loaded config → config.json → NAS_* env vars (older config/index.js may not expose all keys).

function readConfigJsonNas() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.json'), 'utf8'))?.insertion?.nas || {};
  } catch {
    return {};
  }
}

let nasSettingsCache = null;
function nasSettings() {
  if (nasSettingsCache) return nasSettingsCache;
  const loaded = config.insertion?.nas || {};
  const file = readConfigJsonNas();
  const pick = (key, env) => {
    const v = loaded[key] ?? file[key] ?? process.env[env];
    return v === undefined || v === null ? '' : v;
  };
  nasSettingsCache = {
    mediaUrl: pick('mediaUrl', 'NAS_MEDIA_URL'),
    mediaToken: pick('mediaToken', 'NAS_MEDIA_TOKEN'),
    originUrl: pick('originUrl', 'NAS_ORIGIN_URL'),
    bucket: pick('bucket', 'NAS_BUCKET'),
    verifyTls: loaded.verifyTls === true || file.verifyTls === true,
    sftpHost: pick('sftpHost', 'NAS_SFTP_HOST'),
    sftpPort: Number(pick('sftpPort', 'NAS_SFTP_PORT')) || 7361,
    sftpUser: pick('sftpUser', 'NAS_SFTP_USER'),
    sftpPass: pick('sftpPass', 'NAS_SFTP_PASS'),
  };
  return nasSettingsCache;
}

/** Bucket the same way nasClient resolves it: explicit override, else production → pas-prod, otherwise pas-dev. */
function nasBucket() {
  const n = nasSettings();
  if (n.bucket) return n.bucket;
  return config.env === 'production' ? 'pas-prod' : 'pas-dev';
}

/** Storage key from a stored path: strip "/<bucket>/stream/" (or the legacy "/PowerAdspy…/" prefix). */
function nasKeyFromStoredPath(storedPath) {
  const key = String(storedPath || '')
    .replace(/^\/?[^/]+\/stream\//i, '')
    .replace(/^\/?(PowerAdspy\/n2|PowerAdspy-Dev|PowerAdspy)\//i, '');
  // Unchanged = no recognised NAS prefix → unexpected shape → never delete.
  if (!key || key === String(storedPath) || key === String(storedPath).replace(/^\//, '')) return null;
  return key;
}

function sftpLoader() {
  try {
    // eslint-disable-next-line global-require
    return require('ssh2-sftp-client');
  } catch {
    return null;
  }
}

let sftpConn = null;
async function sftpDelete(key) {
  const n = nasSettings();
  const Client = sftpLoader();
  if (!Client || !n.sftpHost || !n.sftpUser) throw new Error('SFTP not available');
  if (!sftpConn) {
    sftpConn = new Client();
    await sftpConn.connect({ host: n.sftpHost, port: n.sftpPort, username: n.sftpUser, password: n.sftpPass, readyTimeout: 20000 });
  }
  try {
    await sftpConn.delete(key);
  } catch (e) {
    if (!/no such file|not found|enoent/i.test(e?.message || '')) throw e;
  }
  return true;
}

async function closeNas() {
  if (sftpConn) {
    try { await sftpConn.end(); } catch { /* ignore */ }
    sftpConn = null;
  }
}

/** Which NAS delete transports this server can use. */
function nasDeleteTransports() {
  const n = nasSettings();
  const out = [];
  if (n.originUrl && n.mediaToken) out.push('http');
  if (n.sftpHost && n.sftpUser && sftpLoader()) out.push('sftp');
  return out;
}

/** Delete one stored NAS file. Never throws; true = deleted or already gone. */
async function deleteNasFile(storedPath) {
  if (!storedPath || /DefaultImage/i.test(storedPath) || /^https?:\/\//i.test(storedPath)) return false;
  const key = nasKeyFromStoredPath(storedPath);
  if (!key) return false;
  const n = nasSettings();
  if (n.originUrl && n.mediaToken) {
    try {
      const url = `${String(n.originUrl).replace(/\/+$/, '')}/${nasBucket()}/${key}`;
      const res = await axios.delete(url, {
        headers: { Authorization: `Bearer ${n.mediaToken}` },
        timeout: 15000,
        httpsAgent: n.verifyTls ? undefined : new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
        validateStatus: () => true,
      });
      if ((res.status >= 200 && res.status < 300) || res.status === 404) return true;
    } catch { /* fall through to SFTP */ }
  }
  try {
    return await sftpDelete(key);
  } catch {
    return false;
  }
}

// ── NAS media ───────────────────────────────────────────────────────────────

const LEGACY_NAS_PREFIX = /^\/?(PowerAdspy\/n2|PowerAdspy-Dev|PowerAdspy)\//i;
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|m4v)$/i;

/**
 * Classifies one stored value. Returns { path } for a NAS file this script may
 * delete, { path, skip } for a NAS-looking file it must not touch, or null for
 * anything that isn't a NAS reference at all.
 */
function classifyNasValue(value, mediaBase, bucket) {
  if (typeof value !== 'string') return null;
  let v = value.trim();
  if (!v || /DefaultImage/i.test(v)) return null;
  if (/^https?:\/\//i.test(v)) {
    const base = String(mediaBase || '').replace(/\/+$/, '');
    if (!base || !v.startsWith(base)) return null; // external CDN etc. — not ours
    v = v.slice(base.length) || '/';
  }
  if (!v.startsWith('/') && /^[^/\s]+\/stream\//.test(v)) v = `/${v}`;
  v = v.split(/[?#]/)[0];
  if (LEGACY_NAS_PREFIX.test(v)) return { path: v }; // legacy prefix = the configured bucket
  const m = v.match(/^\/([^/\s]+)\/stream\/\S+/);
  if (!m) return v.startsWith('/') && MEDIA_EXT.test(v) ? { path: v, skip: 'not-a-managed-nas-path' } : null;
  if (bucket && m[1] !== bucket) return { path: v, skip: `other-bucket:${m[1]}` };
  return { path: v };
}

/** All NAS references in one ad document (any field, JSON-encoded arrays included). */
function nasRefsFromSource(source, mediaBase, bucket) {
  const refs = new Map();
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value === 'object') { Object.values(value).forEach(visit); return; }
    if (typeof value !== 'string') return;
    const t = value.trim();
    if ((t.startsWith('[') || t.startsWith('{')) && t.length < 200000) {
      try { visit(JSON.parse(t)); return; } catch { /* plain string */ }
    }
    const c = classifyNasValue(t, mediaBase, bucket);
    if (c && !refs.has(c.path)) refs.set(c.path, c.skip || null);
  };
  visit(source);
  return refs;
}

/** NAS references across all matched ads: Map(path → skipReason|null). */
function collectNasRefs(hits, mediaBase = nasSettings().mediaUrl, bucket = nasBucket()) {
  const all = new Map();
  for (const hit of hits) {
    for (const [p, skip] of nasRefsFromSource(hit._source, mediaBase, bucket)) {
      if (!all.has(p)) all.set(p, skip);
    }
  }
  return all;
}

/** Is this NAS path still referenced by any ad left in the index? Errors count as "yes" (keep the file). */
async function nasPathStillReferenced(elastic, storedPath) {
  const tail = storedPath.replace(/^\/?[^/]+\/stream\//i, '').replace(LEGACY_NAS_PREFIX, '');
  const phrase = tail.replace(/[\\"]/g, '\\$&');
  try {
    const res = unwrapEs(await elastic.search({
      index: elastic.indexName,
      body: {
        size: 0,
        track_total_hits: true,
        query: { query_string: { query: `"${phrase}"`, default_field: '*', lenient: true } },
      },
    }));
    return extractTotal(res) > 0;
  } catch {
    return true;
  }
}

/**
 * Deletes this network's collected NAS files after its ads are gone (existing
 * nasClient.deleteFromNas: HTTP DELETE on the NAS origin, SFTP fallback, 404 = gone).
 * Returns counts plus a notDeleted list (path + reason) for the JSONL log.
 */
async function deleteNasForNetwork(network, elastic, refs, concurrency = 4, deps = {}) {
  const del = deps.deleteFromNas || deleteNasFile;
  const stillReferenced = deps.stillReferenced || nasPathStillReferenced;
  const result = { network, candidates: refs.size, deleted: 0, deletedPaths: [], notDeleted: [] };
  let done = 0;
  const progress = () => {
    done += 1;
    if (done % 100 === 0 || done === refs.size) {
      console.log(`[${network}] NAS ${done}/${refs.size} processed (deleted ${result.deleted}, not deleted ${result.notDeleted.length})`);
    }
  };
  await mapWithConcurrency([...refs.entries()], concurrency, async (entry) => {
    try { await processOne(entry); } finally { progress(); }
  });
  return result;

  async function processOne([storedPath, skipReason]) {
    if (skipReason) {
      result.notDeleted.push({ network, path: storedPath, reason: skipReason });
      return;
    }
    if (await stillReferenced(elastic, storedPath)) {
      result.notDeleted.push({ network, path: storedPath, reason: 'still-referenced-by-another-ad' });
      return;
    }
    let ok = false;
    try {
      ok = await del(storedPath, { adId: `cleanup:${network}` });
    } catch {
      ok = false;
    }
    if (ok) {
      result.deleted += 1;
      result.deletedPaths.push(storedPath);
    } else {
      result.notDeleted.push({ network, path: storedPath, reason: 'nas-delete-failed-or-not-configured' });
    }
  }
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
  // GDN search results include YouTube DISPLAY ads, so a search-API GDN delete needs YouTube's connection too.
  const connectNetworks = opts.match === 'search-api' && opts.networks.includes('gdn') && !opts.networks.includes('youtube')
    ? [...opts.networks, 'youtube'] : opts.networks;
  await dbManager.connectAll(scopedNetworkConfig(connectNetworks));
  const report = [];

  // Search-API mode: capture every network's query up front. GDN's capture also
  // yields the YouTube DISPLAY query; it is added to YouTube's delete set.
  const capturedByNetwork = {};
  const captureErrors = {};
  if (opts.match === 'search-api') {
    for (const network of opts.networks) {
      const db = dbManager.getConnections(network);
      if (!db?.elastic) continue;
      try {
        capturedByNetwork[network] = await captureSearchApiQuery(network, db, opts);
      } catch (error) {
        captureErrors[network] = error.message;
      }
    }
    const display = capturedByNetwork.gdn?.youtubeDisplay;
    if (display) {
      if (capturedByNetwork.youtube) {
        capturedByNetwork.youtube.extraQueries = [display];
      } else if (!captureErrors.gdn) {
        captureErrors.gdn = 'GDN search results include YouTube DISPLAY ads — add youtube to --networks so they are deleted too.';
      }
    }
  }

  for (const network of opts.networks) {
    const spec = NETWORKS[network];
    const db = dbManager.getConnections(network);
    if (!db?.sql) throw new Error(`[${network}] SQL connection is required but unavailable.`);
    if (!db?.elastic) throw new Error(`[${network}] Elasticsearch connection is required but unavailable.`);

    let captured = null;
    let apiTotal = null;
    let esHits;
    let sqlRows;
    const nasRefs = new Map();
    try {
      if (opts.match === 'search-api') {
        if (captureErrors[network]) throw new Error(captureErrors[network]);
        captured = capturedByNetwork[network] || await captureSearchApiQuery(network, db, opts);
        apiTotal = await searchApiReportedTotal(network, db, opts);
      }
      esHits = await discoverHits(db, spec, network, opts, captured, { nasRefs: opts.skipNas ? null : nasRefs });
      sqlRows = await discoverSqlAds(db.sql, spec, esHits);
    } catch (error) {
      // One network failing must not hide the others' counts; --apply refuses while any error remains.
      report.push({ network, database: networksConfig[network]?.database?.sql?.database || null, esIndex: db.elastic.indexName, error: error.message, sqlRows: [], esHits: [], sqlCount: 0, esCount: 0 });
      continue;
    }
    report.push({
      network,
      database: networksConfig[network]?.database?.sql?.database || null,
      esIndex: db.elastic.indexName,
      sqlCount: sqlRows.length,
      esCount: esHits.length,
      apiTotal,
      captured,
      sqlRows,
      esHits,
      nasRefs,
    });
  }
  return report;
}

/** Exact text --confirm must equal for this run. */
function confirmPhrase(opts) {
  if (opts.keyword && opts.postOwner) return `DELETE_SEARCH_ADS:${opts.postOwner}+${opts.keyword}`;
  if (opts.keyword) return `DELETE_KEYWORD_ADS:${opts.keyword}`;
  return `DELETE_POST_OWNER_ADS:${opts.postOwner}`;
}

function validateApply(opts, report) {
  if (config.env !== 'production') {
    throw new Error(`Refusing --apply because config.server.nodeEnv is "${config.env || 'unset'}", not "production".`);
  }
  const expectedPhrase = confirmPhrase(opts);
  if (opts.confirm !== expectedPhrase) {
    throw new Error(`Refusing --apply: --confirm must exactly equal "${expectedPhrase}".`);
  }

  if (!opts.skipNas && !nasDeleteTransports().length) {
    throw new Error('Refusing --apply: no NAS delete transport configured (need insertion.nas.originUrl + mediaToken, or SFTP host/user with ssh2-sftp-client). Fix config, or re-run with --skip-nas and clean NAS later with --nas-from-plan.');
  }
  const failed = report.filter((item) => item.error);
  if (failed.length) {
    throw new Error(`Refusing --apply: preflight failed for ${failed.map((f) => `${f.network} (${f.error})`).join('; ')}. Fix it or leave that network out with --networks.`);
  }
  for (const item of report) {
    if (opts.auto) {
      if (opts.postOwner && !ownerIsBlocked(item.network, opts.postOwner)) {
        throw new Error(
          `Refusing --apply: add "${opts.postOwner}" to networks.${item.network}.insertion.rejectedPostOwnerNames first.`
        );
      }
      continue; // --auto: counts come from this run's fresh preflight; SQL/ES differences are deleted too and reported
    }
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
    if (opts.postOwner && !ownerIsBlocked(item.network, opts.postOwner)) {
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

// ── Batched cascade delete ──────────────────────────────────────────────────
// The per-ad cascade runs ~19 single-row DELETEs (one per child table) for
// every ad — very slow on large production tables. Here the network's OWN
// repository cascade is recorded once (no DB), and each statement is replayed
// as "DELETE ... WHERE col IN (<100 ids>)" — same tables, same order, one
// transaction per batch, SQL before ES. If the cascade contains anything but
// plain single-id DELETEs, null is returned and the per-ad path is used.
const SIMPLE_DELETE = /^DELETE FROM (`?[\w.]+`?) WHERE (`?\w+`?) = \?$/i;
const PROBE_ID = -987654321;

async function cascadeDeleteStatements(spec) {
  const repo = spec?.repository;
  if (!repo?.deleteAdCascade || !repo?.withTransaction) return null;
  const recorded = [];
  const recorder = {
    query: async (sql, params) => {
      recorded.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { affectedRows: 1 };
    },
  };
  try {
    await repo.deleteAdCascade(recorder, PROBE_ID);
  } catch {
    return null;
  }
  const statements = (spec.extraChildDeletes || []).map(([table, col]) => ({ table, col }));
  for (const r of recorded) {
    const m = r.sql.match(SIMPLE_DELETE);
    if (!m || !Array.isArray(r.params) || r.params.length !== 1 || r.params[0] !== PROBE_ID) return null;
    statements.push({ table: m[1], col: m[2] });
  }
  return statements.length ? statements : null;
}

async function runBatchedCascade(spec, sql, statements, ids) {
  const marks = ids.map(() => '?').join(',');
  return spec.repository.withTransaction(sql, async (tx) => {
    for (const { table, col } of statements) {
      try {
        await tx.query(`DELETE FROM ${table} WHERE ${col} IN (${marks})`, ids);
      } catch (error) {
        if (!(error && (error.errno === 1146 || error.code === 'ER_NO_SUCH_TABLE'))) throw error;
      }
    }
  });
}

/**
 * Batched delete: per batch of ids, one cascade transaction, then one ES bulk
 * delete for exactly the documents that provided those ids. Rerun-safe (a
 * missing SQL row affects 0 rows; ES docs left by a crash are re-driven).
 */
async function deleteAdsBatched(spec, db, network, statements, ids, hitsById, { concurrency = 1, batchSize = BATCH_DELETE_SIZE } = {}) {
  const batches = [];
  for (let i = 0; i < ids.length; i += batchSize) batches.push(ids.slice(i, i + batchSize));
  let done = 0;
  await mapWithConcurrency(batches, concurrency, async (batch) => {
    await runBatchedCascade(spec, db.sql, statements, batch);
    const hits = hitsById ? batch.flatMap((id) => hitsById.get(String(id)) || []) : [];
    if (hits.length) await bulkDeleteEsHits(db.elastic, hits, false);
    done += batch.length;
    console.log(`[${network}] batched SQL${hitsById ? '+ES' : ''} deletes ${done}/${ids.length}`);
  });
  if (hitsById && ids.length) await db.elastic.client.indices.refresh({ index: db.elastic.indexName });
  return { sqlIdsDeleted: ids.length, batches: batches.length };
}

async function deleteNetwork(item, opts) {
  const spec = NETWORKS[item.network];
  const db = dbManager.getConnections(item.network);

  if (item.network === 'tiktok') {
    await cleanupTiktokSql(db.sql, item.esHits);
    await bulkDeleteEsHits(db.elastic, item.esHits);
  } else if (spec.esDrivenOneByOne) {
    const statements = await cascadeDeleteStatements(spec);
    if (statements) {
      const hitsById = new Map();
      for (const hit of item.esHits) {
        const id = internalIdFromHit(hit, spec);
        if (id === undefined || id === null || id === '') throw new Error(`[${item.network}] ES document ${hit._id} has no internal SQL ad ID.`);
        const key = String(id);
        if (!hitsById.has(key)) hitsById.set(key, []);
        hitsById.get(key).push(hit);
      }
      await deleteAdsBatched(spec, db, item.network, statements, [...hitsById.keys()], hitsById, { concurrency: opts.concurrency });
    } else {
      await deleteEsDrivenAdsOneByOne(spec, db, item.esHits, item.network, opts.concurrency);
    }
  } else if (spec.repository && await cascadeDeleteStatements(spec)) {
    // SQL rows in batches; remaining ES docs (incl. ES-only) are removed right after.
    const statements = await cascadeDeleteStatements(spec);
    await deleteAdsBatched(spec, db, item.network, statements, item.sqlRows.map((r) => r.id), null, { concurrency: opts.concurrency });
    const remainingHits = await discoverHits(db, spec, item.network, opts, item.captured);
    await bulkDeleteEsHits(db.elastic, remainingHits);
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

    // Delete ES-only or duplicate hits that had no matching canonical SQL row.
    const remainingHits = await discoverHits(db, spec, item.network, opts, item.captured);
    await bulkDeleteEsHits(db.elastic, remainingHits);
  }

  // Verification reads ids only, one query at a time.
  const remainingEs = await discoverHits(db, spec, item.network, opts, item.captured);
  const remainingSql = await discoverSqlAds(db.sql, spec, remainingEs);
  if (remainingSql.length || remainingEs.length) {
    throw new Error(
      `[${item.network}] verification failed: SQL=${remainingSql.length}, ES=${remainingEs.length} still remain.`
    );
  }
  // NAS last: only after this network's ads are verifiably gone.
  const nas = opts.skipNas || !item.nasRefs?.size
    ? { network: item.network, candidates: 0, deleted: 0, deletedPaths: [], notDeleted: [] }
    : await deleteNasForNetwork(item.network, db.elastic, item.nasRefs);
  if (nas.candidates) {
    console.log(`[${item.network}] NAS files deleted ${nas.deleted}/${nas.candidates} (not deleted: ${nas.notDeleted.length}, see log)`);
  }
  return {
    network: item.network,
    sqlDeleted: item.sqlRows.length,
    esMatchedBeforeDelete: item.esHits.length,
    verifiedRemainingSql: 0,
    verifiedRemainingEs: 0,
    nasDeleted: nas.deleted,
    nasNotDeleted: nas.notDeleted.length,
    nas,
  };
}

function printableReport(report) {
  return report.map((item) => {
    const row = {
      network: item.network,
      sqlDatabase: item.database,
      esIndex: item.esIndex,
      sqlExactAds: item.sqlCount,
      esExactAds: item.esCount,
    };
    if (item.apiTotal !== undefined) row.searchApiTotal = item.apiTotal ?? 'n/a';
    if (item.network === 'gdn' && item.captured?.youtubeDisplay) row.note = 'searchApiTotal includes YouTube DISPLAY ads (deleted under youtube)';
    if (item.network === 'youtube' && item.captured?.extraQueries?.length) row.note = 'esExactAds includes YouTube DISPLAY ads shown under GDN';
    if (item.error) row.error = item.error.slice(0, 80);
    if (item.nasRefs) {
      const refs = [...item.nasRefs.values()];
      row.nasToDelete = refs.filter((r) => !r).length;
      row.nasSkipped = refs.filter(Boolean).length;
    }
    return row;
  });
}

/** Post-owner name of one matched ad (network-specific field, then common fallbacks). */
function ownerNameOfHit(hit, spec) {
  const src = hit?._source || {};
  for (const field of [...(spec?.ownerSourceFields || []), 'post_owner_name', 'post_owner', 'advertiser']) {
    const v = sourceValue(src, field);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '(unknown)';
}

/** Dry-run: who owns the matched ads — top owners per network, so a broad match is easy to spot. */
function ownerBreakdown(report, top = 8) {
  const rows = [];
  for (const item of report) {
    if (!item.esHits?.length) continue;
    const counts = new Map();
    for (const hit of item.esHits) {
      const name = ownerNameOfHit(hit, NETWORKS[item.network]);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    sorted.slice(0, top).forEach(([owner, ads]) => rows.push({ network: item.network, postOwner: owner, ads }));
    if (sorted.length > top) {
      const rest = sorted.slice(top).reduce((n, [, c]) => n + c, 0);
      rows.push({ network: item.network, postOwner: `(+${sorted.length - top} other owners)`, ads: rest });
    }
  }
  return rows;
}

function reportSlug(opts) {
  const label = [opts.postOwner, opts.keyword].filter(Boolean).join('_');
  return normalizePostOwnerName(label).replace(/[^a-z0-9_-]+/g, '-').slice(0, 60) || 'search';
}

function reportsDir() {
  const dir = path.resolve(process.cwd(), 'data', 'post-owner-deletion-reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Dry-run: every NAS file that WOULD be deleted / kept (with reason), one JSON line each. */
function writeNasPlan(opts, report) {
  const lines = [];
  for (const item of report) {
    for (const [p, skip] of item.nasRefs || []) {
      lines.push(JSON.stringify({ network: item.network, path: p, action: skip ? 'keep' : 'delete', reason: skip || undefined }));
    }
  }
  if (!lines.length) return null;
  const file = path.join(reportsDir(), `${new Date().toISOString().replace(/[:.]/g, '-')}_${reportSlug(opts)}_nas-plan.jsonl`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

/** Apply: every NAS file that was NOT deleted, with its reason. */
function writeNasNotDeletedLog(opts, results) {
  const lines = results.flatMap((r) => (r.nas?.notDeleted || []).map((x) => JSON.stringify(x)));
  if (!lines.length) return null;
  const file = path.join(reportsDir(), `${new Date().toISOString().replace(/[:.]/g, '-')}_${reportSlug(opts)}_nas-not-deleted.jsonl`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

function writeReport(postOwner, payload) {
  const dir = reportsDir();
  const safeOwner = normalizePostOwnerName(postOwner).replace(/[^a-z0-9_-]+/g, '-').slice(0, 60) || 'owner';
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeOwner}.json`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return fullPath;
}

/** End-of-run summary: what was deleted per network, totals, and why any NAS file was kept. */
function printFinalSummary(results, { reportPath, nasNotDeletedLog }) {
  const rows = results.map((r) => ({
    network: r.network,
    adsDeletedEs: r.esMatchedBeforeDelete,
    adsDeletedSql: r.sqlDeleted,
    nasDeleted: r.nasDeleted,
    nasNotDeleted: r.nasNotDeleted,
    verified: r.verifiedRemainingSql === 0 && r.verifiedRemainingEs === 0 ? 'yes (0 left)' : 'NO',
  }));
  const sum = (k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  rows.push({ network: 'TOTAL', adsDeletedEs: sum('adsDeletedEs'), adsDeletedSql: sum('adsDeletedSql'), nasDeleted: sum('nasDeleted'), nasNotDeleted: sum('nasNotDeleted'), verified: '' });
  console.log('');
  console.log('════════════════════ DONE — deletion summary ════════════════════');
  console.table(rows);
  const reasons = {};
  for (const r of results) for (const x of r.nas?.notDeleted || []) reasons[x.reason] = (reasons[x.reason] || 0) + 1;
  if (Object.keys(reasons).length) {
    console.log('NAS files not deleted, by reason:');
    console.table(Object.entries(reasons).map(([reason, files]) => ({ reason, files })));
    console.log(`Full list: ${nasNotDeletedLog}`);
  }
  console.log(`Report: ${reportPath}`);
}

/** Delete NAS files listed (action "delete") in a dry-run plan, for the selected networks. */
async function runNasFromPlan(opts) {
  const lines = fs.readFileSync(opts.nasFromPlan, 'utf8').split(/\r?\n/).filter(Boolean);
  const byNetwork = new Map();
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.action !== 'delete' || !opts.networks.includes(row.network)) continue;
    if (!byNetwork.has(row.network)) byNetwork.set(row.network, new Map());
    // Re-classify: never trust the file blindly (bucket / managed-path rules apply again).
    const c = classifyNasValue(row.path, nasSettings().mediaUrl, nasBucket());
    if (c) byNetwork.get(row.network).set(c.path, c.skip || null);
  }
  const summary = [...byNetwork.entries()].map(([network, refs]) => ({ network, nasToDelete: [...refs.values()].filter((v) => !v).length }));
  console.table(summary);
  if (!opts.apply) {
    console.log('Dry-run: nothing deleted. Add --apply --confirm "DELETE_NAS_FROM_PLAN" to delete these files.');
    return { code: 0, dryRun: true, summary };
  }
  if (config.env !== 'production') throw new Error(`Refusing --apply because config.server.nodeEnv is "${config.env || 'unset'}", not "production".`);
  if (opts.confirm !== 'DELETE_NAS_FROM_PLAN') throw new Error('Refusing --apply: --confirm must exactly equal "DELETE_NAS_FROM_PLAN".');
  if (!nasDeleteTransports().length) throw new Error('Refusing --apply: no NAS delete transport configured (insertion.nas.originUrl + mediaToken, or SFTP).');

  await dbManager.connectAll(scopedNetworkConfig([...byNetwork.keys()]));
  try {
    const results = [];
    for (const [network, refs] of byNetwork) {
      const db = dbManager.getConnections(network);
      if (!db?.elastic) throw new Error(`[${network}] Elasticsearch connection is required (reference check) but unavailable.`);
      const nas = await deleteNasForNetwork(network, db.elastic, refs);
      console.log(`[${network}] NAS files deleted ${nas.deleted}/${nas.candidates} (not deleted: ${nas.notDeleted.length})`);
      results.push({ network, nas });
    }
    const log = writeNasNotDeletedLog({ keyword: 'nas-from-plan' }, results);
    if (log) console.log(`NAS files NOT deleted (with reason): ${log}`);
    return { code: 0, dryRun: false, results, nasNotDeletedLog: log };
  } finally {
    await closeNas();
    await dbManager.disconnectAll();
  }
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(usage());
    return { code: 0 };
  }
  if (opts.nasFromPlan) return runNasFromPlan(opts);

  console.log(`Mode: ${opts.apply ? 'APPLY' : 'DRY-RUN (read-only)'}`);
  if (opts.postOwner) console.log(`Post owner: ${opts.postOwner}`);
  if (opts.keyword) console.log(`Keyword: ${opts.keyword}`);
  console.log(`Matching: ${opts.match}${opts.match === 'search-api' ? ` (exact_search=${opts.exactSearch ? 1 : 0})` : ''}`);
  console.log(`NAS media: ${opts.skipNas ? 'kept (--skip-nas)' : `deleted (bucket ${nasBucket()}, via ${nasDeleteTransports().join('+') || 'NONE CONFIGURED'})`}`);
  console.log(`Networks: ${opts.networks.join(', ')}`);

  try {
    const report = await preflight(opts);
    console.table(printableReport(report));

    if (!opts.apply) {
      const owners = ownerBreakdown(report);
      if (owners.length) {
        console.log('Post owners of the matched ads (check these are the ads you mean to delete):');
        console.table(owners);
      }
      const nasPlan = opts.skipNas ? null : writeNasPlan(opts, report);
      if (nasPlan) console.log(`NAS files that would be deleted / kept (with reason): ${nasPlan}`);
      const counts = report.filter((r) => !r.error).map((r) => `${r.network}=${r.esCount}`).join(',');
      if (report.some((r) => r.error)) console.log('Some networks failed preflight (see "error"). --apply will refuse until they pass or are excluded with --networks.');
      console.log('No data was deleted. Review the counts above (and the NAS plan), then apply with:');
      console.log(`  --apply --confirm "${confirmPhrase(opts)}" --expected-counts "${counts}"`);
      if (opts.postOwner) console.log('  (and add the owner to networks.<network>.insertion.rejectedPostOwnerNames first)');
      return { code: 0, dryRun: true, report: printableReport(report), nasPlan };
    }

    if (opts.auto) {
      const owners = ownerBreakdown(report);
      if (owners.length) {
        console.log('Post owners of the matched ads being deleted:');
        console.table(owners);
      }
    }
    validateApply(opts, report);
    const results = [];
    for (const item of report) {
      console.log(`[${item.network}] deleting exact owner ads...`);
      results.push(await deleteNetwork(item, opts));
    }

    const nasNotDeletedLog = writeNasNotDeletedLog(opts, results);
    const reportPath = writeReport(opts.postOwner || opts.keyword, {
      completedAt: new Date().toISOString(),
      postOwner: opts.postOwner || null,
      keyword: opts.keyword || null,
      match: opts.match,
      exactSearch: opts.exactSearch,
      networks: opts.networks,
      preflight: printableReport(report),
      results: results.map(({ nas, ...rest }) => ({ ...rest, nasDeletedPaths: nas?.deletedPaths || [] })),
      nasNotDeletedLog,
    });
    printFinalSummary(results, { reportPath, nasNotDeletedLog });
    return { code: 0, dryRun: false, results, reportPath, nasNotDeletedLog };
  } finally {
    await closeNas();
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
  confirmPhrase,
  searchApiParams,
  captureSearchApiQuery,
  classifyNasValue,
  nasRefsFromSource,
  collectNasRefs,
  deleteNasForNetwork,
  ownerBreakdown,
  cascadeDeleteStatements,
  deleteAdsBatched,
  nasKeyFromStoredPath,
  deleteNasFile,
};

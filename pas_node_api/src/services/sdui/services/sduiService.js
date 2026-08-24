'use strict';

const crypto = require('crypto');
const { getDB } = require('../db');
const { buildSDUIDocuments } = require('../seed/seedData');
const databaseManager = require('../../../database/DatabaseManager');
const networks = require('../../../config/networks');

const ADMOB_PLATFORM_OPTION = {
  _id: 'admob',
  filter_id: 'platform_selector',
  label: 'AdMob',
  value: 'admob',
  rank: 12,
  selected_by_default: true,
  icon_url: '/admob.svg',
  icon_type: 'url',
};

const ADMOB_SIDEBAR_IDS = ['country', 'source', 'admob_network', 'ad_position', 'ad_sub_position', 'image_size', 'source_app', 'admob_source_app', 'ad_type', 'admob_poster_intelligence'];
const ADMOB_FILTER_ID_ALIASES = {
  source_filter: 'source_filter',
  admob_network_filter: 'admob_network_filter',
  sub_network_filter: 'admob_network_filter',
  sub_network: 'admob_network_filter',
  ad_position_filter: 'ad_position_filter',
  ad_sub_position_filter: 'ad_sub_position_filter',
  image_size_filter: 'image_size_filter',
  source_app_filter: 'source_app_filter',
  admob_source_app_filter: 'source_app_filter',
};
const ADMOB_LIVE_FILTER_IDS = new Set([
  'source_filter',
  'admob_network_filter',
  'ad_position_filter',
  'ad_sub_position_filter',
  'image_size_filter',
  'source_app_filter',
]);
const ADMOB_NETWORK_FILTER = {
  _id: 'admob_network_filter',
  group_id: 'source',
  label: 'Network',
  type: 'checkbox',
  rank: 2,
  query_param: 'subNetwork',
  multi_select: true,
  visible: true,
  platform_applicability: ['admob'],
  options: [{
    _id: 'admob_network_gdn',
    filter_id: 'admob_network_filter',
    label: 'GDN',
    value: 'gdn',
    rank: 1,
    selected_by_default: false,
    platform_applicability: ['admob'],
  }],
};
const ADMOB_SOURCE_APP_FILTER = {
  _id: 'source_app_filter',
  group_id: 'source_app',
  label: 'Source App',
  type: 'checkbox',
  rank: 1,
  query_param: 'sourceApp',
  multi_select: true,
  visible: true,
  platform_applicability: ['admob'],
  options: [],
};
const ADMOB_SOURCE_APP_DOCUMENT = {
  _id: 'source_app',
  config_type: 'sidebar',
  title: 'SOURCE APP',
  rank: 24,
  collapsed_by_default: false,
  visible: true,
  display_mode: 'accordion',
  meta: 'Filter AdMob ads by the apps where they were observed.',
  filters: [{ ...ADMOB_SOURCE_APP_FILTER }],
  flag: true,
};

const ADMOB_LABEL_OVERRIDES = {
  source_filter: {
    android: 'Android',
    ios: 'iOS',
  },
  admob_network_filter: {
    gdn: 'GDN',
  },
  ad_position_filter: {
    feed: 'News Feed',
    side: 'Side Column',
    videofeed: 'Video Feed',
    marketplace: 'Marketplace',
    shorts: 'Shorts',
    searchfeed_discovery: 'Search feed Discovery',
    homefeed_discovery: 'Home feed Discovery',
    'in-stream': 'In stream',
    companion: 'Companion',
    top: 'Top',
    middle: 'Middle',
    bottom: 'Bottom',
  },
  ad_sub_position_filter: {},
};

const ADMOB_FILTER_CACHE_TTL_MS = 60 * 1000;
let admobLiveFilterCache = null;
let admobLiveFilterCacheAt = 0;

const ADMOB_OPTION_DEFAULTS = {};

function getCanonicalAdmobFilterId(filterId) {
  return ADMOB_FILTER_ID_ALIASES[filterId] || filterId;
}

function slugifyOptionValue(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'value';
}

function normalizeAdmobFilterValue(filterId, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (filterId === 'image_size_filter') {
    return raw.replace(/\s+/g, '').replace(/[x\u00d7*]/gi, 'x').toLowerCase();
  }
  return raw.toLowerCase();
}

function humanizeAdmobValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function formatAdmobOptionLabel(filterId, normalizedValue, rawLabel) {
  const explicit = ADMOB_LABEL_OVERRIDES[filterId]?.[normalizedValue];
  if (explicit) return explicit;
  if (filterId === 'source_app_filter' || filterId === 'admob_source_app_filter') {
    return String(rawLabel ?? normalizedValue).trim();
  }
  if (filterId === 'image_size_filter') {
    return normalizedValue.toLowerCase();
  }
  return humanizeAdmobValue(rawLabel ?? normalizedValue);
}

function canonicalAdmobOptionValue(filterId, normalizedValue) {
  if (filterId === 'image_size_filter') return normalizedValue.toLowerCase();
  return normalizedValue;
}

function mergeFilterPlatformApplicability(applicability, platform) {
  if (!applicability || applicability === 'all') return applicability;

  const normalized = (Array.isArray(applicability) ? applicability : [applicability])
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);

  if (normalized.length === 0) return [platform];
  if (normalized.includes(platform)) return normalized;
  return [...normalized, platform];
}

function buildAdmobOptionsFromEntries(filterId, entries) {
  const merged = new Map();
  for (const entry of entries || []) {
    const key = normalizeAdmobFilterValue(filterId, entry?.key ?? entry?.value);
    if (!key) continue;
    const count = Number(entry?.count ?? entry?.doc_count ?? 0) || 0;
    const existing = merged.get(key);
    if (existing) {
      existing.count += count;
      if (!existing.rawLabel && entry?.label) existing.rawLabel = entry.label;
      continue;
    }
    merged.set(key, {
      key,
      count,
      rawLabel: String(entry?.label ?? entry?.key ?? entry?.value ?? '').trim(),
    });
  }

  return [...merged.values()]
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.rawLabel.localeCompare(right.rawLabel, undefined, { sensitivity: 'base' });
    })
    .map((entry, index) => ({
      _id: `admob_${filterId}_${slugifyOptionValue(entry.key)}`,
      filter_id: filterId,
      label: formatAdmobOptionLabel(filterId, entry.key, entry.rawLabel),
      value: canonicalAdmobOptionValue(filterId, entry.key),
      rank: index + 1,
      selected_by_default: false,
      platform_applicability: ['admob'],
    }));
}

function elasticBuckets(result, aggName) {
  const root = result?.body || result;
  return root?.aggregations?.[aggName]?.buckets || [];
}

async function fetchAdmobOptionsFromElastic() {
  const elastic = databaseManager.getElastic('admob');
  if (!elastic) return null;

  const response = await elastic.search({
    index: elastic.indexName || 'mob_search_mix',
    body: {
      size: 0,
      query: { bool: { filter: [{ term: { status: 1 } }] } },
      aggs: {
        source_values: { terms: { field: 'source', size: 25, order: { _count: 'desc' } } },
        admob_network_values: { terms: { field: 'sub_network', size: 25, order: { _count: 'desc' } } },
        ad_position_values: { terms: { field: 'ad_position', size: 50, order: { _count: 'desc' } } },
        ad_sub_position_values: { terms: { field: 'ad_sub_position', size: 50, order: { _count: 'desc' } } },
        image_size_values: { terms: { field: 'ad_image_size', size: 200, order: { _count: 'desc' } } },
        source_app_values: { terms: { field: 'source_app', size: 1000, order: { _count: 'desc' } } },
      },
    },
  });

  return {
    available: true,
    optionsByFilter: {
      source_filter: buildAdmobOptionsFromEntries('source_filter', elasticBuckets(response, 'source_values').map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
      }))),
      admob_network_filter: buildAdmobOptionsFromEntries('admob_network_filter', elasticBuckets(response, 'admob_network_values').map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
      }))),
      ad_position_filter: buildAdmobOptionsFromEntries('ad_position_filter', elasticBuckets(response, 'ad_position_values').map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
      }))),
      ad_sub_position_filter: buildAdmobOptionsFromEntries('ad_sub_position_filter', elasticBuckets(response, 'ad_sub_position_values').map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
      }))),
      image_size_filter: buildAdmobOptionsFromEntries('image_size_filter', elasticBuckets(response, 'image_size_values').map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
      }))),
      source_app_filter: buildAdmobOptionsFromEntries('source_app_filter', elasticBuckets(response, 'source_app_values').map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
        label: bucket.key,
      }))),
    },
  };
}

async function fetchAdmobOptionsFromSql() {
  const sql = databaseManager.getSQL('admob');
  if (!sql) return null;

  const [
    sourceRows,
    networkRows,
    positionRows,
    subPositionRows,
    imageSizeRows,
    sourceAppRows,
  ] = await Promise.all([
    sql.query(
      `SELECT MIN(source) AS value, COUNT(*) AS doc_count
       FROM mob_ads
       WHERE status = 1 AND source IS NOT NULL AND TRIM(source) <> ''
       GROUP BY LOWER(TRIM(source))
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      `SELECT MIN(x.sub_network) AS value, COUNT(DISTINCT a.id) AS doc_count
       FROM mob_ad_sub_networks x
       INNER JOIN mob_ads a ON a.id = x.ad_id
       WHERE a.status = 1 AND x.sub_network IS NOT NULL AND TRIM(x.sub_network) <> ''
       GROUP BY LOWER(TRIM(x.sub_network))
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      `SELECT MIN(ad_position) AS value, COUNT(*) AS doc_count
       FROM mob_ads
       WHERE status = 1 AND ad_position IS NOT NULL AND TRIM(ad_position) <> ''
       GROUP BY LOWER(TRIM(ad_position))
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      `SELECT MIN(ad_sub_position) AS value, COUNT(*) AS doc_count
       FROM mob_ads
       WHERE status = 1 AND ad_sub_position IS NOT NULL AND TRIM(ad_sub_position) <> ''
       GROUP BY LOWER(TRIM(ad_sub_position))
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      `SELECT MIN(ad_image_size) AS value, COUNT(*) AS doc_count
       FROM mob_ads
       WHERE status = 1 AND ad_image_size IS NOT NULL AND TRIM(ad_image_size) <> ''
       GROUP BY LOWER(REPLACE(REPLACE(REPLACE(TRIM(ad_image_size), '\u00D7', 'x'), '*', 'x'), ' ', ''))
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      `SELECT MIN(s.source_app) AS value, COUNT(DISTINCT a.id) AS doc_count
       FROM mob_ad_source_apps x
       INNER JOIN mob_source_apps s ON s.id = x.source_app_id
       INNER JOIN mob_ads a ON a.id = x.ad_id
       WHERE a.status = 1 AND s.source_app IS NOT NULL AND TRIM(s.source_app) <> ''
       GROUP BY LOWER(TRIM(s.source_app))
       ORDER BY doc_count DESC, value ASC`
    ),
  ]);

  return {
    available: true,
    optionsByFilter: {
      source_filter: buildAdmobOptionsFromEntries('source_filter', sourceRows),
      admob_network_filter: buildAdmobOptionsFromEntries('admob_network_filter', networkRows),
      ad_position_filter: buildAdmobOptionsFromEntries('ad_position_filter', positionRows),
      ad_sub_position_filter: buildAdmobOptionsFromEntries('ad_sub_position_filter', subPositionRows),
      image_size_filter: buildAdmobOptionsFromEntries('image_size_filter', imageSizeRows),
      source_app_filter: buildAdmobOptionsFromEntries('source_app_filter', sourceAppRows.map((row) => ({
        ...row,
        label: row.value,
      }))),
    },
  };
}

async function fetchAdmobPersistentOptionsFromSql() {
  const sql = databaseManager.getSQL('admob');
  if (!sql) return null;

  const [
    sourceRows,
    networkRows,
    positionRows,
    subPositionRows,
    imageSizeRows,
    sourceAppRows,
  ] = await Promise.all([
    sql.query(
      // normalizeAdmobPayload() already lowercases+trims `source` before it is
      // ever written to mob_ads (see insertion/normalize.js), so grouping by
      // the raw column is equivalent to LOWER(TRIM(source)) for this table —
      // and lets MySQL satisfy the GROUP BY straight from idx_mob_ads_source
      // instead of building a temp table to re-derive the expression per row.
      `SELECT MIN(source) AS value, COUNT(*) AS doc_count
       FROM mob_ads
       WHERE source IS NOT NULL AND source <> ''
       GROUP BY source
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      `SELECT MIN(sub_network) AS value, COUNT(*) AS doc_count
       FROM mob_ad_sub_networks
       WHERE sub_network IS NOT NULL AND TRIM(sub_network) <> ''
       GROUP BY LOWER(TRIM(sub_network))
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      // normalizeAdmobPayload() canonicalizes ad_position to UPPERCASE before
      // it is ever written (insertion/normalize.js), matching what has always
      // been on disk — grouping by the raw column is safe and lets MySQL use
      // idx_mob_ads_ad_position directly instead of a temp table.
      `SELECT MIN(ad_position) AS value, COUNT(*) AS doc_count
       FROM mob_ads
       WHERE ad_position IS NOT NULL AND ad_position <> ''
       GROUP BY ad_position
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      // Same canonicalization applies to ad_sub_position.
      `SELECT MIN(ad_sub_position) AS value, COUNT(*) AS doc_count
       FROM mob_ads
       WHERE ad_sub_position IS NOT NULL AND ad_sub_position <> ''
       GROUP BY ad_sub_position
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      // ad_image_size is canonicalized to 'WIDTH*HEIGHT' (no '×', no spaces)
      // at insertion time, matching the existing on-disk format.
      `SELECT MIN(ad_image_size) AS value, COUNT(*) AS doc_count
       FROM mob_ads
       WHERE ad_image_size IS NOT NULL AND ad_image_size <> ''
       GROUP BY ad_image_size
       ORDER BY doc_count DESC, value ASC`
    ),
    sql.query(
      `SELECT MIN(source_app) AS value, SUM(COALESCE(appearance_count, 1)) AS doc_count
       FROM mob_source_apps
       WHERE source_app IS NOT NULL AND TRIM(source_app) <> ''
       GROUP BY LOWER(TRIM(source_app))
       ORDER BY doc_count DESC, value ASC`
    ),
  ]);

  return {
    available: true,
    optionsByFilter: {
      source_filter: buildAdmobOptionsFromEntries('source_filter', sourceRows),
      admob_network_filter: buildAdmobOptionsFromEntries('admob_network_filter', networkRows),
      ad_position_filter: buildAdmobOptionsFromEntries('ad_position_filter', positionRows),
      ad_sub_position_filter: buildAdmobOptionsFromEntries('ad_sub_position_filter', subPositionRows),
      image_size_filter: buildAdmobOptionsFromEntries('image_size_filter', imageSizeRows),
      source_app_filter: buildAdmobOptionsFromEntries('source_app_filter', sourceAppRows.map((row) => ({
        ...row,
        label: row.value,
      }))),
    },
  };
}

// Never let the cache regress: a transient SQL hiccup that falls through to
// the narrower Elasticsearch fallback (status=1 ads only), or an ES result
// that's momentarily incomplete, must not overwrite a previously-fuller
// option list. Per filter, keep whichever of {incoming, cached} has more
// options — the sidebar can only grow or stay the same across cache
// refreshes, never visibly shrink. Mirrors the equivalent client-side guard
// in useSDUI.js (admobDynamicDocsRef).
function mergeAdmobLiveOptionsNeverRegress(incoming, cached) {
  if (!incoming || incoming.available === false) return cached || incoming;
  if (!cached || cached.available === false) return incoming;

  const filterIds = new Set([
    ...Object.keys(incoming.optionsByFilter || {}),
    ...Object.keys(cached.optionsByFilter || {}),
  ]);
  const optionsByFilter = {};
  for (const filterId of filterIds) {
    const incomingOptions = incoming.optionsByFilter?.[filterId] || [];
    const cachedOptions = cached.optionsByFilter?.[filterId] || [];
    optionsByFilter[filterId] = incomingOptions.length >= cachedOptions.length
      ? incomingOptions
      : cachedOptions;
  }
  return { available: true, optionsByFilter };
}

async function getAdmobLiveFilterOptions() {
  const now = Date.now();
  if (admobLiveFilterCache && (now - admobLiveFilterCacheAt) < ADMOB_FILTER_CACHE_TTL_MS) {
    return admobLiveFilterCache;
  }

  let live = null;
  try {
    live = await fetchAdmobPersistentOptionsFromSql();
  } catch (err) {
    // Diagnostic only — falling through to the ES source below narrows
    // source_app/sub_network options to only currently-active (status=1)
    // ads instead of the full persisted history. Logging the real reason
    // instead of swallowing it silently.
    console.warn('[sdui] AdMob live filter options: SQL source failed, falling back to Elasticsearch.', err?.message);
    live = null;
  }

  if (!live) {
    try {
      live = await fetchAdmobOptionsFromElastic();
    } catch (err) {
      console.warn('[sdui] AdMob live filter options: Elasticsearch fallback also failed.', err?.message);
      live = null;
    }
  }

  const nextCache = live || { available: false, optionsByFilter: {} };
  admobLiveFilterCache = mergeAdmobLiveOptionsNeverRegress(nextCache, admobLiveFilterCache);
  admobLiveFilterCacheAt = now;
  return admobLiveFilterCache;
}

// Called by the AdMob insertion pipeline right after a successful insert/
// update so the next SDUI request re-reads MySQL instead of serving a
// snapshot from before this ad existed — the TTL alone could otherwise
// serve a stale/empty list for up to ADMOB_FILTER_CACHE_TTL_MS after new
// data lands. Safe to call liberally: it only clears an in-memory value,
// never touches the DB, and a missed call just falls back to the existing
// TTL behavior.
function invalidateAdmobFilterOptionsCache() {
  admobLiveFilterCache = null;
  admobLiveFilterCacheAt = 0;
}

function mergeAdmobOptions(filter) {
  const options = (filter.options || []).map((option) => ({ ...option }));
  const canonicalFilterId = getCanonicalAdmobFilterId(filter._id);
  for (const [index, option] of (ADMOB_OPTION_DEFAULTS[canonicalFilterId] || []).entries()) {
    if (options.some((existing) => String(existing.value).toLowerCase() === option.value.toLowerCase())) continue;
    options.push({
      _id: `admob_${filter._id}_${index + 1}`,
      filter_id: filter._id,
      ...option,
      rank: options.length + 1,
      selected_by_default: false,
      platform_applicability: ['admob'],
    });
  }
  return options;
}

function fallbackAdmobOptions(filter) {
  const canonicalFilterId = getCanonicalAdmobFilterId(filter._id);
  return (ADMOB_OPTION_DEFAULTS[canonicalFilterId] || []).map((option, index) => ({
    _id: `admob_${filter._id}_${index + 1}`,
    filter_id: filter._id,
    label: option.label,
    value: option.value,
    rank: index + 1,
    selected_by_default: false,
    platform_applicability: ['admob'],
  }));
}

function resolveAdmobFilterOptions(filter, liveOptions) {
  const filterId = getCanonicalAdmobFilterId(filter._id);
  const allOptions = Array.isArray(filter.options) ? filter.options.map((option) => ({ ...option })) : [];
  // Several of these live-hydrated filters (e.g. ad_position_filter) are
  // shared sidebar docs also used by other networks (facebook/youtube), and
  // their static options are tagged platform_applicability: "all" — meaning
  // they leak into AdMob's list too unless filtered out. Only keep static
  // options explicitly scoped to admob; the rest come from the live DB query
  // below, which is the actual source of truth for AdMob's real values.
  const existingOptions = allOptions.filter((option) => {
    const pa = option.platform_applicability;
    if (!pa) return true;
    return pa === 'admob' || (Array.isArray(pa) && pa.includes('admob'));
  });
  // Manually-authored options are the primary source of truth for this
  // filter — once an admin has curated a list, live DB data must never mix
  // into or reorder it. Live data is consulted only as a fallback when no
  // manual options exist at all, so a filter that has never been curated
  // still shows real data instead of sitting empty.
  if (existingOptions.length > 0) return existingOptions;

  const dynamicOptions = liveOptions?.optionsByFilter?.[filterId];
  if (liveOptions?.available && dynamicOptions?.length > 0) return dynamicOptions;

  return fallbackAdmobOptions(filter);
}

async function prepareAdmobSidebar(config) {
  const liveOptions = await getAdmobLiveFilterOptions();
  let hasAdmobNetworkDocument = false;
  let hasSourceAppDocument = false;
  const prepared = {
    ...config,
    navbar: (config.navbar || []).map((doc) => ({
      ...doc,
      filters: (doc.filters || []).map((filter) => ({
        ...filter,
        platform_filter_matrix: filter.platform_filter_matrix
          ? { ...filter.platform_filter_matrix, admob: ADMOB_SIDEBAR_IDS }
          : filter.platform_filter_matrix,
      })),
    })),
    sidebar: (config.sidebar || []).map((doc) => {
      if (doc._id === 'admob_network') hasAdmobNetworkDocument = true;
      // The admin panel's persisted, manually-curated Source App doc uses the
      // id 'admob_source_app' (kept distinct from the never-persisted
      // synthetic 'source_app' template below). Recognizing only 'source_app'
      // here meant the curated doc was silently dropped from the AdMob-scoped
      // sidebar (it isn't in ADMOB_SIDEBAR_IDS's original list) and replaced
      // by an auto-generated doc built straight from live SQL data, bypassing
      // the admin's curation entirely.
      if (doc._id === 'source_app' || doc._id === 'admob_source_app') hasSourceAppDocument = true;
      if (!ADMOB_SIDEBAR_IDS.includes(doc._id)) return doc;

      const filters = (doc.filters || []).map((filter) => ({
        ...filter,
        platform_applicability: mergeFilterPlatformApplicability(
          filter.platform_applicability,
          'admob'
        ),
        options: ADMOB_LIVE_FILTER_IDS.has(getCanonicalAdmobFilterId(filter._id))
          ? resolveAdmobFilterOptions(filter, liveOptions)
          : mergeAdmobOptions(filter),
      }));

      return {
        ...doc,
        title: doc._id === 'source' ? 'SOURCE' : doc.title,
        filters,
      };
    }),
  };

  if (!hasAdmobNetworkDocument) {
    prepared.sidebar.push({
      _id: 'admob_network',
      config_type: 'sidebar',
      title: 'NETWORK',
      rank: 18,
      collapsed_by_default: false,
      visible: true,
      display_mode: 'accordion',
      meta: 'Filter AdMob ads by their source network.',
      filters: [{
        ...ADMOB_NETWORK_FILTER,
        group_id: 'admob_network',
        options: resolveAdmobFilterOptions(ADMOB_NETWORK_FILTER, liveOptions),
      }],
      flag: true,
    });
  }

  if (!hasSourceAppDocument) {
    const sourceAppOptions = liveOptions?.available
      ? (liveOptions.optionsByFilter.source_app_filter || [])
      : resolveAdmobFilterOptions(ADMOB_SOURCE_APP_FILTER, liveOptions);
    prepared.sidebar.push({
      ...ADMOB_SOURCE_APP_DOCUMENT,
      filters: [{
        ...ADMOB_SOURCE_APP_FILTER,
        options: sourceAppOptions,
      }],
    });
  }

  return prepared;
}

function includeAdmobPlatform(docs) {
  const platforms = docs.find((doc) => doc?._id === 'platforms');
  const selector = platforms?.filters?.find((filter) => filter?._id === 'platform_selector');
  if (!selector) return docs;
  selector.options ||= [];
  if (!networks.admob?.enabled) {
    selector.options = selector.options.filter((option) => option?.value !== 'admob');
    return docs;
  }
  if (!selector.options.some((option) => option?.value === 'admob')) {
    selector.options.push({ ...ADMOB_PLATFORM_OPTION });
  }
  selector.platform_filter_matrix ||= {};
  selector.platform_filter_matrix.admob = ADMOB_SIDEBAR_IDS;
  return docs;
}

/**
 * GET /api/sdui/config
 * Returns all SDUI config documents grouped by config_type.
 * Supports ETag-based HTTP caching.
 */
async function getSDUIConfig() {
  let dbDocs = [];

  try {
    const db = await getDB();
    dbDocs = await db.collection('sdui_config').find({}).toArray();
  } catch (err) {
    // DB connection failed — fall through to seed fallback
  }

  // Use MongoDB as the source of truth. Fall back to seed only if DB is empty.
  const docs = includeAdmobPlatform(dbDocs.length > 0 ? dbDocs : buildSDUIDocuments());

  // Pre-seed known types, but also accept any new config_type dynamically
  const result = {
    searchbar: [],
    navbar: [],
    sidebar: [],
  };

  for (const doc of docs) {
    const type = doc.config_type;
    if (!type) continue;
    if (!result[type]) result[type] = [];
    result[type].push(doc);
  }

  return result;
}

/**
 * Check if a platform_applicability value matches the selected platforms.
 * - If applicability is missing, 'all', or not an array → always matches (common/universal).
 * - If applicability is an array → matches if at least one platform overlaps.
 */
function matchesPlatform(applicability, platforms) {
  if (!applicability || applicability === 'all') return true;
  if (!Array.isArray(applicability)) return true;
  return applicability.some(p => platforms.includes(p));
}

/**
 * Filter SDUI config by selected platforms.
 *
 * Filtering happens at 3 levels:
 *   1. Document level — sidebar docs checked against platform_filter_matrix
 *   2. Filter level   — filter.platform_applicability
 *   3. Option level   — option.platform_applicability (absent = common, shown for all)
 *
 * @param {Object} config  Grouped config: { searchbar: [...], navbar: [...], sidebar: [...] }
 * @param {string[]} platforms  e.g. ['facebook', 'youtube']
 * @returns {Object} Filtered config with identical structure
 */
async function filterConfigByPlatforms(config, platforms) {
  if (!platforms || !platforms.length) return config;

  const normalizedPlatforms = platforms.map((platform) => String(platform).toLowerCase());
  const isAdmobOnly = normalizedPlatforms.length === 1 && normalizedPlatforms[0] === 'admob';
  const hasAdmob = normalizedPlatforms.includes('admob');
  const sourceConfig = hasAdmob
    ? await prepareAdmobSidebar(config)
    : config;

  // Extract platform_filter_matrix from the navbar "platforms" document
  const platformsDoc = (sourceConfig.navbar || []).find(d => d._id === 'platforms');
  const matrix = platformsDoc?.filters?.[0]?.platform_filter_matrix || {};

  // Build a set of sidebar section IDs that are allowed for selected platforms
  const allowedSidebarIds = new Set();
  for (const p of normalizedPlatforms) {
    for (const sectionId of (matrix[p] || [])) {
      allowedSidebarIds.add(sectionId);
    }
  }

  const filtered = {};
  for (const [type, docs] of Object.entries(sourceConfig)) {
    filtered[type] = docs
      .filter(doc => {
        // Sidebar docs: only keep if listed in the matrix for selected platforms
        if (type === 'sidebar' && allowedSidebarIds.size > 0) {
          return allowedSidebarIds.has(doc._id);
        }
        return true;
      })
      .map(doc => {
        const newDoc = { ...doc };
        if (newDoc.filters) {
          newDoc.filters = newDoc.filters
            .filter(f => matchesPlatform(f.platform_applicability, normalizedPlatforms))
            .map(f => {
              if (!f.options) return f;
              const newF = { ...f };
              newF.options = f.options
              .filter(o => matchesPlatform(o.platform_applicability, normalizedPlatforms))
              .map(o => {
                if (!o.children) return o;
                return {
                  ...o,
                  children: o.children.filter(c =>
                    matchesPlatform(c.platform_applicability, normalizedPlatforms)
                  ),
                };
              });
              return newF;
            })
            .filter(f => isAdmobOnly || !f.options || f.options.length > 0);
        }
        return newDoc;
      })
      .filter(doc => isAdmobOnly || !doc.filters || doc.filters.length > 0);
  }
  return filtered;
}

/**
 * Compute ETag (MD5 hex of JSON body) - same algorithm as Go backend.
 */
function computeETag(body) {
  return `"${crypto.createHash('md5').update(body).digest('hex')}"`;
}

/**
 * Compute numeric version from MD5 hash - same algorithm as Go backend.
 */
function computeVersion(body) {
  const hash = crypto.createHash('md5').update(body).digest();
  // Read first 8 bytes as big-endian int64 (same as Go: binary.BigEndian.Uint64)
  const hi = hash.readUInt32BE(0);
  const lo = hash.readUInt32BE(4);
  return hi * 0x100000000 + lo;
}

module.exports = { getSDUIConfig, filterConfigByPlatforms, computeETag, computeVersion, invalidateAdmobFilterOptionsCache };

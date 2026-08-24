'use strict';

const networks = require('../../../config/networks');
const databaseManager = require('../../../database/DatabaseManager');
const { formatTimestampString, convertToUnixSeconds, getTimestampField } = require('../helpers/searchIntelligenceHelpers');
const { withLimit, isEsUnderStress } = require('../../common/helpers/esConcurrency');

// Shares its per-network budget with keywordAdNotificationController.js's count() calls
// (both key on the plain network slug) — see esConcurrency.js. Without this, a burst of
// concurrent Keyword Explorer / Trend Project requests could pile on top of the
// notification poll's own load with nothing capping the combined total against one
// cluster (root cause of the 2026-08-14 "Google unusable" incident). This cap is PER PM2
// WORKER PROCESS, not global (production runs multiple workers) — kept low because
// isEsUnderStress() below, which reads the cluster's own real thread-pool state, is the
// actual cross-process guard.
const ES_MAX_CONCURRENT_PER_NETWORK = 2;

// Platform-specific index mapping for Elasticsearch — sourced from config/networks.js
// so index names are never hard-coded in this file. Every network keeps its ES config
// under `database.elastic` EXCEPT TikTok, which uses `database.elastic_tiktok` (see
// config/networks.js and DatabaseManager's own `elastic_tiktok` special-case at connect
// time) — reading only `.elastic.index` silently dropped tiktok from this map entirely,
// so every caller's `PLATFORM_INDEX_MAP.tiktok || 'search_mix'` fallback fired and queried
// the wrong index (Facebook's, on TikTok's own ES client/cluster).
const PLATFORM_INDEX_MAP = Object.fromEntries(
  Object.entries(networks)
    .map(([slug, cfg]) => [slug, cfg?.database?.elastic?.index || cfg?.database?.elastic_tiktok?.index])
    .filter(([, index]) => !!index)
);

// Platform-specific field mappings for keyword/advertiser/domain searches
const PLATFORM_FIELD_MAPPINGS = {
  facebook: {
    keyword: [
      'facebook_ad_variants.title',
      'facebook_ad_variants.text',
      'facebook_ad_variants.newsfeed_description',
      'facebook_ad_variants.title_exactly',
      'facebook_ad_variants.text_exactly',
      'facebook_ad_variants.newsfeed_description_exactly',
      'facebook_translation.ad_text',
      'facebook_translation.news_feed_description',
      'facebook_translation.ad_title',
      'facebook_translations.ar.title',
      'facebook_translations.ar.text',
      'facebook_translations.ar.newsfeed_description',
    ],
    advertiser: [
      'facebook_ad_post_owners.post_owner_name',
      'facebook_ad_post_owners.post_owner_name_ru',
      'facebook_ad_post_owners.post_owner_name_fr',
      'facebook_ad_post_owners.post_owner_name_sp',
      'facebook_ad_post_owners.post_owner_name_ge',
      'facebook_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'facebook_ad_meta_data.destination_url',
  },
  instagram: {
    keyword: [
      'instagram_ad_variants.title',
      'instagram_ad_variants.text',
      'instagram_ad_variants.newsfeed_description',
      'instagram_ad_variants.title_exactly',
      'instagram_ad_variants.text_exactly',
      'instagram_ad_variants.newsfeed_description_exactly',
      'instagram_translation.ad_text',
      'instagram_translation.news_feed_description',
      'instagram_translation.ad_title',
      'instagram_translations.ar.title',
      'instagram_translations.ar.text',
      'instagram_translations.ar.newsfeed_description',
    ],
    advertiser: [
      'instagram_ad_post_owners.post_owner_name',
      'instagram_ad_post_owners.post_owner_name_ru',
      'instagram_ad_post_owners.post_owner_name_fr',
      'instagram_ad_post_owners.post_owner_name_sp',
      'instagram_ad_post_owners.post_owner_name_ge',
      'instagram_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'instagram_ad_meta_data.destination_url',
  },
  google: {
    keyword: [
      'title',
      'text',
    ],
    advertiser: [
      'post_owner_name',
      'post_owner_lower',
    ],
    domain: 'destination_url',
    // Clean, low-cardinality keyword field (see GoogleSearchQueryBuilder._getUrlEnv) —
    // when present, buildSearchClause() prefers term+prefix here over a leading-wildcard
    // scan of `domain` (destination_url), which measured ~1.1s vs ~40ms on 197M docs and
    // pinned the ES node's search thread pool for every concurrent caller (2026-08-13 incident).
    domainKeywordField: 'domain',
  },
  google_transparency: {
    keyword: [
      'title',
      'text',
      'post_owner_name',
      'post_owner_lower',
    ],
    advertiser: [
      'title',
      'text',
      'post_owner_name',
      'post_owner_lower',
    ],
    domain: 'destination_url',
    // Same index/mapping as `google` (see normalizePlatformKey) — same guard applies.
    domainKeywordField: 'domain',
  },
  gdn: {
    keyword: [
      'gdn_ad_variants.title',
      'gdn_ad_variants.text',
      'gdn_ad_variants.newsfeed_description',
      'gdn_ad_variants.title_exactly',
      'gdn_ad_variants.text_exactly',
      'gdn_ad_variants.newsfeed_description_exactly',
    ],
    advertiser: [
      'gdn_ad_post_owners.post_owner_name',
      'gdn_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'gdn_ad_meta_data.destination_url',
  },
  youtube: {
    keyword: [
      'title',
      'text',
      'newsfeed_description',
    ],
    advertiser: [
      'post_owner',
    ],
    domain: 'destination_url',
  },
  linkedin: {
    keyword: [
      'ad_title',
      'ad_text',
      'newsfeed_description',
    ],
    advertiser: [
      'post_owner',
    ],
    domain: 'destination_url',
  },
  reddit: {
    keyword: [
      'reddit_ad_variants.title',
      'reddit_ad_variants.text',
      'reddit_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'reddit_ad_post_owners.post_owner_name',
      'reddit_ad_post_owners.post_owner_lower',
    ],
    domain: 'reddit_ad_meta_data.destination_url',
  },
  pinterest: {
    keyword: [
      'pinterest_ad_variants.title',
      'pinterest_ad_variants.text',
      'pinterest_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'pinterest_ad_post_owners.post_owner_name',
      'pinterest_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'pinterest_ad_meta_data.destination_url',
  },
  quora: {
    keyword: [
      'quora_ad_variants.title',
      'quora_ad_variants.text',
      'quora_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'quora_ad_post_owners.post_owner_name',
      'quora_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'quora_ad_meta_data.destination_url',
  },
  native: {
    keyword: [
      'native_ad_variants.title',
      'native_ad_variants.text',
      'native_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'native_ad_post_owners.post_owner_name',
      'native_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'native_ad_meta_data.destination_url',
  },
  tiktok: {
    keyword: [
      'ad_title',
      'industry',
      'post_owner',
      'target_keywords',
    ],
    advertiser: [
      'post_owner',
    ],
    domain: 'destination_url',
  },
};

// Google Transparency Ads are written to the SAME Elasticsearch index/schema as
// regular Google Search ads (see src/services/google/transparencyInsertion/pipeline.js
// — both land in google_ads_data_v2, discriminated only by a `platform` id inside the
// doc, not by a separate index). The scraper reports its network as the literal string
// "google_transparency" (see scrapping_status[].network / the doc's `networks` array in
// keyword_searches), which has no entry of its own in config/networks.js — so the ES
// CLIENT and INDEX it queries always resolve through the existing 'google' entry.
function normalizePlatformKey(platform) {
  const p = String(platform || '').toLowerCase();
  return p === 'google_transparency' ? 'google' : p;
}

// Which FIELDS to search, though, can differ from plain Google — PLATFORM_FIELD_MAPPINGS
// now carries a dedicated 'google_transparency' entry (broader: it also matches on
// post_owner_name/post_owner_lower for keyword searches, not just title/text). Resolve
// straight off the RAW platform key when a mapping of its own exists, falling back to the
// shared-infra normalized key otherwise — kept separate from normalizePlatformKey (used
// for client/index/timestamp-field, which genuinely are shared) so only the field
// selection changes.
function resolveFieldMappingKey(platform) {
  const raw = String(platform || '').toLowerCase();
  return PLATFORM_FIELD_MAPPINGS[raw] ? raw : normalizePlatformKey(platform);
}

// Build the type-aware ES search clause (1=keyword, 2=advertiser, 3=domain) for a
// platform's field mapping. Shared so every ads-count helper resolves the SAME fields
// for a given type instead of each one hardcoding `platformConfig.keyword` regardless
// of what's actually being searched.
function buildSearchClause(platformConfig, searchType, searchValue) {
  const searchTypeStr = String(searchType);

  if (searchTypeStr === '2') {
    const advertiserFields = platformConfig?.advertiser;
    if (!advertiserFields || advertiserFields.length === 0) return null;
    return { multi_match: { query: searchValue, type: 'phrase', fields: advertiserFields } };
  }

  if (searchTypeStr === '3') {
    const domainConfig = platformConfig?.domain;
    if (!domainConfig) return null;

    let domain;
    try {
      const parsed = new URL(searchValue.startsWith('http') ? searchValue : `http://${searchValue}`);
      domain = parsed.hostname;
    } catch {
      domain = searchValue.split('/')[0];
    }
    domain = String(domain || '').replace(/^www\./i, '').toLowerCase().trim();
    if (!domain) return null;

    // Prefer the clean keyword field (term/prefix — sorted term dictionary,
    // no full scan) over a leading-wildcard scan of the raw URL field, which
    // measured ~1.1s vs ~40ms on 197M docs and pins the ES search thread pool
    // for every concurrent caller. See GoogleSearchQueryBuilder._getUrlEnv.
    const keywordField = platformConfig?.domainKeywordField;
    if (keywordField) {
      return {
        bool: {
          should: [
            { term: { [keywordField]: domain } },
            { prefix: { [keywordField]: domain } },
          ],
          minimum_should_match: 1,
        },
      };
    }

    return { wildcard: { [domainConfig]: `*${domain}*` } };
  }

  // Default / '1' = keyword search.
  const keywordFields = platformConfig?.keyword;
  if (!keywordFields || keywordFields.length === 0) return null;
  return { multi_match: { query: searchValue, type: 'phrase', fields: keywordFields } };
}

// Escape characters that are special in Elasticsearch/Lucene regexp syntax (NOT the same
// special-char set as JS regex) so a search term containing them is matched literally.
function escapeEsRegexpValue(value) {
  return String(value).replace(/[.?+*|{}[\]()"\\#@&<>~]/g, '\\$&');
}

// TikTok-only: word-boundary regexp match instead of buildSearchClause's multi_match phrase.
// ad_title/industry/post_owner/target_keywords are short, punctuation-heavy fields that don't
// tokenize the way phrase matching expects, so a `(.*[^a-z0-9])?term([^a-z0-9].*)?` regexp
// against them (ad_title's un-analyzed .keyword subfield, the rest already keyword-mapped)
// gives reliable whole-word/substring matches the way the TikTok ad search itself does.
function buildTiktokRegexpSearchClause(searchValue) {
  const pattern = `(.*[^a-z0-9])?${escapeEsRegexpValue(String(searchValue).toLowerCase())}([^a-z0-9].*)?`;
  const fields = ['ad_title.keyword', 'industry', 'post_owner', 'target_keywords'];
  return {
    bool: {
      should: fields.map(field => ({ regexp: { [field]: { value: pattern } } })),
      minimum_should_match: 1,
    },
  };
}

// Query keyword scraping history from MongoDB using the shared DatabaseManager connection.
// `mongo` is the connection object returned by DatabaseManager.getMongo('user_activity').
// Pass `{ grouped: true }` to get the result already reshaped by groupScrapingStatusByNetworkDate
// instead of the raw document — existing callers that need the flat scrapping_status array
// (e.g. per-run ads-count batching) are unaffected since grouped defaults to false.
async function queryKeywordScrapingHistory(mongo, searchType, searchValue, { grouped = false } = {}) {
  if (!mongo || !mongo.collection) {
    return null;
  }

  try {
    const collection = mongo.collection('keyword_searches');
    const normalizedValue = searchValue.toLowerCase();

    let matchedEntry = await collection.findOne({
      type: searchType,
      valueNorm: normalizedValue
    });

    if (!matchedEntry) {
      matchedEntry = await collection.findOne({
        type: searchType,
        value: searchValue
      });
    }

    if (!matchedEntry) {
      matchedEntry = await collection.findOne({
        type: searchType,
        value: { $regex: '^' + searchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' }
      });
    }

    return grouped ? groupScrapingStatusByNetworkDate(matchedEntry) : matchedEntry;
  } catch (err) {
    return null;
  }
}

// Reshape a keyword_searches document (as returned by queryKeywordScrapingHistory) into a
// summary where scrapping_status runs are grouped by (network, date): same network scraped
// more than once on the same date collapse into one entry with a `scrapping_time` array
// instead of one flat entry per run.
function groupScrapingStatusByNetworkDate(matchedEntry) {
  if (!matchedEntry) return null;

  const groups = new Map(); // `${network}|${date}` -> group entry
  const order = []; // preserves first-seen order of (network, date) pairs

  for (const run of matchedEntry.scrapping_status || []) {
    const network = run.network;
    const date = run.date;
    if (!network || !date) continue; // can't group a run missing either key

    const key = `${network}|${date}`;
    let group = groups.get(key);
    if (!group) {
      group = { network, date, scrapping_time: [] };
      groups.set(key, group);
      order.push(key);
    }

    group.scrapping_time.push({
      startTime: run.startTime?.$date || run.startTime || null,
      endTime: run.endTime?.$date || run.endTime || null,
      status: run.status || null,
      owner: run.owner || null,
    });
  }

  return {
    value: matchedEntry.value,
    createdAt: matchedEntry.createdAt?.$date || matchedEntry.createdAt || null,
    lastSearchedAt: matchedEntry.lastSearchedAt?.$date || matchedEntry.lastSearchedAt || null,
    networks: matchedEntry.networks || [],
    scrapping_status: order.map(key => groups.get(key)),
  };
}

// Build Elasticsearch query for getAllSearches with comprehensive filtering
function buildAllSearchesQuery(params) {
  const { pageNum = 0, pageSize = 10, fromTs, toTs, activity_type, platform, ad_type, country, keyword, advertiser, domain } = params;

  const filters = [
    { range: { dateTime: { gte: fromTs, lte: toTs } } },
    { bool: { should: [
      { exists: { field: 'search.keyword' } },
      { exists: { field: 'search.advertiser' } },
      { exists: { field: 'search.domain' } },
      { exists: { field: 'dashboard.newest_sort' } },
      { exists: { field: 'dashboard.running_longest_sort' } },
      { exists: { field: 'dashboard.last_seen_sort' } },
      { exists: { field: 'dashboard.domain_sort' } },
      { exists: { field: 'dashboard.likes_sort' } },
      { exists: { field: 'dashboard.comments_sort' } },
      { exists: { field: 'dashboard.shares_sort' } },
      { exists: { field: 'dashboard.popularity_sort' } },
      { exists: { field: 'dashboard.impressions_sort' } },
      { exists: { field: 'dashboard.views_sort' } },
      { exists: { field: 'dashboard.verified' } },
      { exists: { field: 'dashboard.meta_ads_library' } },
      { exists: { field: 'dashboard.ad_seen' } },
      { exists: { field: 'dashboard.likes' } },
      { exists: { field: 'dashboard.comments' } },
      { exists: { field: 'dashboard.shares' } },
      { exists: { field: 'lander.affiliates' } },
      { exists: { field: 'lander.ecommerce' } },
      { exists: { field: 'lander.funnels' } },
      { exists: { field: 'lander.sources' } },
      { exists: { field: 'lander.marketing' } },
      { exists: { field: 'filter.country' } },
      { exists: { field: 'filter.countries' } },
      { exists: { field: 'filter.gender' } },
      { exists: { field: 'filter.ad_type' } },
      { exists: { field: 'filter.ad_categories' } },
      { exists: { field: 'filter.ad_subCategories' } },
      { exists: { field: 'filter.status' } },
      { exists: { field: 'filter.sort_by' } },
      { exists: { field: 'filter.platform' } },
      { exists: { field: 'filterType' } },
      { exists: { field: 'favourite_ad_id' } },
      { exists: { field: 'unfavourite_ad_id' } },
      { exists: { field: 'download.ad_id' } },
      { exists: { field: 'hide_ad_id' } },
      { exists: { field: 'unhide_ad_id' } },
      { exists: { field: 'hide_advertiser_id' } },
      { exists: { field: 'unhide_advertiser_id' } },
      { exists: { field: 'copy.ad_id' } },
      { exists: { field: 'show_analytics.ad_id' } },
      { exists: { field: 'dashboard.show_original' } },
      { exists: { field: 'dashboard.exportsAds' } },
      { exists: { field: 'dashboard.favourite' } },
      { exists: { field: 'dashboard.hidden' } },
      { exists: { field: 'user.language' } },
      { exists: { field: 'share.guest_page_url' } },
      { exists: { field: 'vieworiginal.ad_id' } },
      { exists: { field: 'filter.native_network' } },
      { exists: { field: 'filter.ctr' } },
      { exists: { field: 'filter.budget' } },
    ], minimum_should_match: 1 } },
  ];

  if (platform && platform !== 'Any') filters.push({ match: { 'network': { query: platform.toLowerCase(), operator: 'or' } } });
  if (ad_type && ad_type !== 'Any') filters.push({ term: { 'filter.ad_type.keyword': ad_type } });
  if (country && country !== '') filters.push({ term: { 'user.current_country.keyword': country } });

  // Activity type filter — supports comma-separated values for multiple types (OR logic)
  const selectedTypes = [];
  if (activity_type && activity_type !== '') {
    selectedTypes.push(...activity_type.split(',').map(t => t.trim()).filter(Boolean));
  }

  // Text filters (keyword, advertiser, domain) only apply if:
  // 1. No activity type is selected (show all), OR
  // 2. The corresponding activity type is selected
  const showAllActivityTypes = selectedTypes.length === 0;
  const textFilterClauses = [];

  if (keyword && keyword !== '' && (showAllActivityTypes || selectedTypes.includes('keyword'))) {
    textFilterClauses.push({ match: { 'search.keyword': { query: keyword, operator: 'and' } } });
  }
  if (advertiser && advertiser !== '' && (showAllActivityTypes || selectedTypes.includes('advertiser'))) {
    textFilterClauses.push({ match: { 'search.advertiser': { query: advertiser, operator: 'and' } } });
  }
  if (domain && domain !== '' && (showAllActivityTypes || selectedTypes.includes('domain'))) {
    textFilterClauses.push({ match: { 'search.domain': { query: domain, operator: 'and' } } });
  }

  // If multiple text filters are active, combine them with OR logic
  if (textFilterClauses.length > 1) {
    filters.push({ bool: { should: textFilterClauses, minimum_should_match: 1 } });
  } else if (textFilterClauses.length === 1) {
    filters.push(textFilterClauses[0]);
  }

  // Build activity type filter
  if (selectedTypes.length > 0) {
    const shouldClauses = [];

    for (const type of selectedTypes) {
      if (type === 'keyword') {
        shouldClauses.push({ exists: { field: 'search.keyword' } });
      } else if (type === 'advertiser') {
        shouldClauses.push({ exists: { field: 'search.advertiser' } });
      } else if (type === 'domain') {
        shouldClauses.push({ exists: { field: 'search.domain' } });
      } else if (type === 'filters') {
        shouldClauses.push({ bool: { should: [
          { exists: { field: 'filter.country' } },
          { exists: { field: 'filter.countries' } },
          { exists: { field: 'filter.gender' } },
          { exists: { field: 'filter.ad_type' } },
          { exists: { field: 'filter.ad_categories' } },
          { exists: { field: 'filter.ad_subCategories' } },
          { exists: { field: 'filter.status' } },
          { exists: { field: 'filter.sort_by' } },
          { exists: { field: 'filter.platform' } },
          { exists: { field: 'filter.native_network' } },
          { exists: { field: 'filter.ctr' } },
          { exists: { field: 'filter.budget' } },
        ], minimum_should_match: 1 } });
      } else if (type === 'other_activity') {
        shouldClauses.push({ bool: { should: [
          { exists: { field: 'dashboard.exportsAds' } },
          { exists: { field: 'favourite_ad_id' } },
          { exists: { field: 'unfavourite_ad_id' } },
          { exists: { field: 'download.ad_id' } },
          { exists: { field: 'hide_ad_id' } },
          { exists: { field: 'unhide_ad_id' } },
          { exists: { field: 'hide_advertiser_id' } },
          { exists: { field: 'unhide_advertiser_id' } },
          { exists: { field: 'dashboard.show_original' } },
          { exists: { field: 'user.language_name' } },
          { exists: { field: 'vieworiginal.ad_id' } },
        ], minimum_should_match: 1 } });
      } else if (type === 'sorting_filters') {
        shouldClauses.push({ bool: { should: [
          { exists: { field: 'dashboard.newest_sort' } },
          { exists: { field: 'dashboard.running_longest_sort' } },
          { exists: { field: 'dashboard.last_seen_sort' } },
          { exists: { field: 'dashboard.domain_sort' } },
          { exists: { field: 'dashboard.likes_sort' } },
          { exists: { field: 'dashboard.comments_sort' } },
          { exists: { field: 'dashboard.shares_sort' } },
          { exists: { field: 'dashboard.popularity_sort' } },
          { exists: { field: 'dashboard.impressions_sort' } },
          { exists: { field: 'dashboard.views_sort' } },
        ], minimum_should_match: 1 } });
      }
    }

    if (shouldClauses.length > 0) {
      filters.push({ bool: { should: shouldClauses, minimum_should_match: 1 } });
    }
  }

  return {
    size: pageSize,
    from: pageNum * pageSize,
    query: { bool: { filter: filters } },
    sort: [{ dateTime: { order: 'desc' } }, { _id: { order: 'desc' } }],
    _source: [
      'dateTime', 'date',
      'user.id', 'user.email', 'user.username', 'user.language', 'user.language_name', 'user.current_country',
      'search.keyword', 'search.advertiser', 'search.domain',
      'network', 'filterType', 'adsCountOnSerach', 'search_error_detail',
      'dashboard.*',
      'filter.*',
      'filter.native_network',
      'search_by.*',
      'sort_by.*',
      'lander.affiliates', 'lander.ecommerce', 'lander.funnels', 'lander.sources', 'lander.marketing',
      'favourite_ad_id', 'unfavourite_ad_id',
      'hide_ad_id', 'unhide_ad_id',
      'hide_advertiser_id', 'unhide_advertiser_id',
      'download.*',
      'copy.*',
      'show_analytics.*',
      'share.*',
      'vieworiginal.ad_id',
    ],
  };
}

// `defaultSearchType` (1=keyword, 2=advertiser, 3=domain) is used for any item that
// doesn't carry its own `type` — pass it when every item in the batch is the same type
// (e.g. getTotalAdsCount, already scoped to one type). Items CAN carry their own `type`
// (e.g. enrichKeywordsWithAds under type=all, where docs are a genuine keyword/advertiser/
// domain mix) — that per-item value always wins over the default.
async function fetchAdsCountForKeywordsByPlatform(elastic, platformKeywordMap, logger, defaultSearchType = 1) {
  if (!elastic || !platformKeywordMap || Object.keys(platformKeywordMap).length === 0) {
    return {};
  }

  const results = {};
  const platformPromises = [];
  const BATCH_SIZE = 500;
  const MAX_CONCURRENT_QUERIES = 5;

  for (const [platform, keywords] of Object.entries(platformKeywordMap)) {
    const platformLower = normalizePlatformKey(platform);
    const indexName = PLATFORM_INDEX_MAP[platformLower] || 'search_mix';
    const platformElastic = databaseManager.getElastic(platformLower) || elastic;

    if (!platformElastic) {
      logger?.warn?.(`[fetchAdsCountForKeywordsByPlatform] No ES client for platform: ${platform}`);
      continue;
    }

    // Per-item field selection (keyword/advertiser/domain) happens below via
    // buildSearchClause — this is just a sanity check that the platform has ANY field
    // mapping at all; a missing mapping for one specific type is handled per-item.
    const fieldMappings = PLATFORM_FIELD_MAPPINGS[resolveFieldMappingKey(platform)];
    if (!fieldMappings) {
      logger?.warn?.(`[fetchAdsCountForKeywordsByPlatform] No field mapping for platform: ${platform}`);
      continue;
    }

    const timestampField = getTimestampField(platformLower);

    const platformPromise = (async () => {
      try {
        const enrichedKeywords = [];
        const totalKeywords = keywords.length;
        for (let batchStart = 0; batchStart < totalKeywords; batchStart += BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE, totalKeywords);
          const batch = keywords.slice(batchStart, batchEnd);
          const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
          for (let i = 0; i < batch.length; i += MAX_CONCURRENT_QUERIES) {
            const concurrentBatch = batch.slice(i, i + MAX_CONCURRENT_QUERIES);
            const batchPromises = concurrentBatch.map(async (keyword) => {
              const keywordText = keyword.keyword;
              const scrappingHistory = keyword.scrappingHistory || [];
              // Per-item type wins (mixed keyword/advertiser/domain batches, e.g.
              // enrichKeywordsWithAds under type=all); else the batch-level default.
              const itemSearchType = keyword.type ?? defaultSearchType;

              if (scrappingHistory.length === 0) {
                return {
                  keyword: keywordText,
                  scrappingHistory: [],
                  total_ads_count: 0,
                  history_with_counts: []
                };
              }

              const searchClause = buildSearchClause(fieldMappings, itemSearchType, keywordText);
              if (!searchClause) {
                logger?.warn?.(`[fetchAdsCountForKeywordsByPlatform] No field mapping for type ${itemSearchType} on platform: ${platform}`);
                return {
                  keyword: keywordText,
                  scrappingHistory,
                  total_ads_count: 0,
                  history_with_counts: scrappingHistory.map(run => ({
                    startTime: run.startTime,
                    endTime: run.endTime,
                    ads_count: 0
                  }))
                };
              }

              try {
                // One filter-aggregation PER time window — gives the REAL ad count
                // matched inside each specific window, instead of a single combined
                // count() mathematically split evenly across the runs. size:0 skips
                // fetching hits entirely; only the aggregation buckets are needed.
                const aggs = {};
                scrappingHistory.forEach((run, index) => {
                  let startStr = formatTimestampString(JSON.stringify(run.startTime));
                  let endStr = formatTimestampString(JSON.stringify(run.endTime));

                  // For LinkedIn and YouTube: convert to Unix seconds
                  if (platformLower === 'linkedin' || platformLower === 'youtube') {
                    startStr = convertToUnixSeconds(startStr);
                    endStr = convertToUnixSeconds(endStr);
                  }

                  aggs[`tw_${index}`] = {
                    filter: {
                      range: {
                        [timestampField]: {
                          gte: startStr,
                          lte: endStr
                        }
                      }
                    }
                  };
                });

                const esQuery = {
                  index: indexName,
                  body: {
                    size: 0,
                    track_total_hits: false,
                    query: { bool: { must: [searchClause] } },
                    aggs
                  }
                };


                // Cross-process safety net (see esConcurrency.js) — if the cluster is
                // already saturated (from ANY worker's combined traffic), back off this
                // one keyword rather than piling on; it falls into the catch below and
                // comes back as a graceful 0-count instead of adding to the overload.
                if (await isEsUnderStress(platformLower)) {
                  throw new Error('ES cluster under stress — skipped this cycle');
                }

                const esResult = await withLimit(platformLower, () => platformElastic.search(esQuery), ES_MAX_CONCURRENT_PER_NETWORK);
                const resultAggs = esResult.aggregations || esResult.body?.aggregations || {};

                let totalCount = 0;
                const history_with_counts = scrappingHistory.map((run, index) => {
                  const adsCount = resultAggs[`tw_${index}`]?.doc_count || 0;
                  totalCount += adsCount;

                  return {
                    startTime: run.startTime,
                    endTime: run.endTime,
                    ads_count: adsCount
                  };
                });

                return {
                  keyword: keywordText,
                  scrappingHistory: scrappingHistory,
                  total_ads_count: totalCount,
                  history_with_counts
                };
              } catch (err) {
                logger?.warn?.(`[fetchAdsCountForKeywordsByPlatform] Error for keyword "${keywordText}" on ${platform}:`, err.message);
                return {
                  keyword: keywordText,
                  scrappingHistory: scrappingHistory,
                  total_ads_count: 0,
                  history_with_counts: scrappingHistory.map(run => ({
                    startTime: run.startTime,
                    endTime: run.endTime,
                    ads_count: 0,
                    error: err.message
                  }))
                };
              }
            });

            const concurrentResults = await Promise.all(batchPromises);
            enrichedKeywords.push(...concurrentResults);
          }

          logger?.info?.(`[fetchAdsCountForKeywordsByPlatform] Completed batch ${batchNum} for ${platform}`);
        }

        results[platform] = enrichedKeywords;

      } catch (err) {
        logger?.error?.(`[fetchAdsCountForKeywordsByPlatform] Error processing platform ${platform}:`, err.message);
        results[platform] = keywords.map(k => ({
          keyword: k.keyword,
          scrappingHistory: k.scrappingHistory,
          total_ads_count: 0,
          history_with_counts: [],
          error: err.message
        }));
      }
    })();

    platformPromises.push(platformPromise);
  }

  await Promise.all(platformPromises);
  return results;
}

// Fetch per-(network, date) ads counts for ONE keyword/advertiser/domain's grouped
// scrapping_status (see groupScrapingStatusByNetworkDate). Dedicated, simpler sibling of
// fetchAdsCountForKeywordsByPlatform: that one batches MANY keywords across MANY platforms
// (keyword-trends list, enrichKeywordsWithAds) via a per-keyword scrappingHistory array; here
// there's only ever a single search term, so it skips that batching layer and queries each
// network directly, one filter-agg per date group. Same whole-day window (00:00:00–23:59:59)
// as before, same concurrency/stress guards — just not routed through the multi-keyword path.
// Mutates `adsCount` onto each group (0 by default, including on error) and returns the array.
async function fetchAdsCountByNetworkDate(elastic, searchValue, searchType, scrappingStatus, logger) {
  if (!elastic || !scrappingStatus || scrappingStatus.length === 0) {
    return scrappingStatus || [];
  }

  // network -> group refs, in the same order they're pushed into that network's aggs below
  const groupsByNetwork = {};
  for (const group of scrappingStatus) {
    group.adsCount = 0; // default until (if) overwritten below
    if (!group.network || !group.date) continue; // no dated window to count against
    if (!groupsByNetwork[group.network]) groupsByNetwork[group.network] = [];
    groupsByNetwork[group.network].push(group);
  }

  const networkPromises = Object.entries(groupsByNetwork).map(async ([network, groups]) => {
    const platformLower = normalizePlatformKey(network);
    const indexName = PLATFORM_INDEX_MAP[platformLower] || 'search_mix';
    const platformElastic = databaseManager.getElastic(platformLower) || elastic;

    if (!platformElastic) {
      logger?.warn?.(`[fetchAdsCountByNetworkDate] No ES client for network: ${network}`);
      return;
    }

    // TikTok uses a dedicated regexp clause (see buildTiktokRegexpSearchClause) instead of
    // the shared multi_match-phrase builder every other network goes through.
    let searchClause;
    if (platformLower === 'tiktok') {
      searchClause = buildTiktokRegexpSearchClause(searchValue);
    } else {
      const fieldMappings = PLATFORM_FIELD_MAPPINGS[resolveFieldMappingKey(network)];
      searchClause = fieldMappings ? buildSearchClause(fieldMappings, searchType, searchValue) : null;
    }
    if (!searchClause) {
      logger?.warn?.(`[fetchAdsCountByNetworkDate] No field mapping for type ${searchType} on network: ${network}`);
      return;
    }

    const timestampField = getTimestampField(platformLower);

    // One filter-agg per date group — the whole calendar day, same boundary
    // getKeywordScrapingHistory has always used.
    const aggs = {};
    groups.forEach((group, index) => {
      let startStr = `${group.date} 00:00:00`;
      let endStr = `${group.date} 23:59:59`;

      // For LinkedIn and YouTube: convert to Unix seconds
      if (platformLower === 'linkedin' || platformLower === 'youtube') {
        startStr = convertToUnixSeconds(startStr);
        endStr = convertToUnixSeconds(endStr);
      }

      aggs[`dt_${index}`] = {
        filter: { range: { [timestampField]: { gte: startStr, lte: endStr } } },
      };
    });

    try {
      // Cross-process safety net (see esConcurrency.js) — same backoff fetchAdsCountForKeywordsByPlatform uses.
      if (await isEsUnderStress(platformLower)) {
        throw new Error('ES cluster under stress — skipped this cycle');
      }

      const esQuery = {
        index: indexName,
        body: { size: 0, track_total_hits: false, query: { bool: { must: [searchClause] } }, aggs },
      };

      console.log("queiressss",JSON.stringify(esQuery));
      const esResult = await withLimit(platformLower, () => platformElastic.search(esQuery), ES_MAX_CONCURRENT_PER_NETWORK);
      const resultAggs = esResult.aggregations || esResult.body?.aggregations || {};

      groups.forEach((group, index) => {
        group.adsCount = resultAggs[`dt_${index}`]?.doc_count || 0;
      });
    } catch (err) {
      logger?.warn?.(`[fetchAdsCountByNetworkDate] Error for "${searchValue}" on ${network}:`, err.message);
      // groups already defaulted to adsCount: 0 above
    }
  });

  await Promise.all(networkPromises);
  return scrappingStatus;
}

module.exports = {
  queryKeywordScrapingHistory,
  groupScrapingStatusByNetworkDate,
  buildAllSearchesQuery,
  fetchAdsCountForKeywordsByPlatform,
  fetchAdsCountByNetworkDate,
  PLATFORM_INDEX_MAP,
  PLATFORM_FIELD_MAPPINGS,
};

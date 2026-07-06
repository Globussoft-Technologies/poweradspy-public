'use strict';

const networks = require('../../../config/networks');
const databaseManager = require('../../../database/DatabaseManager');
const { formatTimestampString, convertToUnixSeconds, getTimestampField } = require('../helpers/searchIntelligenceHelpers');

// Platform-specific index mapping for Elasticsearch — sourced from config/networks.js
// so index names are never hard-coded in this file.
const PLATFORM_INDEX_MAP = Object.fromEntries(
  Object.entries(networks)
    .filter(([, cfg]) => cfg?.database?.elastic?.index)
    .map(([slug, cfg]) => [slug, cfg.database.elastic.index])
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
      'google_ad_variants.title',
      'google_ad_variants.text',
      'google_ad_variants.newsfeed_description',
      'google_ad_variants.title_exactly',
      'google_ad_variants.text_exactly',
      'google_ad_variants.newsfeed_description_exactly',
    ],
    advertiser: [
      'google_ad_post_owners.post_owner_name',
      'google_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'google_ad_meta_data.destination_url',
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
      'youtube_ad_variants.title',
      'youtube_ad_variants.text',
      'youtube_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'youtube_ad_post_owners.post_owner_name',
    ],
    domain: 'youtube_ad_meta_data.destination_url',
  },
  linkedin: {
    keyword: [
      'ad_title',
      'ad_text',
      'newsfeed_description',
    ],
    advertiser: [
      'linkedin_ad_post_owners.post_owner_name_exactly',
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
      'reddit_ad_post_owners.post_owner_name_exactly',
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

// Fetch ads count from platform-specific indices
// Supports keyword, advertiser, and domain searches with time range filtering
async function fetchAdsCountByPlatform(elastic, platforms, dateStr, searchValue, searchType, logger, startTime = null, endTime = null) {
  
  let totalCount = 0;

  for (const platform of platforms) {
    try {
      const platformName = platform.toLowerCase();
      const indexName = PLATFORM_INDEX_MAP[platformName] || 'search_mix';
      const platformConfig = PLATFORM_FIELD_MAPPINGS[platformName];

      if (!platformConfig) {
        logger?.warn?.('[fetchAdsCountByPlatform] Unknown platform:', platform);
        continue;
      }

      // Each platform lives on its own Elasticsearch cluster in production.
      // Prefer the per-network pooled client; fall back to the supplied client.
      const platformElastic = databaseManager.getElastic(platformName) || elastic;
      if (!platformElastic) {
        logger?.warn?.('[fetchAdsCountByPlatform] No ES client for platform:', platform);
        continue;
      }

      const timestampField = getTimestampField(platformName);

      let startStr = formatTimestampString(JSON.stringify(startTime));
      let endStr = formatTimestampString(JSON.stringify(endTime));

  
      // For LinkedIn and YouTube: convert string timestamps to Unix seconds
      if (platformName === 'linkedin' || platformName === 'youtube') {
        startStr = convertToUnixSeconds(startStr);
        endStr = convertToUnixSeconds(endStr);
      }

      // Build range query with platform-specific timestamp field
      const baseQuery = {
        bool: {
          filter: [
            { range: { [timestampField]: { gte: startStr, lte: endStr } } }
          ],
          must: []
        }
      };
  
      const searchTypeStr = String(searchType);
      

      // Add search-specific filter
      if (searchTypeStr === '1') {
        // Keyword search
        const keywordFields = platformConfig.keyword;
        if (keywordFields && keywordFields.length > 0) {
          baseQuery.bool.must.push({
            multi_match: {
              query: searchValue,
              type: 'phrase',
              fields: keywordFields
            }
          });
        }
      } else if (searchTypeStr === '2') {
        // Advertiser search
        const advertiserFields = platformConfig.advertiser;
        if (advertiserFields && advertiserFields.length > 0) {
          baseQuery.bool.must.push({
            multi_match: {
              query: searchValue,
              type: 'phrase',
              fields: advertiserFields
            }
          });
        }
      } else if (searchTypeStr === '3') {
        // Domain search
        const domainField = platformConfig.domain;
        if (domainField) {
          let domain;
          try {
            const parsed = new URL(searchValue.startsWith('http') ? searchValue : `http://${searchValue}`);
            domain = parsed.hostname;
          } catch {
            domain = searchValue.split('/')[0];
          }
          baseQuery.bool.must.push({
            wildcard: {
              [domainField]: `*${domain}*`
            }
          });
        }
      }

      if (baseQuery.bool.must.length === 0) {
        logger?.warn?.('[fetchAdsCountByPlatform] No search clause for type:', searchType);
        continue;
      }


      const esQuery = {
        index: indexName,
        body: {
          query: baseQuery
        }
      };

      logger?.info?.('[fetchAdsCountByPlatform] Query for platform:', { platform, index: indexName, searchType, searchValue });

      const esResult = await platformElastic.count(esQuery);
      const count = esResult.count || esResult.body?.count || 0;
      totalCount += count;

      logger?.info?.('[fetchAdsCountByPlatform] Results:', { platform, count });
    } catch (err) {
      logger?.warn?.('[fetchAdsCountByPlatform] Failed for platform:', platform, 'Error:', err.message);
    }
  }

  return totalCount;
}

// Batch fetch ads counts for a single keyword/advertiser/domain across multiple time windows
// Optimized for platform-wise history fetching - returns counts per platform per time window
// Input: keyword, platforms, array of time windows with startTime and endTime
// Output: { [platform]: { [timeWindowKey]: adsCount } }
async function fetchAdsCountBatchByPlatform(elastic, platforms, searchValue, searchType, timeWindows, logger) {
  const resultsMap = {}; // { platform: { timeWindowKey: count } }

  // Initialize structure for each platform
  for (const platform of platforms) {
    resultsMap[platform.toLowerCase()] = {};
  }

  // Build promises for all platform × timeWindow combinations
  const promises = [];
  const promiseMetadata = [];

  for (const platform of platforms) {
    const platformName = platform.toLowerCase();
    const indexName = PLATFORM_INDEX_MAP[platformName] || 'search_mix';
    const platformConfig = PLATFORM_FIELD_MAPPINGS[platformName];

    if (!platformConfig) {
      logger?.warn?.('[fetchAdsCountBatchByPlatform] Unknown platform:', platform);
      continue;
    }

    const platformElastic = databaseManager.getElastic(platformName) || elastic;
    if (!platformElastic) {
      logger?.warn?.('[fetchAdsCountBatchByPlatform] No ES client for platform:', platform);
      continue;
    }

    const timestampField = getTimestampField(platformName);
    const searchTypeStr = String(searchType);

    // For each time window, create a query promise
    for (const timeWindow of timeWindows) {
      const { startTime, endTime, key: timeWindowKey } = timeWindow;

      let startStr = formatTimestampString(JSON.stringify(startTime));
      let endStr = formatTimestampString(JSON.stringify(endTime));

      // For LinkedIn and YouTube: convert to Unix seconds
      if (platformName === 'linkedin' || platformName === 'youtube') {
        startStr = convertToUnixSeconds(startStr);
        endStr = convertToUnixSeconds(endStr);
      }

      // Build range query with platform-specific timestamp field
      const baseQuery = {
        bool: {
          filter: [
            { range: { [timestampField]: { gte: startStr, lte: endStr } } }
          ],
          must: []
        }
      };

      // Add search-specific filter based on type
      if (searchTypeStr === '1') {
        // Keyword search
        const keywordFields = platformConfig.keyword;
        if (keywordFields && keywordFields.length > 0) {
          baseQuery.bool.must.push({
            multi_match: {
              query: searchValue,
              type: 'phrase',
              fields: keywordFields
            }
          });
        }
      } else if (searchTypeStr === '2') {
        // Advertiser search
        const advertiserFields = platformConfig.advertiser;
        if (advertiserFields && advertiserFields.length > 0) {
          baseQuery.bool.must.push({
            multi_match: {
              query: searchValue,
              type: 'phrase',
              fields: advertiserFields
            }
          });
        }
      } else if (searchTypeStr === '3') {
        // Domain search
        const domainField = platformConfig.domain;
        if (domainField) {
          let domain;
          try {
            const parsed = new URL(searchValue.startsWith('http') ? searchValue : `http://${searchValue}`);
            domain = parsed.hostname;
          } catch {
            domain = searchValue.split('/')[0];
          }
          baseQuery.bool.must.push({
            wildcard: {
              [domainField]: `*${domain}*`
            }
          });
        }
      }

      if (baseQuery.bool.must.length === 0) {
        logger?.warn?.('[fetchAdsCountBatchByPlatform] No search clause for type:', searchType);
        continue;
      }

      const esQuery = {
        index: indexName,
        body: {
          query: baseQuery
        }
      };

      // Store metadata for result mapping
      promiseMetadata.push({
        platform: platformName,
        timeWindowKey: timeWindowKey
      });
      

      // Add query promise to array
      promises.push(
        platformElastic.count(esQuery).catch(err => {
          logger?.warn?.('[fetchAdsCountBatchByPlatform] Failed for platform', platformName, 'timeWindow', timeWindowKey, 'Error:', err.message);
          return null;
        })
      );
    }
  }

  // Execute all queries in parallel
  logger?.info?.('[fetchAdsCountBatchByPlatform] Executing', promises.length, 'parallel ES queries');
  const esResults = await Promise.all(promises);

  // Process results and populate resultsMap
  for (let i = 0; i < esResults.length; i++) {
    const result = esResults[i];
    const metadata = promiseMetadata[i];

    if (!result) continue; // Skip failed queries

    const count = result.count || result.body?.count || 0;
    resultsMap[metadata.platform][metadata.timeWindowKey] = count;
  }

  logger?.info?.('[fetchAdsCountBatchByPlatform] Completed batch queries');
  return resultsMap;
}

// Query keyword scraping history from MongoDB using the shared DatabaseManager connection.
// `mongo` is the connection object returned by DatabaseManager.getMongo('user_activity').
async function queryKeywordScrapingHistory(mongo, searchType, searchValue) {
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

    return matchedEntry;
  } catch (err) {
    return null;
  }
}

// Build keyword trends aggregation queries
function buildKeywordTrendsQuery(activeTypes) {
  const FIELDS = {
    keyword: 'search.keyword.keyword',
    advertiser: 'search.advertiser.keyword',
    domain: 'search.domain.keyword',
  };

  const aggs = {};
  for (const t of activeTypes) {
    aggs[`top_${t}`] = {
      terms: {
        field: FIELDS[t],
        size: 10000,
        collect_mode: 'breadth_first'
      }
    };
  }

  return {
    size: 0,
    query: {
      bool: {
        filter: [
          { bool: { should: activeTypes.map((t) => ({ exists: { field: `search.${t}` } })), minimum_should_match: 1 } },
        ]
      }
    },
    aggs
  };
}

// Parse keyword trends results into formatted list
function parseKeywordTrendsResults(aggs, activeTypes) {
  function buildTermList(typeName) {
    const buckets = aggs[`top_${typeName}`]?.buckets ?? [];
    let terms = buckets.map((b) => ({
      term: b.key,
      type: typeName,
      count: b.doc_count,
    }));
    terms.sort((a, b) => b.count - a.count);
    return terms;
  }

  const data = {};
  for (const t of activeTypes) {
    data[`${t}s`] = buildTermList(t);
  }
  return data;
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
      'network', 'filterType', 'adsCountOnSerach',
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

async function fetchAdsCountForKeywordsByPlatform(elastic, platformKeywordMap, logger) {
  if (!elastic || !platformKeywordMap || Object.keys(platformKeywordMap).length === 0) {
    return {};
  }

  const results = {};
  const platformPromises = [];
  const BATCH_SIZE = 500;
  const MAX_CONCURRENT_QUERIES = 5;

  for (const [platform, keywords] of Object.entries(platformKeywordMap)) {
    const platformLower = platform.toLowerCase();
    const indexName = PLATFORM_INDEX_MAP[platformLower] || 'search_mix';
    const platformElastic = databaseManager.getElastic(platformLower) || elastic;

    if (!platformElastic) {
      logger?.warn?.(`[fetchAdsCountForKeywordsByPlatform] No ES client for platform: ${platform}`);
      continue;
    }

    const fieldMappings = PLATFORM_FIELD_MAPPINGS[platformLower];
    if (!fieldMappings || !fieldMappings.keyword) {
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

              if (scrappingHistory.length === 0) {
                return {
                  keyword: keywordText,
                  scrappingHistory: [],
                  total_ads_count: 0,
                  history_with_counts: []
                };
              }

              try {
                const timeWindowRanges = scrappingHistory.map(run => {
                  let startStr = formatTimestampString(JSON.stringify(run.startTime));
                  let endStr = formatTimestampString(JSON.stringify(run.endTime));

                  // For LinkedIn and YouTube: convert to Unix seconds
                  if (platformLower === 'linkedin' || platformLower === 'youtube') {
                    startStr = convertToUnixSeconds(startStr);
                    endStr = convertToUnixSeconds(endStr);
                  }

                  return {
                    range: {
                      [timestampField]: {
                        gte: startStr,
                        lte: endStr
                      }
                    }
                  };
                });

                const esQuery = {
                  index: indexName,
                  body: {
                    query: {
                      bool: {
                        filter: [
                          {
                            bool: {
                              should: timeWindowRanges,
                              minimum_should_match: 1
                            }
                          }
                        ],
                        must: [
                          {
                            multi_match: {
                              query: keywordText,
                              type: 'phrase',
                              fields: fieldMappings.keyword
                            }
                          }
                        ]
                      }
                    }
                  }
                };

                console.log(JSON.stringify(esQuery, null, 2));

                const esResult = await platformElastic.count(esQuery);
                const totalCount = esResult.count || esResult.body?.count || 0;

                const history_with_counts = scrappingHistory.map((run, index) => {
                  let adsCount = 0;
                  const historyLength = scrappingHistory.length;
                  const baseCount = Math.floor(totalCount / historyLength);
                  const remainder = totalCount % historyLength;

                  if (index < remainder) {
                    adsCount = baseCount + 1;
                  } else {
                    adsCount = baseCount;
                  }

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


async function fetchAdsCountForMultipleKeywordsFast(elastic, platformKeywordMap, logger) {
  if (!elastic || !platformKeywordMap || Object.keys(platformKeywordMap).length === 0) {
    return {};
  }

  const results = {};
  const platformPromises = [];

  for (const [platform, keywords] of Object.entries(platformKeywordMap)) {
    const platformLower = platform.toLowerCase();
    const indexName = PLATFORM_INDEX_MAP[platformLower] || 'search_mix';
    const platformElastic = databaseManager.getElastic(platformLower) || elastic;

    if (!platformElastic) {
      logger?.warn?.(`[fetchAdsCountForMultipleKeywordsFast] No ES client for platform: ${platform}`);
      continue;
    }

    const fieldMappings = PLATFORM_FIELD_MAPPINGS[platformLower];
    if (!fieldMappings || !fieldMappings.keyword) {
      logger?.warn?.(`[fetchAdsCountForMultipleKeywordsFast] No field mapping for platform: ${platform}`);
      continue;
    }

    const timestampField = getTimestampField(platformLower);

    const platformPromise = (async () => {
      try {
        logger?.info?.(`[fetchAdsCountForMultipleKeywordsFast] Building aggregation for ${platform}: ${keywords.length} keywords`);

        // Build aggregations for all keywords
        const aggs = {};

        for (let kidx = 0; kidx < keywords.length; kidx++) {
          const keyword = keywords[kidx];
          const keywordText = keyword.keyword;
          const scrappingHistory = keyword.scrappingHistory || [];

          // For each keyword, create sub-aggregations for each time window
          const timeWindowAggs = {};

          for (let tidx = 0; tidx < scrappingHistory.length; tidx++) {
            const timeWindow = scrappingHistory[tidx];
            const timeWindowKey = `tw_${tidx}`;

            timeWindowAggs[timeWindowKey] = {
              filter: {
                range: {
                  [timestampField]: {
                    gte: timeWindow.startTime,
                    lte: timeWindow.endTime
                  }
                }
              }
            };
          }

          // Create aggregation for this keyword with proper bool query
          aggs[`kw_${kidx}`] = {
            filter: {
              bool: {
                must: [
                  {
                    multi_match: {
                      query: keywordText,
                      type: 'phrase',
                      fields: fieldMappings.keyword
                    }
                  }
                ]
              }
            },
            aggs: timeWindowAggs
          };
        }

        const esQuery = {
          index: indexName,
          body: {
            size: 0,
            query: { match_all: {} },
            aggs: aggs
          }
        };

        const t1 = Date.now();
        const esResult = await platformElastic.search(esQuery);
        const t2 = Date.now();

        logger?.info?.(`[fetchAdsCountForMultipleKeywordsFast] Aggregation for ${platform} completed in ${t2 - t1}ms`);

        // Parse aggregation results
        const enrichedKeywords = [];
        const aggResults = esResult.aggregations || esResult.body?.aggregations || {};

        logger?.info?.(`[fetchAdsCountForMultipleKeywordsFast] Raw aggregation keys:`, Object.keys(aggResults).join(','));

        for (let kidx = 0; kidx < keywords.length; kidx++) {
          const keyword = keywords[kidx];
          const keywordText = keyword.keyword;
          const scrappingHistory = keyword.scrappingHistory || [];
          const keywordAggKey = `kw_${kidx}`;
          const keywordAgg = aggResults[keywordAggKey];

          if (!keywordAgg) {
            logger?.warn?.(`[fetchAdsCountForMultipleKeywordsFast] No aggregation result for keyword ${kidx} (${keywordText})`);
            enrichedKeywords.push({
              keyword: keywordText,
              scrappingHistory: scrappingHistory,
              total_ads_count: 0,
              history_with_counts: scrappingHistory.map(run => ({
                startTime: run.startTime,
                endTime: run.endTime,
                ads_count: 0
              }))
            });
            continue;
          }

          logger?.info?.(`[fetchAdsCountForMultipleKeywordsFast] Keyword ${kidx} (${keywordText}): doc_count=${keywordAgg.doc_count}, aggs keys=${Object.keys(keywordAgg.aggs || {}).join(',')}`);

          // Collect counts from time window aggregations
          const timeWindowCounts = [];
          for (let tidx = 0; tidx < scrappingHistory.length; tidx++) {
            const timeWindowKey = `tw_${tidx}`;
            const count = keywordAgg.aggs?.[timeWindowKey]?.doc_count || 0;
            timeWindowCounts.push(count);
          }

          const totalCount = timeWindowCounts.reduce((a, b) => a + b, 0);

          const history_with_counts = scrappingHistory.map((run, index) => ({
            startTime: run.startTime,
            endTime: run.endTime,
            ads_count: timeWindowCounts[index] || 0
          }));

          enrichedKeywords.push({
            keyword: keywordText,
            scrappingHistory: scrappingHistory,
            total_ads_count: totalCount,
            history_with_counts
          });
        }

        results[platform] = enrichedKeywords;
        logger?.info?.(`[fetchAdsCountForMultipleKeywordsFast] Completed for ${platform}: ${enrichedKeywords.length} keywords in 1 query`);
      } catch (err) {
        logger?.error?.(`[fetchAdsCountForMultipleKeywordsFast] Error processing platform ${platform}:`, err.message);
        results[platform] = keywords.map(k => ({
          keyword: k.keyword,
          scrappingHistory: k.scrappingHistory,
          total_ads_count: 0,
          history_with_counts: k.scrappingHistory.map(run => ({
            startTime: run.startTime,
            endTime: run.endTime,
            ads_count: 0,
            error: err.message
          }))
        }));
      }
    })();

    platformPromises.push(platformPromise);
  }

  await Promise.all(platformPromises);
  return results;
}

module.exports = {
  fetchAdsCountByPlatform,
  fetchAdsCountBatchByPlatform,
  queryKeywordScrapingHistory,
  buildKeywordTrendsQuery,
  parseKeywordTrendsResults,
  buildAllSearchesQuery,
  fetchAdsCountForKeywordsByPlatform,
  fetchAdsCountForMultipleKeywordsFast,
  PLATFORM_INDEX_MAP,
  PLATFORM_FIELD_MAPPINGS,
};

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
  if (!elastic || !platforms || platforms.length === 0) {
    logger?.info?.('[fetchAdsCountByPlatform] Early return: elastic=' + !!elastic + ', platforms=' + (platforms ? platforms.length : 0));
    return 0;
  }

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
          size: 0,
          query: baseQuery
        }
      };

      logger?.info?.('[fetchAdsCountByPlatform] Query for platform:', { platform, index: indexName, searchType, searchValue });

      const esResult = await platformElastic.search(esQuery);
      const hits = esResult.hits || esResult.body?.hits;
      const count = typeof hits.total === 'object' ? hits.total.value : hits.total;
      totalCount += (count || 0);
   
      logger?.info?.('[fetchAdsCountByPlatform] Results:', { platform, count: count || 0 });
    } catch (err) {
      logger?.warn?.('[fetchAdsCountByPlatform] Failed for platform:', platform, 'Error:', err.message);
    }
  }

  return totalCount;
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
  if (keyword && keyword !== '') filters.push({ match: { 'search.keyword': { query: keyword, operator: 'and' } } });
  if (advertiser && advertiser !== '') filters.push({ match: { 'search.advertiser': { query: advertiser, operator: 'and' } } });
  if (domain && domain !== '') filters.push({ match: { 'search.domain': { query: domain, operator: 'and' } } });

  // Activity type filter
  if (activity_type && activity_type !== '') {
    if (activity_type === 'keyword') {
      filters.push({ exists: { field: 'search.keyword' } });
    } else if (activity_type === 'advertiser') {
      filters.push({ exists: { field: 'search.advertiser' } });
    } else if (activity_type === 'domain') {
      filters.push({ exists: { field: 'search.domain' } });
    } else if (activity_type === 'filters') {
      filters.push({ bool: { should: [
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
    } else if (activity_type === 'other_activity') {
      filters.push({ bool: { should: [
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
    } else if (activity_type === 'sorting_filters') {
      filters.push({ bool: { should: [
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


module.exports = {
  fetchAdsCountByPlatform,
  queryKeywordScrapingHistory,
  buildKeywordTrendsQuery,
  parseKeywordTrendsResults,
  buildAllSearchesQuery,
  PLATFORM_INDEX_MAP,
  PLATFORM_FIELD_MAPPINGS,
};

'use strict';

// Cache: { value, expiresAt }
const _cache = new Map();

function setCache(key, value, ttlMs) {
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function getCache(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.value;
}

function getAggs(result) {
  return result.aggregations ?? result.body?.aggregations ?? {};
}

function getTotal(result) {
  const hits = result.hits ?? result.body?.hits ?? {};
  const t = hits.total;
  return typeof t === 'object' ? (t.value ?? 0) : (t ?? 0);
}

// Fetch all user emails and cache for 1 hour
async function getAllUserEmails(elastic) {
  const CACHE_KEY = 'all_user_emails';
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour

  const cached = getCache(CACHE_KEY);
  if (cached) return cached;

  const INVALID_EMAILS = new Set(['na', 'n/a', 'null', 'undefined', 'unknown', '-', '']);

  try {
    const result = await elastic.search({
      index: 'user_activities',
      body: {
        size: 0,
        query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
        aggs: {
          per_user: {
            terms: { field: 'user.id', size: 10000 },
            aggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
          },
        },
      },
    });

    const emailMap = {};
    for (const b of (getAggs(result)?.per_user?.buckets ?? [])) {
      const src = b.email_hit?.hits?.hits?.[0]?._source ?? {};
      const email = src['user.email'] ?? src?.user?.email ?? null;
      if (email && !INVALID_EMAILS.has(String(email).trim().toLowerCase())) {
        emailMap[String(b.key)] = email;
      }
    }

    setCache(CACHE_KEY, emailMap, CACHE_TTL);
    return emailMap;
  } catch (err) {

    return {};
  }
}

// Normalize timestamps: YouTube and LinkedIn store as Unix seconds, others as string "YYYY-MM-DD HH:MM:SS"
function normalizeTimestampForQuery(input) {
  if (typeof input === 'number') {
    // Unix timestamp in seconds (YouTube, LinkedIn) -> convert to ISO string
    const ms = input < 100000000000 ? input * 1000 : input; // Handle both seconds and milliseconds
    return new Date(ms).toISOString();
  }
  // Already a string format
  return input;
}

// Convert to string format for Elasticsearch range query
// Format: "YYYY-MM-DD HH:MM:SS"
function formatTimestampString(input) {
  try {
    const normalized = normalizeTimestampForQuery(input);
    return String(normalized).replace(/"/g, '').slice(0, 19).replace('T', ' ');
  } catch (e) {
  
    return null;
  }
}

// Convert string timestamp to Unix seconds for LinkedIn and YouTube
function convertToUnixSeconds(timestampStr) {
  if (typeof timestampStr === 'number') return timestampStr;
  // Convert "YYYY-MM-DD HH:MM:SS" to Unix timestamp in seconds
  return Math.floor(new Date(timestampStr.replace(' ', 'T') + 'Z').getTime() / 1000);
}

// Platform-specific timestamp field mapping
const TIMESTAMP_FIELD_MAP = {
  facebook: 'facebook_ad.last_seen',
  instagram: 'instagram_ad.last_seen',
  google: 'google_ad.last_seen',
  gdn: 'gdn_ad.last_seen',
  youtube: 'last_seen',
  linkedin: 'linkedin_ad.last_seen',
  reddit: 'reddit_ad.last_seen',
  pinterest: 'pinterest_ad.last_seen',
  quora: 'quora_ad.last_seen',
  native: 'native_ad.last_seen',
  tiktok: 'last_seen',
};

// Get timestamp field for platform
function getTimestampField(platformName) {
  return TIMESTAMP_FIELD_MAP[platformName.toLowerCase()] || 'post_date';
}

// Get platform networks list for fallback
const ELASTIC_FALLBACK_NETWORKS = ['facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'pinterest', 'quora', 'native', 'gdn', 'google', 'tiktok'];

function getFallbackNetworks() {
  return ELASTIC_FALLBACK_NETWORKS;
}

// Build comprehensive activity filter for getAllSearches
function buildActivityTypeFilter(activity_type) {
  if (!activity_type || activity_type === '') return null;

  if (activity_type === 'keyword') {
    return { exists: { field: 'search.keyword' } };
  } else if (activity_type === 'advertiser') {
    return { exists: { field: 'search.advertiser' } };
  } else if (activity_type === 'domain') {
    return { exists: { field: 'search.domain' } };
  } else if (activity_type === 'filters') {
    return { bool: { should: [
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
    ], minimum_should_match: 1 } };
  } else if (activity_type === 'other_activity') {
    return { bool: { should: [
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
    ], minimum_should_match: 1 } };
  } else if (activity_type === 'sorting_filters') {
    return { bool: { should: [
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
    ], minimum_should_match: 1 } };
  }
  return null;
}

// Base activity filter for getAllSearches (covers all activity types)
const BASE_ACTIVITY_FILTER = { bool: { should: [
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
], minimum_should_match: 1 } };

// Filter label mappings for getAllSearches
const FILTER_LABEL_MAP = {
  'filter.countries': 'Country',
  'filter.languages': 'Language',
  'filter.call_to_actions': 'CTA',
  'filter.ad_positions': 'Ad Position',
  'filter.ad_subPositions': 'Ad Sub-Position',
  'filter.gender': 'Gender',
  'filter.ad_type': 'Ad Type',
  'filter.ad_categories': 'Category',
  'filter.ad_subCategories': 'Sub-Category',
  'filter.status': 'Status',
  'filter.sort_by': 'Sort By',
  'filter.platform': 'Platform',
  'filter.image_size': 'Image Size',
  'filter.network': 'Network',
  'filter.native_network': 'Native Network',
  'filter.ctr': 'CTR',
  'filter.budget': 'Budget',
};

const DASHBOARD_SORT_MAP = {
  'dashboard.newest_sort': 'Sort: Newest',
  'dashboard.running_longest_sort': 'Sort: Running Longest',
  'dashboard.last_seen_sort': 'Sort: Last Seen',
  'dashboard.domain_sort': 'Sort: Domain',
  'dashboard.likes_sort': 'Sort: Likes',
  'dashboard.comments_sort': 'Sort: Comments',
  'dashboard.shares_sort': 'Sort: Shares',
  'dashboard.popularity_sort': 'Sort: Popularity',
  'dashboard.impressions_sort': 'Sort: Impressions',
  'dashboard.views_sort': 'Sort: Views',
  'dashboard.verified': 'Verified',
  'dashboard.meta_ads_library': 'Meta Ads Library',
  'dashboard.likes': 'Likes',
  'dashboard.comments': 'Comments',
  'dashboard.shares': 'Shares',
};

const RANGE_PAIRS = [
  { label: 'Likes', range: 'dashboard.likes_range', sort: 'dashboard.likes_sort' },
  { label: 'Comments', range: 'dashboard.comments_range', sort: 'dashboard.comments_sort' },
  { label: 'Shares', range: 'dashboard.shares_range', sort: 'dashboard.shares_sort' },
  { label: 'Popularity', range: 'dashboard.popularity_range', sort: 'dashboard.popularity_sort' },
  { label: 'Impressions', range: 'dashboard.impressions_range', sort: 'dashboard.impressions_sort' },
  { label: 'Views', range: 'dashboard.views_range', sort: 'dashboard.views_sort' },
  { label: 'Ad Budget', range: 'dashboard.adBudget', sort: null },
  { label: 'Ad Seen', range: 'dashboard.ad_seen', sort: null },
  { label: 'Post Date', range: 'dashboard.post_date', sort: null },
];

const SEARCH_BY_LABEL_MAP = {
  'search_by.text': 'Search By: Text',
  'search_by.celebrities': 'Search By: Celebrity',
  'search_by.objects': 'Search By: Object',
  'search_by.brands': 'Search By: Brand',
};

const LANDER_LABEL_MAP = {
  'lander.affiliates': 'Affiliate Network',
  'lander.ecommerce': 'Ecommerce Platform',
  'lander.funnels': 'Funnel Type',
  'lander.sources': 'Traffic Source',
  'lander.marketing': 'Lander: Marketing',
};

const SORT_BY_LABEL_MAP = {
  'sort_by.likes': { label: 'Sort: Likes', rangeKey: 'dashboard.likes_range' },
  'sort_by.comments': { label: 'Sort: Comments', rangeKey: 'dashboard.comments_range' },
  'sort_by.views': { label: 'Sort: Views', rangeKey: 'dashboard.views_range' },
};

const ARRAY_JOIN_KEYS = new Set([
  'Country', 'Language', 'CTA', 'Ad Position', 'Ad Sub-Position',
  'Category', 'Sub-Category', 'Platform', 'Network', 'Image Size',
  'Affiliate Network', 'Ecommerce Platform', 'Funnel Type', 'Traffic Source', 'Lander: Marketing',
  'Native Network', 'Budget',
]);

const DATE_RANGE_KEYS = new Set(['Ad Seen', 'Post Date']);

function detectOtherActivity(s) {
  const gf = (key) => {
    if (s[key] !== undefined) return s[key];
    const parts = key.split('.');
    let c = s;
    for (const p of parts) {
      if (c == null || typeof c !== 'object') return undefined;
      c = c[p];
    }
    return c;
  };

  if (gf('favourite_ad_id')) return `Favourite Ad #${gf('favourite_ad_id')}`;
  if (gf('unfavourite_ad_id')) return `Unfavourite Ad #${gf('unfavourite_ad_id')}`;
  if (gf('download.ad_id')) return `Download Ad #${gf('download.ad_id')}`;
  if (gf('hide_ad_id')) return `Hide Ad #${gf('hide_ad_id')}`;
  if (gf('unhide_ad_id')) return `Unhide Ad #${gf('unhide_ad_id')}`;
  if (gf('hide_advertiser_id')) return `Hide Advertiser #${gf('hide_advertiser_id')}`;
  if (gf('unhide_advertiser_id')) return `Unhide Advertiser #${gf('unhide_advertiser_id')}`;
  if (gf('copy.ad_id')) return `Copy Landing Page #${gf('copy.ad_id')}`;
  if (gf('show_analytics.ad_id')) return `Analytics Modal #${gf('show_analytics.ad_id')}`;
  if (gf('dashboard.show_original')) return gf('dashboard.show_original') === 'true' ? 'Show Original: Checked' : 'Show Original: Unchecked';
  if (gf('dashboard.exportsAds')) return 'Export Ads';
  if (gf('dashboard.favourite')) return 'Favourite Dashboard';
  if (gf('dashboard.hidden')) return 'Hidden Dashboard';
  if (gf('user.language')) return `Language Translation: ${gf('user.language_name') ?? gf('user.language')}`;
  if (gf('share.guest_page_url')) return 'Share Guest Page';
  if (gf('vieworiginal.ad_id')) return `View Original Ad #${gf('vieworiginal.ad_id')}`;
  return null;
}

function parseFilterPills(s, other_activity) {
  const filterPills = [];
  if (other_activity) return filterPills;

  const usedSortKeys = new Set();

  const addPills = (labelMap) => {
    for (const [key, label] of Object.entries(labelMap)) {
      const val = s[key];
      if (!val || val === 'NA') continue;
      const vals = Array.isArray(val)
        ? val.filter(v => v && v !== 'NA')
        : [val].filter(v => v && v !== 'NA');
      if (vals.length === 0) continue;
      if (vals.length > 1 && ARRAY_JOIN_KEYS.has(label)) {
        const first = vals.slice(0, 2).join(', ');
        const rest = vals.slice(2).join(', ');
        filterPills.push(rest ? `${label}: ${first}\n${rest}` : `${label}: ${first}`);
      } else {
        for (const v of vals) filterPills.push(`${label}: ${v}`);
      }
    }
  };

  for (const { label, range, sort } of RANGE_PAIRS) {
    const val = s[range];
    if (val && val !== 'NA') {
      const arr = Array.isArray(val) ? val : [val];
      if (arr.length >= 2) {
        filterPills.push(DATE_RANGE_KEYS.has(label)
          ? `${label}: ${arr[0]}\nto ${arr[1]}`
          : `${label}: ${arr[0]} to ${arr[1]}`);
      } else if (arr.length === 1) {
        filterPills.push(`${label}: ${arr[0]}`);
      }
      if (sort) usedSortKeys.add(sort);
    }
  }

  for (const [key, label] of Object.entries(DASHBOARD_SORT_MAP)) {
    if (usedSortKeys.has(key)) continue;
    const val = s[key];
    if (!val || val === 'NA') continue;
    filterPills.push(`${label}`);
  }

  const lowerAge = s['filter.lower_age'] ?? s?.filter?.lower_age ?? null;
  const upperAge = s['filter.upper_age'] ?? s?.filter?.upper_age ?? null;
  if (lowerAge && upperAge) filterPills.push(`Age: ${lowerAge} to ${upperAge}`);
  else if (lowerAge) filterPills.push(`Age From: ${lowerAge}`);
  else if (upperAge) filterPills.push(`Age To: ${upperAge}`);

  addPills(FILTER_LABEL_MAP);
  addPills(SEARCH_BY_LABEL_MAP);
  addPills(LANDER_LABEL_MAP);

  for (const [key, { label, rangeKey }] of Object.entries(SORT_BY_LABEL_MAP)) {
    if (s[rangeKey] && s[rangeKey] !== 'NA') continue;
    const val = s[key];
    if (!val || val === 'NA') continue;
    filterPills.push(`${label}: ${val}`);
  }

  return filterPills;
}

// Resolve time window from params or defaults
// Returns { fromTs, toTs } as Unix seconds
function resolveTimeWindow(queryParams) {
  const DAY_S = 24 * 60 * 60;
  const { from_date, to_date, from_time, to_time, tz_offset_minutes, date_range = 'Last 90 days' } = queryParams;
  let toTs, fromTs;

  if (from_date && to_date) {
    const fromTimeStr = from_time || '00:00:00';
    const toTimeStr = to_time || '23:59:59';
    const fromDate = new Date(from_date + 'T' + fromTimeStr + 'Z');
    const toDate = new Date(to_date + 'T' + toTimeStr + 'Z');

    if (tz_offset_minutes !== undefined && tz_offset_minutes !== null) {
      const tzOffsetSeconds = Number(tz_offset_minutes) * 60;
      fromTs = Math.floor(fromDate.getTime() / 1000) + tzOffsetSeconds;
      toTs = Math.floor(toDate.getTime() / 1000) + tzOffsetSeconds;
    } else {
      fromTs = Math.floor(fromDate.getTime() / 1000);
      toTs = Math.floor(toDate.getTime() / 1000);
    }
  } else {
    const now = new Date();
    toTs = Math.floor(now.getTime() / 1000);

    if (date_range === 'Today') {
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      fromTs = Math.floor(startOfDay.getTime() / 1000);
    } else if (date_range === 'Last 7 days') {
      fromTs = toTs - 7 * DAY_S;
    } else if (date_range === 'Last 30 days') {
      fromTs = toTs - 30 * DAY_S;
    } else {
      fromTs = toTs - 90 * DAY_S;
    }
  }

  return { fromTs, toTs };
}

// Resolve email patterns and domain patterns to user IDs
// Patterns can be:
//   - Exact email: "user@example.com"
//   - Domain suffix: ".com", "gmail.com", ".in"
// Returns array of matched user IDs
async function resolveUserIds(patterns, elastic) {
  if (!patterns || patterns.length === 0) return [];
  const ids = new Set();

  await Promise.all(patterns.map(async (pat) => {
    const p = pat.trim().toLowerCase();
    if (!p) return;

    const isDomain = p.startsWith('.') || (!p.includes('@') && p.includes('.'));

    if (isDomain) {
      const suffix = (p.startsWith('.') ? p : `.${p}`).toLowerCase();
      const lookupBody = {
        size: 0,
        query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
        aggs: {
          per_user: {
            terms: { field: 'user.id', size: 5000 },
            aggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
          },
        },
      };

      try {
        const res = await elastic.search({ index: 'user_activities', body: lookupBody });
        for (const b of (getAggs(res)?.per_user?.buckets ?? [])) {
          const src = b.email_hit?.hits?.hits?.[0]?._source ?? {};
          const email = (src['user.email'] ?? src?.user?.email ?? '').toLowerCase();
          if (email.endsWith(suffix)) ids.add(b.key);
        }
      } catch (err) {

      }
    } else {
      const lookupBody = {
        size: 1,
        query: { bool: { filter: [{ exists: { field: 'user.email' } }],
                         must: [{ match_phrase: { 'user.email': p } }] } },
        _source: ['user.id'],
      };

      try {
        const res = await elastic.search({ index: 'user_activities', body: lookupBody });
        const hit = (res?.hits?.hits ?? res?.body?.hits?.hits ?? [])[0];
        const uid = hit?._source?.['user.id'] ?? hit?._source?.user?.id ?? null;
        if (uid != null) { ids.add(uid); ids.add(String(uid)); }
      } catch (err) {

      }
    }
  }));

  return [...ids];
}

module.exports = {
  setCache,
  getCache,
  getAggs,
  getTotal,
  getAllUserEmails,
  normalizeTimestampForQuery,
  formatTimestampString,
  convertToUnixSeconds,
  getTimestampField,
  TIMESTAMP_FIELD_MAP,
  getFallbackNetworks,
  buildActivityTypeFilter,
  BASE_ACTIVITY_FILTER,
  detectOtherActivity,
  parseFilterPills,
  resolveTimeWindow,
  resolveUserIds,
  FILTER_LABEL_MAP,
  DASHBOARD_SORT_MAP,
  RANGE_PAIRS,
  SEARCH_BY_LABEL_MAP,
  LANDER_LABEL_MAP,
  SORT_BY_LABEL_MAP,
  ARRAY_JOIN_KEYS,
  DATE_RANGE_KEYS,
};

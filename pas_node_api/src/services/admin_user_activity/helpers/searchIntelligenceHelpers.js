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

// Page through every bucket of a terms-style aggregation on `field` via the
// composite aggregation. Composite aggs page with after_key instead of a
// fixed result cap, so this loops until every distinct value has been read —
// no result is ever dropped no matter how many distinct users exist.
//
// `pageSize` is a per-request batch size, not a cap: it just controls how
// many buckets come back per round trip before the next `after_key` page is
// fetched. Composite aggregations default to 10 per page when unset, which
// would turn one query into dozens of sequential round trips for any field
// with more than a handful of distinct values — so this always sets it
// explicitly, matching the composite-agg pattern used elsewhere in this repo
// (e.g. google/jobs/refreshKeywordStats.js). 1000 keeps the common case
// (a few hundred distinct users) down to a single request, while still
// paging correctly if that count ever grows past it.
async function fetchAllTermsBuckets(elastic, { index = 'user_activities', query, field, subAggs, pageSize = 1000 } = {}) {
  const out = [];
  let afterKey;

  do {
    const result = await elastic.search({
      index,
      body: {
        size: 0,
        query,
        aggs: {
          paged: {
            composite: {
              size: pageSize,
              sources: [{ key: { terms: { field } } }],
              ...(afterKey ? { after: afterKey } : {}),
            },
            ...(subAggs ? { aggs: subAggs } : {}),
          },
        },
      },
    });

    const agg = getAggs(result)?.paged;
    const page = agg?.buckets ?? [];
    for (const b of page) out.push({ ...b, key: b.key.key });

    afterKey = page.length === pageSize ? agg?.after_key : undefined;
  } while (afterKey);

  return out;
}

// Fetch all user emails and cache for 1 hour
async function getAllUserEmails(elastic) {
  const CACHE_KEY = 'all_user_emails';
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour

  const cached = getCache(CACHE_KEY);
  if (cached) return cached;

  const INVALID_EMAILS = new Set(['na', 'n/a', 'null', 'undefined', 'unknown', '-', '']);

  try {
    const buckets = await fetchAllTermsBuckets(elastic, {
      query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
      field: 'user.id',
      subAggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
    });

    const emailMap = {};
    for (const b of buckets) {
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
  google: 'last_seen',
  gdn: 'gdn_ad.last_seen',
  youtube: 'last_seen',
  linkedin: 'last_seen',
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

// Field(s) that identify each activity_type. Single-field types resolve to a
// plain `exists` filter; multi-field types are OR'd together via `should`.
const ACTIVITY_TYPE_FIELDS = {
  keyword:    ['search.keyword'],
  advertiser: ['search.advertiser'],
  domain:     ['search.domain'],
  filters: [
    'filter.country', 'filter.countries', 'filter.gender', 'filter.ad_type',
    'filter.ad_categories', 'filter.ad_subCategories', 'filter.status',
    'filter.sort_by', 'filter.platform', 'filter.native_network',
    'filter.ctr', 'filter.budget',
  ],
  other_activity: [
    'dashboard.exportsAds', 'favourite_ad_id', 'unfavourite_ad_id',
    'download.ad_id', 'hide_ad_id', 'unhide_ad_id', 'hide_advertiser_id',
    'unhide_advertiser_id', 'dashboard.show_original', 'user.language_name',
    'vieworiginal.ad_id',
  ],
  sorting_filters: [
    'dashboard.newest_sort', 'dashboard.running_longest_sort',
    'dashboard.last_seen_sort', 'dashboard.domain_sort',
    'dashboard.likes_sort', 'dashboard.comments_sort',
    'dashboard.shares_sort', 'dashboard.popularity_sort',
    'dashboard.impressions_sort', 'dashboard.views_sort',
  ],
};

// Build comprehensive activity filter for getAllSearches
function buildActivityTypeFilter(activity_type) {
  const fields = ACTIVITY_TYPE_FIELDS[activity_type];
  if (!fields) return null;

  if (fields.length === 1) return { exists: { field: fields[0] } };
  return {
    bool: {
      should: fields.map((field) => ({ exists: { field } })),
      minimum_should_match: 1,
    },
  };
}

// Fields that make up the "any activity" filter but aren't part of any
// single activity_type group above.
const OTHER_BASE_ACTIVITY_FIELDS = [
  'dashboard.verified', 'dashboard.meta_ads_library', 'dashboard.ad_seen',
  'dashboard.likes', 'dashboard.comments', 'dashboard.shares',
  'lander.affiliates', 'lander.ecommerce', 'lander.funnels',
  'lander.sources', 'lander.marketing',
  'filterType', 'copy.ad_id', 'show_analytics.ad_id',
  'dashboard.favourite', 'dashboard.hidden',
  'user.language', 'share.guest_page_url',
];

// Base activity filter for getAllSearches (covers all activity types).
// Reuses the same field groups as buildActivityTypeFilter instead of
// re-listing them, plus the fields only relevant here.
// Note: other_activity's 'user.language_name' is intentionally excluded —
// this filter has always used 'user.language' instead (see above).
const BASE_ACTIVITY_FILTER_FIELDS = [
  ...ACTIVITY_TYPE_FIELDS.keyword,
  ...ACTIVITY_TYPE_FIELDS.advertiser,
  ...ACTIVITY_TYPE_FIELDS.domain,
  ...ACTIVITY_TYPE_FIELDS.sorting_filters,
  ...ACTIVITY_TYPE_FIELDS.filters,
  ...ACTIVITY_TYPE_FIELDS.other_activity.filter((f) => f !== 'user.language_name'),
  ...OTHER_BASE_ACTIVITY_FIELDS,
];

const BASE_ACTIVITY_FILTER = {
  bool: {
    should: BASE_ACTIVITY_FILTER_FIELDS.map((field) => ({ exists: { field } })),
    minimum_should_match: 1,
  },
};

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

// Parse page/size query params into a clamped { pageNum, pageSize } pair.
// pageNum >= 0; pageSize clamped to [1, 100]. Same defaults and clamp used by
// every paginated admin-panel endpoint.
function parsePagination({ page = 0, size = 10 } = {}) {
  const pageNum  = Math.max(0, Number(page));
  const pageSize = Math.min(100, Math.max(1, Number(size)));
  return { pageNum, pageSize };
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

      try {
        const emailMap = await getAllUserEmails(elastic);
        for (const [uid, email] of Object.entries(emailMap)) {
          if (String(email).toLowerCase().endsWith(suffix)) ids.add(uid);
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
  fetchAllTermsBuckets,
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
  parsePagination,
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

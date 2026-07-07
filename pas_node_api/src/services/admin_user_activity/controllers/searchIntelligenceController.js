'use strict';

const databaseManager = require('../../../database/DatabaseManager');
const {
  resolveUserIds: helperResolveUserIds,
  getAggs,
  getTotal,
  getAllUserEmails,
  resolveTimeWindow,
  getCache,
  setCache,
} = require('../helpers/searchIntelligenceHelpers');
const { buildAllSearchesQuery, fetchAdsCountByPlatform, queryKeywordScrapingHistory } = require('../queries/searchIntelligenceQueries');

async function getIntelligenceStats(req, elastic, logger) {
  try {
    if (!elastic) {
      return { code: 500, message: 'Elasticsearch client not available' };
    }

    const { from_date, to_date, prev_from_date, prev_to_date } = req.query;

    const DAY_S = 24 * 60 * 60;

    let toTs, fromTs, prevToTs, prevFromTs;

    // Current period
    if (to_date && from_date) {
      toTs   = Math.floor(new Date(to_date).getTime()   / 1000);
      fromTs = Math.floor(new Date(from_date).getTime() / 1000);
    } else {
      // Use latest doc's dateTime — server clock is unreliable (set to 2026)
      // Anchor on latest doc that has search.keyword — avoids 2026-clock docs (LoggedIn etc.)
      const latestDocResult = await elastic.search({
        index: 'user_activities',
        body: {
          size: 1,
          query: { bool: { filter: [{ exists: { field: 'search.keyword' } }] } },
          sort: [{ dateTime: { order: 'desc' } }],
          _source: ['dateTime'],
        },
      });
      const hitsArr = (
        latestDocResult?.hits?.hits ??
        latestDocResult?.body?.hits?.hits ??
        []
      );
      const latestDocTs = hitsArr.length > 0 ? Number(hitsArr[0]?._source?.dateTime) : null;
      const LAST_KNOWN_GOOD_TS = 1748563200; // 2025-05-30 fallback
      toTs   = (latestDocTs && latestDocTs > 0 && latestDocTs < 2000000000) ? latestDocTs : LAST_KNOWN_GOOD_TS;
      fromTs = toTs - 7 * DAY_S;
    }

    // Previous period
    if (prev_to_date && prev_from_date) {
      prevToTs   = Math.floor(new Date(prev_to_date).getTime()   / 1000);
      prevFromTs = Math.floor(new Date(prev_from_date).getTime() / 1000);
    } else {
      // Default: same duration as current, shifted back by one window
      prevToTs   = fromTs - 1;
      prevFromTs = prevToTs - (toTs - fromTs);
    }

    const cacheKey = `intelligence_stats_${fromTs}_${toTs}_${prevFromTs}_${prevToTs}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    // High-volume flags always use real current time (not anchored on latest doc)
    const nowTs = Math.floor(Date.now() / 1000);

    const baseFilter    = (f, t) => [{ range: { dateTime: { gte: f, lte: t } } }];
    const searchFilter  = (f, t) => [
      { range: { dateTime: { gte: f, lte: t } } },
      { bool: { should: [
        { exists: { field: 'search.keyword'    } },
        { exists: { field: 'search.advertiser' } },
        { exists: { field: 'search.domain'     } },
      ], minimum_should_match: 1 } },
    ];

    const currentPeriodQuery = {
      index: 'user_activities',
      body: {
        size: 0,
        query: { bool: { filter: baseFilter(fromTs, toTs) } },
        aggs: {
          active_users: { cardinality: { field: 'user.id' } },
          unique_kw:   { cardinality: { field: 'search.keyword.keyword'    } },
          unique_adv:  { cardinality: { field: 'search.advertiser.keyword' } },
          unique_dom:  { cardinality: { field: 'search.domain.keyword'     } },
        },
      },
    };

    const previousPeriodQuery = {
      index: 'user_activities',
      body: {
        size: 0,
        query: { bool: { filter: baseFilter(prevFromTs, prevToTs) } },
        aggs: {
          active_users: { cardinality: { field: 'user.id' } },
          unique_kw:   { cardinality: { field: 'search.keyword.keyword'    } },
          unique_adv:  { cardinality: { field: 'search.advertiser.keyword' } },
          unique_dom:  { cardinality: { field: 'search.domain.keyword'     } },
        },
      },
    };

    const highVolumeFlagsQuery = {
      index: 'user_activities',
      body: {
        size: 0,
        query: { bool: { filter: baseFilter(nowTs - DAY_S, nowTs) } },
        aggs: {
          per_user: { terms: { field: 'user.id', size: 10000 } },
        },
      },
    };

    const [currResult, prevResult, flagResult] = await Promise.all([
      elastic.search(currentPeriodQuery),
      elastic.search(previousPeriodQuery),
      elastic.search(highVolumeFlagsQuery),
    ]);

    const currAggs = getAggs(currResult);
    const prevAggs = getAggs(prevResult);
    const flagAggs = getAggs(flagResult);

    // total_searches = total docs in window (hits.total)
    const totalSearches  = getTotal(currResult);
    const activeUsers    = currAggs.active_users?.value ?? 0;
    const uniqueKeywords = (currAggs.unique_kw?.value ?? 0)
                         + (currAggs.unique_adv?.value ?? 0)
                         + (currAggs.unique_dom?.value ?? 0);

    const prevTotalSearches  = getTotal(prevResult);
    const prevActiveUsers    = prevAggs.active_users?.value ?? 0;
    const prevUniqueKeywords = (prevAggs.unique_kw?.value ?? 0)
                             + (prevAggs.unique_adv?.value ?? 0)
                             + (prevAggs.unique_dom?.value ?? 0);

    const perUserBuckets  = flagAggs.per_user?.buckets ?? [];
    const highVolumeFlags = perUserBuckets.filter((b) => b.doc_count > 500).length;

    function trendPct(curr, prev) {
      if (!prev) return null;
      return Math.round(((curr - prev) / prev) * 100);
    }

    function trendLabel(curr, prev, fromDate, toDate) {
      const f = new Date(fromDate * 1000);
      const t = new Date(toDate   * 1000);
      const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `vs ${fmt(f)} – ${fmt(t)}`;
    }

    const result = {
      code: 200,
      data: {
        total_searches: {
          value:       totalSearches,
          prev_value:  prevTotalSearches,
          trend_pct:   trendPct(totalSearches,  prevTotalSearches),
          trend_label: trendLabel(totalSearches, prevTotalSearches, prevFromTs, prevToTs),
        },
        active_users: {
          value:       activeUsers,
          prev_value:  prevActiveUsers,
          trend_pct:   trendPct(activeUsers,    prevActiveUsers),
          trend_label: trendLabel(activeUsers,   prevActiveUsers,   prevFromTs, prevToTs),
        },
        high_volume_flags: {
          value:     highVolumeFlags,
          sub_label: 'users with >500 searches in last 24h',
          threshold: 500,
        },
        unique_keywords: {
          value:       uniqueKeywords,
          prev_value:  prevUniqueKeywords,
          trend_pct:   trendPct(uniqueKeywords, prevUniqueKeywords),
          trend_label: trendLabel(uniqueKeywords, prevUniqueKeywords, prevFromTs, prevToTs),
        },
      },
      meta: {
        window:        'Last 7 days',
        from_date:     new Date(fromTs     * 1000).toISOString(),
        to_date:       new Date(toTs       * 1000).toISOString(),
        prev_from_date:new Date(prevFromTs * 1000).toISOString(),
        prev_to_date:  new Date(prevToTs   * 1000).toISOString(),
      },
    };

    setCache(cacheKey, result, 5 * 60 * 1000);
    return result;

  } catch (err) {
    logger?.error?.('[searchIntelligenceController] getIntelligenceStats error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// ─── GET /intelligence/top-users ─────────────────────────────────────────────
// Returns top users ranked by search count in the given window.
// Query params: from_date, to_date (optional, default last 7 days anchored on latest doc)
// Response per user: user_id, search_count, top_keyword, top_advertiser, top_domain, top_filter, anomaly_flag
// ─────────────────────────────────────────────────────────────────────────────

async function getTopUsers(req, elastic, logger) {
  try {
    if (!elastic) return { code: 500, message: 'Elasticsearch client not available' };

    const { from_date, to_date, size = 20, flagged_only } = req.query;
    const DAY_S = 24 * 60 * 60;

    let toTs, fromTs;
    if (to_date && from_date) {
      toTs   = Math.floor(new Date(to_date).getTime()   / 1000);
      fromTs = Math.floor(new Date(from_date).getTime() / 1000);
    } else {
      const latestDocResult = await elastic.search({
        index: 'user_activities',
        body: { size: 1, sort: [{ dateTime: { order: 'desc' } }], _source: ['dateTime'] },
      });
      const hitsArr = latestDocResult?.hits?.hits ?? latestDocResult?.body?.hits?.hits ?? [];
      const latestDocTs = hitsArr.length > 0 ? Number(hitsArr[0]?._source?.dateTime) : null;
      const LAST_KNOWN_GOOD_TS = 1748563200;
      toTs   = (latestDocTs && latestDocTs < 2000000000) ? latestDocTs : LAST_KNOWN_GOOD_TS;
      fromTs = toTs - 7 * DAY_S;
    }

    const FLAG_THRESHOLD = 500;
    const BUCKET_SIZE    = 500; // fetch enough users for max/2 calculation────────────────────────────────────────────────────────────────────

    // Step 1 — fetch all users + doc counts for the window (all doc types)
    // Step 2 — fetch emails from LoggedIn docs in parallel
    const allUsersBody = {
      size: 0,
      query: { bool: { filter: [{ range: { dateTime: { gte: fromTs, lte: toTs } } }] } },
      aggs: {
        per_user: {
          terms: { field: 'user.id', size: BUCKET_SIZE, order: { _count: 'desc' } },
          aggs: {
            top_keyword:      { terms: { field: 'search.keyword.keyword',              size: 1 } },
            top_advertiser:   { terms: { field: 'search.advertiser.keyword',           size: 1 } },
            top_domain:       { terms: { field: 'search.domain.keyword',               size: 1 } },
            top_platform:     { terms: { field: 'network.keyword',                     size: 1 } },
            top_country:      { terms: { field: 'filter.country.keyword',              size: 1 } },
            top_countries:    { terms: { field: 'filter.countries.keyword',            size: 3 } },
            top_adtype:       { terms: { field: 'filter.ad_type.keyword',              size: 1 } },
            top_gender:       { terms: { field: 'filter.gender.keyword',               size: 1 } },
            top_status:       { terms: { field: 'filter.status.keyword',               size: 1 } },
            top_sort_by:      { terms: { field: 'filter.sort_by.keyword',              size: 1 } },
            top_category:     { terms: { field: 'filter.ad_categories.keyword',        size: 2 } },
            top_subcategory:  { terms: { field: 'filter.ad_subCategories.keyword',     size: 2 } },
            top_language:     { terms: { field: 'filter.languages.keyword',            size: 1 } },
            top_cta:          { terms: { field: 'filter.call_to_actions.keyword',      size: 1 } },
          },
        },
      },
    };

    const emailUsersBody = {
      size: 0,
      query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
      aggs: {
        per_user: {
          terms: { field: 'user.id', size: BUCKET_SIZE },
          aggs: {
            email_hit: { top_hits: { size: 1, _source: ['user.email', 'user.username'] } },
          },
        },
      },
    };

    const [allUsersResult, emailResult] = await Promise.all([
      elastic.search({
        index: 'user_activities',
        body: allUsersBody,
      }),
      elastic.search({
        index: 'user_activities',
        body: emailUsersBody,
      }),
    ]);

    // Build email map
    const emailAggs = getAggs(emailResult);
    const emailMap  = {};
    for (const b of (emailAggs.per_user?.buckets ?? [])) {
      const src   = b.email_hit?.hits?.hits?.[0]?._source ?? {};
      const email = src['user.email'] ?? src?.user?.email ?? null;
      if (email) emailMap[String(b.key)] = email;
    }

    const allBuckets = getAggs(allUsersResult)?.per_user?.buckets ?? [];

    // Step 3 — compute min threshold from max using magnitude/bucket rule:
    // max<100: min = floor(max/10)
    // max>=100: magnitude = 10^(digits-1), bucket = floor(max/magnitude)
    //   bucket===1, digits<=3 → min = magnitude/10       (100-199 → 10)
    //   bucket===1, digits>=4 → min = magnitude*0.9      (1000-1999 → 900)
    //   bucket>1              → min = (bucket-1)*magnitude (200→100, 2000→1000, 650→500)
    const maxCount = allBuckets.length > 0 ? allBuckets[0].doc_count : 0;
    let minCount = 0;
    if (maxCount > 0) {
      if (maxCount < 100) {
        minCount = Math.floor(maxCount / 10);
      } else {
        const digits    = Math.floor(Math.log10(maxCount)) + 1;
        const magnitude = Math.pow(10, digits - 1);
        const bucket    = Math.floor(maxCount / magnitude);
        if (bucket === 1) {
          minCount = digits <= 3 ? magnitude / 10 : magnitude - magnitude / 10;
        } else {
          minCount = (bucket - 1) * magnitude;
        }
      }
    }

    // Step 4 — keep only users at or above the threshold
    let topBuckets = allBuckets.filter((b) => b.doc_count >= minCount);

    // Step 5 — apply flagged_only filter if requested
    if (flagged_only === 'true') {
      topBuckets = topBuckets.filter((b) => b.doc_count > FLAG_THRESHOLD);
    }

    // Step 6 — build user objects
    let users = topBuckets.slice(0, Number(size)).map((b) => {
      const docCount      = b.doc_count;
      const topKeyword    = b.top_keyword?.buckets?.[0]?.key    ?? null;
      const topAdvertiser = b.top_advertiser?.buckets?.[0]?.key ?? null;
      const topDomain     = b.top_domain?.buckets?.[0]?.key     ?? null;
      const topPlatform   = b.top_platform?.buckets?.[0]?.key   ?? null;
      const topCountry     = b.top_country?.buckets?.[0]?.key     ?? null;
      const topCountries   = (b.top_countries?.buckets ?? []).map(x => x.key).filter(Boolean);
      const topAdtype      = b.top_adtype?.buckets?.[0]?.key      ?? null;
      const topGender      = b.top_gender?.buckets?.[0]?.key      ?? null;
      const topStatus      = b.top_status?.buckets?.[0]?.key      ?? null;
      const topSortBy      = b.top_sort_by?.buckets?.[0]?.key     ?? null;
      const topCategories  = (b.top_category?.buckets ?? []).map(x => x.key).filter(Boolean);
      const topSubcats     = (b.top_subcategory?.buckets ?? []).map(x => x.key).filter(Boolean);
      const topLanguage    = b.top_language?.buckets?.[0]?.key    ?? null;
      const topCta         = b.top_cta?.buckets?.[0]?.key         ?? null;
      const email          = emailMap[String(b.key)] ?? null;
      const anomalyFlag    = docCount > FLAG_THRESHOLD;

      // Build top_filter pills from all filter fields (same style as all-searches)
      const filterParts = [];
      const countryVal = topCountries.length > 0 ? topCountries : (topCountry ? [topCountry] : []);
      if (countryVal.length)      filterParts.push(`Country: ${countryVal.join(', ')}`);
      if (topAdtype)              filterParts.push(`Ad Type: ${topAdtype}`);
      if (topGender)              filterParts.push(`Gender: ${topGender}`);
      if (topStatus)              filterParts.push(`Status: ${topStatus}`);
      if (topSortBy)              filterParts.push(`Sort By: ${topSortBy}`);
      if (topCategories.length)   filterParts.push(`Category: ${topCategories.join(', ')}`);
      if (topSubcats.length)      filterParts.push(`Sub-Category: ${topSubcats.join(', ')}`);
      if (topLanguage)            filterParts.push(`Language: ${topLanguage}`);
      if (topCta)                 filterParts.push(`CTA: ${topCta}`);
      const topFilter = filterParts.length > 0 ? filterParts : null;

      return {
        user_id:        b.key,
        email,
        doc_count:      docCount,
        top_keyword:    topKeyword,
        top_advertiser: topAdvertiser,
        top_domain:     topDomain,
        top_platform:   topPlatform,
        top_filter:     topFilter,
        anomaly_flag:   anomalyFlag,
        ...(anomalyFlag ? { flag_reason: `${docCount} docs in window — exceeds threshold of ${FLAG_THRESHOLD}` } : {}),
      };
    });

    return {
      code: 200,
      data: { users, total: users.length, flag_threshold: FLAG_THRESHOLD },
      meta: {
        from_date:  new Date(fromTs * 1000).toISOString(),
        to_date:    new Date(toTs   * 1000).toISOString(),
        max_count:  maxCount,
        min_threshold: minCount,
      },
    };

  } catch (err) {
    logger?.error?.('[searchIntelligenceController] getTopUsers error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// ─── GET /intelligence/other-activities ──────────────────────────────────────
// Paginated list of non-search, non-project activity docs (last 90 days).
// Covers: favourite/unfavourite ad, download, hide/unhide ad/advertiser,
//         copy landing page, analytics modal, show_original, export ads,
//         favourite/hidden dashboard, language translation, guest page.
// ─────────────────────────────────────────────────────────────────────────────

async function getOtherActivities(req, elastic, logger) {
  try {
    if (!elastic) return { code: 500, message: 'Elasticsearch client not available' };

    const DAY_S = 24 * 60 * 60;
    const { date_range = 'Last 90 days', from_date, to_date, user, page = 0, size = 10 } = req.query;

    const pageNum  = Math.max(0, Number(page));
    const pageSize = Math.min(100, Math.max(1, Number(size)));

    let toTs, fromTs;
    if (from_date && to_date) {
      toTs   = Math.floor(new Date(to_date).getTime()   / 1000);
      fromTs = Math.floor(new Date(from_date).getTime() / 1000);
    } else {
      const now = new Date();
      toTs = Math.floor(now.getTime() / 1000);
      if      (date_range === 'Today')        { const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); fromTs = Math.floor(s.getTime() / 1000); }
      else if (date_range === 'Last 7 days')  fromTs = toTs - 7  * DAY_S;
      else if (date_range === 'Last 30 days') fromTs = toTs - 30 * DAY_S;
      else                                    fromTs = toTs - 90 * DAY_S;
    }

    const activityFields = [
      'favourite_ad_id', 'unfavourite_ad_id',
      'download.ad_id',
      'hide_ad_id', 'unhide_ad_id',
      'hide_advertiser_id', 'unhide_advertiser_id',
      'copy.ad_id',
      'show_analytics.ad_id',
      'dashboard.show_original',
      'dashboard.exportsAds',
      'dashboard.favourite',
      'dashboard.hidden',
      'user.language',
      'share.guest_page_url',
    ];

    const filters = [
      { range: { dateTime: { gte: fromTs, lte: toTs } } },
      { bool: { should: activityFields.map(f => ({ exists: { field: f } })), minimum_should_match: 1 } },
    ];

    // User filter — resolve email → user_id
    if (user && user.trim() !== '') {
      const uf = user.trim().toLowerCase();
      const userLookup = await elastic.search({
        index: 'user_activities',
        body: {
          size: 0,
          query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
          aggs: { per_user: { terms: { field: 'user.id', size: 2000 }, aggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } } } },
        },
      });
      const matchedIds = [];
      for (const b of (getAggs(userLookup)?.per_user?.buckets ?? [])) {
        const src = b.email_hit?.hits?.hits?.[0]?._source ?? {};
        const em  = src['user.email'] ?? src?.user?.email ?? '';
        if (em.toLowerCase().includes(uf)) matchedIds.push(String(b.key));
      }
      if (matchedIds.length === 0) {
        const fromLabel = new Date(fromTs * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const toLabel   = new Date(toTs   * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        return { code: 200, data: { rows: [], total: 0, page: pageNum, page_size: pageSize, total_pages: 0 }, meta: { from_date: new Date(fromTs*1000).toISOString(), to_date: new Date(toTs*1000).toISOString(), date_label: `${fromLabel} → ${toLabel}` } };
      }
      filters.push({ terms: { 'user.id': matchedIds } });
    }

    const [result, emailResult] = await Promise.all([
      elastic.search({
        index: 'user_activities',
        body: {
          size: pageSize,
          from: pageNum * pageSize,
          query: { bool: { filter: filters } },
          sort: [{ dateTime: { order: 'desc' } }, { _id: { order: 'desc' } }],
          _source: true,
        },
      }),
      elastic.search({
        index: 'user_activities',
        body: {
          size: 0,
          query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
          aggs: { per_user: { terms: { field: 'user.id', size: 1000 }, aggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } } } },
        },
      }),
    ]);

    const emailMap = {};
    for (const b of (getAggs(emailResult)?.per_user?.buckets ?? [])) {
      const src = b.email_hit?.hits?.hits?.[0]?._source ?? {};
      const em  = src['user.email'] ?? src?.user?.email ?? null;
      if (em) emailMap[String(b.key)] = em;
    }

    const hitsArr = result?.hits?.hits ?? result?.body?.hits?.hits ?? [];
    const total   = (() => { const t = (result?.hits ?? result?.body?.hits ?? {}).total; return typeof t === 'object' ? (t.value ?? 0) : (t ?? 0); })();

    const getF = (src, key) => {
      if (src[key] !== undefined) return src[key];
      const parts = key.split('.');
      let cur = src;
      for (const p of parts) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[p]; }
      return cur;
    };

    const rows = hitsArr.map((h) => {
      const s     = h._source ?? {};
      const uid   = s['user.id']    ?? s?.user?.id    ?? null;
      const email = s['user.email'] ?? s?.user?.email ?? emailMap[String(uid)] ?? null;
      const dtSec = s['dateTime'] ? Number(s['dateTime']) : null;
      const timestamp = dtSec
        ? new Date(dtSec * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
        : null;
      const network = s['network'] ?? null;

      // Detect activity type + ad_id
      let activity_type = 'Other';
      let ad_id = null;
      let extra = null;

      if      (getF(s, 'favourite_ad_id'))       { activity_type = 'Favourite Ad';        ad_id = getF(s, 'favourite_ad_id'); }
      else if (getF(s, 'unfavourite_ad_id'))      { activity_type = 'Unfavourite Ad';      ad_id = getF(s, 'unfavourite_ad_id'); }
      else if (getF(s, 'download.ad_id'))         { activity_type = 'Download Ad';         ad_id = getF(s, 'download.ad_id'); }
      else if (getF(s, 'hide_ad_id'))             { activity_type = 'Hide Ad';             ad_id = getF(s, 'hide_ad_id'); }
      else if (getF(s, 'unhide_ad_id'))           { activity_type = 'Unhide Ad';           ad_id = getF(s, 'unhide_ad_id'); }
      else if (getF(s, 'hide_advertiser_id'))     { activity_type = 'Hide Advertiser';     ad_id = getF(s, 'hide_advertiser_id'); }
      else if (getF(s, 'unhide_advertiser_id'))   { activity_type = 'Unhide Advertiser';   ad_id = getF(s, 'unhide_advertiser_id'); }
      else if (getF(s, 'copy.ad_id'))             { activity_type = 'Copy Landing Page';   ad_id = getF(s, 'copy.ad_id');   extra = getF(s, 'copy.landing_page_url') ?? null; }
      else if (getF(s, 'show_analytics.ad_id'))   { activity_type = 'Analytics Modal';     ad_id = getF(s, 'show_analytics.ad_id'); }
      else if (getF(s, 'dashboard.show_original')) { const v = getF(s, 'dashboard.show_original'); activity_type = v === 'true' ? 'Show Original ON' : 'Show Original OFF'; }
      else if (getF(s, 'dashboard.exportsAds'))   { activity_type = 'Export Ads'; }
      else if (getF(s, 'dashboard.favourite'))    { activity_type = 'Favourite Dashboard'; }
      else if (getF(s, 'dashboard.hidden'))       { activity_type = 'Hidden Dashboard'; }
      else if (getF(s, 'user.language'))          { activity_type = 'Language Translation'; extra = `${getF(s,'user.language_name') ?? ''} (${getF(s,'user.language') ?? ''})`; }
      else if (getF(s, 'share.guest_page_url'))   { activity_type = 'Guest Page';          extra = getF(s, 'share.guest_page_url'); }

      return { _id: h._id, timestamp, user_id: uid, email, network, activity_type, ad_id: ad_id ? String(ad_id) : null, extra };
    });

    const fromLabel = new Date(fromTs * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const toLabel   = new Date(toTs   * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    return {
      code: 200,
      data: { rows, total, page: pageNum, page_size: pageSize, total_pages: Math.ceil(total / pageSize) },
      meta: { from_date: new Date(fromTs*1000).toISOString(), to_date: new Date(toTs*1000).toISOString(), date_label: `${fromLabel} → ${toLabel}` },
    };

  } catch (err) {
    logger?.error?.('[searchIntelligenceController] getOtherActivities error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// GET /api/v1/admin_user_activity/purge-old-activities
// Deletes all user_activities docs older than 90 days (based on dateTime field).
// Optional query param: dry_run=true → counts docs to be deleted without deleting.
async function purgeOldActivities(req, elastic, logger) {
  try {
    if (!elastic) {
      return { code: 500, message: 'Elasticsearch client not available' };
    }

    const DAY_S    = 24 * 60 * 60;
    const DAYS     = 90;
    const nowTs    = Math.floor(Date.now() / 1000);
    const cutoffTs = nowTs - DAYS * DAY_S;
    const dryRun   = req.query.dry_run === 'true';

    const rangeQuery = {
      range: {
        dateTime: { lt: cutoffTs },
      },
    };

    if (dryRun) {
      // Count only — no deletion
      const countResult = await elastic.count({
        index: 'user_activities',
        body: { query: rangeQuery },
      });
      const count = countResult?.count ?? countResult?.body?.count ?? 0;
      return {
        code: 200,
        dry_run: true,
        message: `${count} document(s) would be deleted (older than ${DAYS} days).`,
        data: {
          cutoff_timestamp: cutoffTs,
          cutoff_date: new Date(cutoffTs * 1000).toISOString(),
          docs_to_delete: count,
        },
      };
    }

    // Start deletion in background (non-blocking)
    // Return immediately with a message that deletion has started
    const deleteInBackground = async () => {
      let deleted = 0;
      let failures = 0;

      try {
        // Try ES 7.x+ API first
        if (typeof elastic.deleteByQuery === 'function') {
          const deleteResult = await elastic.deleteByQuery({
            index: 'user_activities',
            body: { query: rangeQuery },
            conflicts: 'proceed',
            refresh: true,
          });
          deleted = deleteResult?.deleted ?? deleteResult?.body?.deleted ?? 0;
          failures = (deleteResult?.failures ?? deleteResult?.body?.failures ?? []).length;
        } else {
          // Fallback for ES 6.x: Use direct delete operation in batches
          let from = 0;
          const batchSize = 1000;
          let continueDeleting = true;

          while (continueDeleting) {
            // Search for matching documents
            const searchResult = await elastic.search({
              index: 'user_activities',
              body: {
                query: rangeQuery,
                size: batchSize,
                from: from,
                sort: [{ dateTime: 'asc' }]
              },
            });

            const hits = searchResult.hits?.hits || searchResult.body?.hits?.hits || [];
            if (hits.length === 0) {
              continueDeleting = false;
              break;
            }

            // Build bulk delete request with _type for ES 6.x compatibility
            const bulkBody = [];
            for (const hit of hits) {
              bulkBody.push({
                delete: {
                  _index: 'user_activities',
                  _type: hit._type || '_doc',
                  _id: hit._id
                }
              });
            }

            // Execute bulk delete
            if (bulkBody.length > 0) {
              const bulkResult = await elastic.bulk({ body: bulkBody });
              deleted += hits.length;
              if (bulkResult.errors || (bulkResult.body && bulkResult.body.errors)) {
                const items = bulkResult.items || bulkResult.body?.items || [];
                failures += items.filter(item => item.delete?.error).length;
              }
            }

            // If we got fewer docs than batch size, we're done
            if (hits.length < batchSize) {
              continueDeleting = false;
            }
          }

          // Refresh index
          try {
            await elastic.indices.refresh({ index: 'user_activities' });
          } catch (refreshErr) {
            logger?.warn?.('Index refresh failed:', refreshErr.message);
          }
        }

        logger?.info?.(`[purgeOldActivities] Background deletion completed: ${deleted} docs deleted, ${failures} failures`);
      } catch (deleteErr) {
        logger?.error?.('[purgeOldActivities] Background deletion failed:', deleteErr.message);
      }
    };

    // Start the background deletion without waiting
    deleteInBackground().catch(err => {
      logger?.error?.('[purgeOldActivities] Uncaught error in background deletion:', err.message);
    });

    // Return immediately
    return {
      code: 202,
      message: `Deletion started in background. Will delete ${cutoffTs} documents older than ${DAYS} days.`,
      data: {
        status: 'DELETING',
        cutoff_timestamp: cutoffTs,
        cutoff_date: new Date(cutoffTs * 1000).toISOString(),
        message: 'Check server logs or query the index later to verify completion',
      },
    };
  } catch (err) {
    logger?.error?.('[searchIntelligenceController] purgeOldActivities error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}


// Helper: Platform-specific field mappings for keyword/advertiser/domain searches

async function getKeywordScrapingHistory(req, elastic, logger, mongo) {
  try {
    const { keyword, advertiser, domain, type } = req.query;
    logger?.info?.('[getKeywordScrapingHistory] Query:', { keyword, advertiser, domain, type });
  

    if (!keyword && !advertiser && !domain) {
      return { code: 400, message: 'At least one of keyword, advertiser, or domain is required' };
    }

    // Determine search type and value
    let searchType = parseInt(type) || null;
    let searchValue = keyword || advertiser || domain;

    if (!searchType) {
      if (keyword) searchType = 1;
      else if (advertiser) searchType = 2;
      else if (domain) searchType = 3;
    }


   
    // Fetch from MongoDB using query helper
    const matchedEntry = await queryKeywordScrapingHistory(mongo, searchType, searchValue);
   

    if (!matchedEntry) {
      logger?.warn?.('[getKeywordScrapingHistory] No matching entry found for', { keyword, advertiser, domain, type });
      return { code: 404, message: 'No scraping history found for this keyword/advertiser/domain', data: { history: [] } };
    }

    // Convert scrapping_status to history format
    let history = (matchedEntry.scrapping_status || []).map(run => {
      const startTime = run.startTime?.$date || run.startTime;
      const endTime = run.endTime?.$date || run.endTime;
      return {
        date: run.date,
        status: run.status,
        startTime: startTime,
        endTime: endTime,
        network: run.network,
        owner: run.owner,
        mode: run.mode,
      };
    });



    // Fetch ads count from Elasticsearch for each date and platform
    const platforms = matchedEntry.networks || matchedEntry.platform || matchedEntry.scrapping_status?.map(s => s.network).filter(Boolean) || [];
    const uniquePlatforms = [...new Set(platforms)];


    if (elastic && uniquePlatforms.length > 0) {
      for (let i = 0; i < history.length; i++) {
        const run = history[i];
        try {

          // Use only the current run's platform(s) for this query
          const runPlatforms = run.network ? [run.network] : uniquePlatforms;

          let startTimeLocalMs = run.startTime;
          let endtime = run.endTime
            ? new Date(run.endTime).toISOString()
            : new Date().toISOString().split('T')[0] + 'T23:59:59.000Z';
          const adsCount = await fetchAdsCountByPlatform(elastic, runPlatforms, null, searchValue, searchType, logger, startTimeLocalMs, endtime);

 
          run.adsCount = adsCount;

          logger?.info?.('[getKeywordScrapingHistory] Fetched ads count for', { startTime: run.startTime, endTime: run.endTime || 'now', adsCount, searchValue, searchType });
        } catch (err) {
          
          logger?.warn?.('[getKeywordScrapingHistory] Failed to fetch ads count for time range:', run.startTime, '-', run.endTime, err.message);
        }
      }
    } else {
      logger?.warn?.('[getKeywordScrapingHistory] Skipping ads count fetch. Elastic:', !!elastic, 'Platforms:', uniquePlatforms.length);
    }

    // Get the first searched date from the MongoDB document
    const rawSearchedDate = matchedEntry.searchDates?.[0]?.$date || matchedEntry.searchDates?.[0] || matchedEntry.createdAt?.$date || matchedEntry.createdAt || null;
    const searchedDate = rawSearchedDate ? new Date(rawSearchedDate).toLocaleDateString() : null;

   

    const response = {
      code: 200,
      message: 'Scraping history fetched successfully',
      data: {
        keyword: searchType === 1 ? searchValue : null,
        advertiser: searchType === 2 ? searchValue : null,
        domain: searchType === 3 ? searchValue : null,
        platform: uniquePlatforms,
        searchedDate,
        history,
      },
    };


    return response;
  } catch (err) {
    logger?.error?.('[searchIntelligenceController] getKeywordScrapingHistory error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}


module.exports = { getIntelligenceStats, getTopUsers, getOtherActivities, purgeOldActivities, getKeywordScrapingHistory };

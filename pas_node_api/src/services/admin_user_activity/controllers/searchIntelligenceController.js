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

async function getIntelligenceStats(req, elastic, logger) {
  try {
    if (!elastic) {
      return { code: 500, message: 'Elasticsearch client not available' };
    }

    const { from_date, to_date } = req.query;

    const DAY_S = 24 * 60 * 60;

    let toTs, fromTs;

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

    const cacheKey = `intelligence_stats_${fromTs}_${toTs}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    // Previous window — same 7-day duration, shifted back by one window
    const prevToTs   = fromTs - 1;
    const prevFromTs = prevToTs - 7 * DAY_S;

    const baseFilter    = (f, t) => [{ range: { dateTime: { gte: f, lte: t } } }];
    const searchFilter  = (f, t) => [
      { range: { dateTime: { gte: f, lte: t } } },
      { bool: { should: [
        { exists: { field: 'search.keyword'    } },
        { exists: { field: 'search.advertiser' } },
        { exists: { field: 'search.domain'     } },
      ], minimum_should_match: 1 } },
    ];

    const [currResult, prevResult, flagResult] = await Promise.all([

      // Current 7-day window
      elastic.search({
        index: 'user_activities',
        body: {
          size: 0,
          query: { bool: { filter: baseFilter(fromTs, toTs) } },
          aggs: {
            // Total docs = total searches (all activity)
            active_users: { cardinality: { field: 'user.id' } },
            // Unique keywords from search.keyword + search.advertiser + search.domain
            unique_kw:   { cardinality: { field: 'search.keyword.keyword'    } },
            unique_adv:  { cardinality: { field: 'search.advertiser.keyword' } },
            unique_dom:  { cardinality: { field: 'search.domain.keyword'     } },
          },
        },
      }),

      // Previous 7-day window — same shape
      elastic.search({
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
      }),

      // High-volume flags — users with > 500 docs in last 24h (any activity)
      elastic.search({
        index: 'user_activities',
        body: {
          size: 0,
          query: { bool: { filter: baseFilter(toTs - DAY_S, toTs) } },
          aggs: {
            per_user: { terms: { field: 'user.id', size: 10000 } },
          },
        },
      }),
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
    const BUCKET_SIZE    = 500; // fetch enough users for max/2 calculation

    // Step 1 — fetch all users + doc counts for the window (all doc types)
    // Step 2 — fetch emails from LoggedIn docs in parallel
    const [allUsersResult, emailResult] = await Promise.all([
      elastic.search({
        index: 'user_activities',
        body: {
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
        },
      }),
      elastic.search({
        index: 'user_activities',
        body: {
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
        },
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

// ─── GET /intelligence/all-searches ──────────────────────────────────────────
// Paginated list of all user activity docs (last 90 days max), sorted by dateTime desc.
// Query params:
//   date_range   : "Last 90 days" | "Last 30 days" | "Last 7 days" | "Today" (default: Last 90 days)
//   from_date    : ISO date string (overrides date_range)
//   to_date      : ISO date string (overrides date_range)
//   user         : email substring filter
//   keyword      : search.keyword substring
//   advertiser   : search.advertiser substring
//   domain       : search.domain substring
//   platform     : network exact match (e.g. facebook)
//   ad_type      : filter.ad_type exact match
//   country      : filter.country exact match
//   page         : 0-based page number (default 0)
//   size         : page size (default 10, max 100)
// ─────────────────────────────────────────────────────────────────────────────

async function getAllSearches(req, elastic, logger) {
  try {
    if (!elastic) return { code: 500, message: 'Elasticsearch client not available' };

    const DAY_S = 24 * 60 * 60;

    const {
      date_range = 'Last 90 days',
      from_date, to_date,
      user, keyword, advertiser, domain,
      platform, ad_type, country,
      page = 0, size = 10,
    } = req.query;

    const pageNum  = Math.max(0, Number(page));
    const pageSize = Math.min(100, Math.max(1, Number(size)));

    // Resolve time window
    let toTs, fromTs;
    if (from_date && to_date) {
      toTs   = Math.floor(new Date(to_date).getTime()   / 1000);
      fromTs = Math.floor(new Date(from_date).getTime() / 1000);
    } else {
      const now = new Date();
      toTs = Math.floor(now.getTime() / 1000); // real current time (server clock)

      if (date_range === 'Today') {
        // Start of today in UTC (midnight)
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        fromTs = Math.floor(startOfDay.getTime() / 1000);
      } else if (date_range === 'Last 7 days') {
        fromTs = toTs - 7  * DAY_S;
      } else if (date_range === 'Last 30 days') {
        fromTs = toTs - 30 * DAY_S;
      } else {
        fromTs = toTs - 90 * DAY_S;
      }
    }

    // Build ES filter clauses
    const filters = [
      { range: { dateTime: { gte: fromTs, lte: toTs } } },
      // Keep docs with search.*, dashboard.* or filter.* — exclude bare LoggedIn docs
      { bool: { should: [
        { exists: { field: 'search.keyword'          } },
        { exists: { field: 'search.advertiser'       } },
        { exists: { field: 'search.domain'           } },
        { exists: { field: 'dashboard.newest_sort'          } },
        { exists: { field: 'dashboard.running_longest_sort' } },
        { exists: { field: 'dashboard.last_seen_sort'       } },
        { exists: { field: 'dashboard.domain_sort'          } },
        { exists: { field: 'dashboard.likes_sort'           } },
        { exists: { field: 'dashboard.comments_sort'        } },
        { exists: { field: 'dashboard.shares_sort'          } },
        { exists: { field: 'dashboard.popularity_sort'      } },
        { exists: { field: 'dashboard.impressions_sort'     } },
        { exists: { field: 'dashboard.views_sort'           } },
        { exists: { field: 'dashboard.verified'             } },
        { exists: { field: 'dashboard.meta_ads_library'     } },
        { exists: { field: 'dashboard.ad_seen'       } },
        { exists: { field: 'dashboard.likes'         } },
        { exists: { field: 'dashboard.comments'      } },
        { exists: { field: 'dashboard.shares'        } },
        { exists: { field: 'lander.affiliates'        } },
        { exists: { field: 'lander.ecommerce'         } },
        { exists: { field: 'lander.funnels'           } },
        { exists: { field: 'lander.sources'           } },
        { exists: { field: 'lander.marketing'         } },
        { exists: { field: 'filter.country'          } },
        { exists: { field: 'filter.countries'        } },
        { exists: { field: 'filter.gender'           } },
        { exists: { field: 'filter.ad_type'          } },
        { exists: { field: 'filter.ad_categories'    } },
        { exists: { field: 'filter.ad_subCategories' } },
        { exists: { field: 'filter.status'           } },
        { exists: { field: 'filter.sort_by'          } },
        { exists: { field: 'filter.platform'         } },
        { exists: { field: 'filterType'              } },
        // Other activities
        { exists: { field: 'favourite_ad_id'         } },
        { exists: { field: 'unfavourite_ad_id'       } },
        { exists: { field: 'download.ad_id'          } },
        { exists: { field: 'hide_ad_id'              } },
        { exists: { field: 'unhide_ad_id'            } },
        { exists: { field: 'hide_advertiser_id'      } },
        { exists: { field: 'unhide_advertiser_id'    } },
        { exists: { field: 'copy.ad_id'              } },
        { exists: { field: 'show_analytics.ad_id'   } },
        { exists: { field: 'dashboard.show_original' } },
        { exists: { field: 'dashboard.exportsAds'    } },
        { exists: { field: 'dashboard.favourite'     } },
        { exists: { field: 'dashboard.hidden'        } },
        { exists: { field: 'user.language'           } },
        { exists: { field: 'share.guest_page_url'    } },
        { exists: { field: 'vieworiginal.ad_id'      } },
        { exists: { field: 'filter.native_network'   } },
        { exists: { field: 'filter.ctr'              } },
        { exists: { field: 'filter.budget'           } },
      ], minimum_should_match: 1 } },
    ];

    if (platform && platform !== 'Any')   filters.push({ term:  { 'network.keyword':           platform.toLowerCase() } });
    if (ad_type  && ad_type  !== 'Any')   filters.push({ term:  { 'filter.ad_type.keyword':     ad_type  } });
    if (country  && country  !== '')      filters.push({ term: { 'user.current_country.keyword': country } });
    if (keyword    && keyword    !== '')  filters.push({ match: { 'search.keyword':    { query: keyword,    operator: 'and' } } });
    if (advertiser && advertiser !== '')  filters.push({ match: { 'search.advertiser': { query: advertiser, operator: 'and' } } });
    if (domain     && domain     !== '')  filters.push({ match: { 'search.domain':     { query: domain,     operator: 'and' } } });

    // User filter — resolve email → user_id then filter in ES (proper pagination)
    if (user && user.trim() !== '') {
      const uf = user.trim().toLowerCase();
      const userLookup = await elastic.search({
        index: 'user_activities',
        body: {
          size: 0,
          query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
          aggs: {
            per_user: {
              terms: { field: 'user.id', size: 2000 },
              aggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
            },
          },
        },
      });
      const matchedIds = [];
      for (const b of (getAggs(userLookup)?.per_user?.buckets ?? [])) {
        const src   = b.email_hit?.hits?.hits?.[0]?._source ?? {};
        const email = src['user.email'] ?? src?.user?.email ?? '';
        if (email.toLowerCase().includes(uf)) matchedIds.push(String(b.key));
      }
      if (matchedIds.length === 0) {
        const now2 = new Date(fromTs * 1000);
        const fromLabel2 = now2.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const toLabel2   = new Date(toTs * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        return {
          code: 200,
          data: { rows: [], total: 0, page: pageNum, page_size: pageSize, total_pages: 0 },
          meta: { from_date: new Date(fromTs * 1000).toISOString(), to_date: new Date(toTs * 1000).toISOString(), date_label: `${fromLabel2} → ${toLabel2}` },
        };
      }
      filters.push({ terms: { 'user.id': matchedIds } });
    }

    const body = {
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

    const [result, emailResult] = await Promise.all([
      elastic.search({ index: 'user_activities', body }),
      // Fetch emails from LoggedIn docs — email not present in filter_only/search docs
      elastic.search({
        index: 'user_activities',
        body: {
          size: 0,
          query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
          aggs: {
            per_user: {
              terms: { field: 'user.id', size: 1000 },
              aggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
            },
          },
        },
      }),
    ]);

    // Build email map: user_id -> email
    const emailMap = {};
    for (const b of (getAggs(emailResult)?.per_user?.buckets ?? [])) {
      const src   = b.email_hit?.hits?.hits?.[0]?._source ?? {};
      const email = src['user.email'] ?? src?.user?.email ?? null;
      if (email) emailMap[String(b.key)] = email;
    }

    const hitsArr = result?.hits?.hits ?? result?.body?.hits?.hits ?? [];
    const total   = (() => {
      const t = (result?.hits ?? result?.body?.hits ?? {}).total;
      return typeof t === 'object' ? (t.value ?? 0) : (t ?? 0);
    })();

    let rows = hitsArr.map((h) => {
      const s       = h._source ?? {};
      const uid     = s['user.id']  ?? s?.user?.id  ?? null;
      const email   = s['user.email'] ?? s?.user?.email ?? emailMap[String(uid)] ?? null;
      const kw      = s['search.keyword']    ?? s?.search?.keyword    ?? null;
      const adv     = s['search.advertiser'] ?? s?.search?.advertiser ?? null;
      const dom     = s['search.domain']     ?? s?.search?.domain     ?? null;
      const network = s['network'] ?? null;
      const dtSec   = s['dateTime'] ? Number(s['dateTime']) : null;
      const dateStr = dtSec
        ? new Date(dtSec * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
        : (s['date'] ?? null);

      // Human-readable labels for all stored fields
      const FILTER_LABEL_MAP = {
        'filter.countries':        'Country',
        'filter.languages':        'Language',
        'filter.call_to_actions':  'CTA',
        'filter.ad_positions':     'Ad Position',
        'filter.ad_subPositions':  'Ad Sub-Position',
        'filter.gender':           'Gender',
        'filter.ad_type':          'Ad Type',
        'filter.ad_categories':    'Category',
        'filter.ad_subCategories': 'Sub-Category',
        'filter.status':           'Status',
        'filter.sort_by':          'Sort By',
        'filter.platform':         'Platform',
        'filter.image_size':       'Image Size',
        'filter.network':          'Network',
        'filter.native_network':   'Native Network',
        'filter.ctr':              'CTR',
        'filter.budget':           'Budget',
      };

      // Sort-only dashboard fields (single value)
      // NOTE: dashboard.favourite, dashboard.hidden, dashboard.exportsAds, dashboard.show_original
      // are other-activity signals, NOT filter pills — keep them out of this map.
      const DASHBOARD_SORT_MAP = {
        'dashboard.newest_sort':          'Sort: Newest',
        'dashboard.running_longest_sort': 'Sort: Running Longest',
        'dashboard.last_seen_sort':       'Sort: Last Seen',
        'dashboard.domain_sort':          'Sort: Domain',
        'dashboard.likes_sort':           'Sort: Likes',
        'dashboard.comments_sort':        'Sort: Comments',
        'dashboard.shares_sort':          'Sort: Shares',
        'dashboard.popularity_sort':      'Sort: Popularity',
        'dashboard.impressions_sort':     'Sort: Impressions',
        'dashboard.views_sort':           'Sort: Views',
        'dashboard.verified':             'Verified',
        'dashboard.meta_ads_library':     'Meta Ads Library',
        'dashboard.likes':                'Likes',
        'dashboard.comments':             'Comments',
        'dashboard.shares':               'Shares',
      };

      // Range pairs: [min, max] → "Label: min to max"
      const RANGE_PAIRS = [
        { label: 'Likes',       range: 'dashboard.likes_range',       sort: 'dashboard.likes_sort'       },
        { label: 'Comments',    range: 'dashboard.comments_range',    sort: 'dashboard.comments_sort'    },
        { label: 'Shares',      range: 'dashboard.shares_range',      sort: 'dashboard.shares_sort'      },
        { label: 'Popularity',  range: 'dashboard.popularity_range',  sort: 'dashboard.popularity_sort'  },
        { label: 'Impressions', range: 'dashboard.impressions_range', sort: 'dashboard.impressions_sort' },
        { label: 'Views',       range: 'dashboard.views_range',       sort: 'dashboard.views_sort'       },
        { label: 'Ad Budget',   range: 'dashboard.adBudget',          sort: null                         },
        { label: 'Ad Seen',     range: 'dashboard.ad_seen',           sort: null                         },
        { label: 'Post Date',   range: 'dashboard.post_date',         sort: null                         },
      ];

      const SEARCH_BY_LABEL_MAP = {
        'search_by.text':        'Search By: Text',
        'search_by.celebrities': 'Search By: Celebrity',
        'search_by.objects':     'Search By: Object',
        'search_by.brands':      'Search By: Brand',
      };

      const LANDER_LABEL_MAP = {
        'lander.affiliates': 'Affiliate Network',
        'lander.ecommerce':  'Ecommerce Platform',
        'lander.funnels':    'Funnel Type',
        'lander.sources':    'Traffic Source',
        'lander.marketing':  'Lander: Marketing',
      };

      // sort_by.* only used when no corresponding range pill was already added
      const SORT_BY_LABEL_MAP = {
        'sort_by.likes':    { label: 'Sort: Likes',    rangeKey: 'dashboard.likes_range'    },
        'sort_by.comments': { label: 'Sort: Comments', rangeKey: 'dashboard.comments_range' },
        'sort_by.views':    { label: 'Sort: Views',    rangeKey: 'dashboard.views_range'    },
      };

      const FILTER_TYPE_LABELS = {
        'filter_only':       'Filter Only',
        'search_only':       'Search Only',
        'search_and_filter': 'Search + Filter',
      };

      // Detect other activity type FIRST — these docs have no meaningful filter pills
      const gf = (key) => { if (s[key] !== undefined) return s[key]; const parts = key.split('.'); let c = s; for (const p of parts) { if (c == null || typeof c !== 'object') return undefined; c = c[p]; } return c; };
      let other_activity = null;
      if      (gf('favourite_ad_id'))         other_activity = `Favourite Ad #${gf('favourite_ad_id')}`;
      else if (gf('unfavourite_ad_id'))       other_activity = `Unfavourite Ad #${gf('unfavourite_ad_id')}`;
      else if (gf('download.ad_id'))          other_activity = `Download Ad #${gf('download.ad_id')}`;
      else if (gf('hide_ad_id'))              other_activity = `Hide Ad #${gf('hide_ad_id')}`;
      else if (gf('unhide_ad_id'))            other_activity = `Unhide Ad #${gf('unhide_ad_id')}`;
      else if (gf('hide_advertiser_id'))      other_activity = `Hide Advertiser #${gf('hide_advertiser_id')}`;
      else if (gf('unhide_advertiser_id'))    other_activity = `Unhide Advertiser #${gf('unhide_advertiser_id')}`;
      else if (gf('copy.ad_id'))              other_activity = `Copy Landing Page #${gf('copy.ad_id')}`;
      else if (gf('show_analytics.ad_id'))    other_activity = `Analytics Modal #${gf('show_analytics.ad_id')}`;
      else if (gf('dashboard.show_original')) other_activity = gf('dashboard.show_original') === 'true' ? 'Show Original: Checked' : 'Show Original: Unchecked';
      else if (gf('dashboard.exportsAds'))    other_activity = 'Export Ads';
      else if (gf('dashboard.favourite'))     other_activity = 'Favourite Dashboard';
      else if (gf('dashboard.hidden'))        other_activity = 'Hidden Dashboard';
      else if (gf('user.language'))           other_activity = `Language Translation: ${gf('user.language_name') ?? gf('user.language')}`;
      else if (gf('share.guest_page_url'))    other_activity = 'Share Guest Page';
      else if (gf('vieworiginal.ad_id'))      other_activity = `View Original Ad #${gf('vieworiginal.ad_id')}`;

      // Build filters_applied pills — skip entirely for other-activity docs
      const filterPills = [];

      if (!other_activity) {
        const usedSortKeys = new Set();

        const ARRAY_JOIN_KEYS = new Set([
          'Country', 'Language', 'CTA', 'Ad Position', 'Ad Sub-Position',
          'Category', 'Sub-Category', 'Platform', 'Network', 'Image Size',
          'Affiliate Network', 'Ecommerce Platform', 'Funnel Type', 'Traffic Source', 'Lander: Marketing',
          'Native Network', 'Budget',
        ]);

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
              const rest  = vals.slice(2).join(', ');
              filterPills.push(rest ? `${label}: ${first}\n${rest}` : `${label}: ${first}`);
            } else {
              for (const v of vals) filterPills.push(`${label}: ${v}`);
            }
          }
        };

        const DATE_RANGE_KEYS = new Set(['Ad Seen', 'Post Date']);

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

        // Age range — combine lower_age + upper_age into one pill
        const lowerAge = s['filter.lower_age'] ?? s?.filter?.lower_age ?? null;
        const upperAge = s['filter.upper_age'] ?? s?.filter?.upper_age ?? null;
        if (lowerAge && upperAge) filterPills.push(`Age: ${lowerAge} to ${upperAge}`);
        else if (lowerAge)        filterPills.push(`Age From: ${lowerAge}`);
        else if (upperAge)        filterPills.push(`Age To: ${upperAge}`);

        addPills(FILTER_LABEL_MAP);
        addPills(SEARCH_BY_LABEL_MAP);
        addPills(LANDER_LABEL_MAP);
        // sort_by.* — skip if the corresponding range was already shown
        for (const [key, { label, rangeKey }] of Object.entries(SORT_BY_LABEL_MAP)) {
          if (s[rangeKey] && s[rangeKey] !== 'NA') continue; // range pill already added
          const val = s[key];
          if (!val || val === 'NA') continue;
          filterPills.push(`${label}: ${val}`);
        }

      }

      // Country: user's current country (not the filter.country they searched with)
      const country = s['user.current_country'] ?? null;

      return {
        _id:             h._id,
        timestamp:       dateStr,
        datetime_unix:   dtSec,
        user_id:         uid,
        email,
        keyword:         kw,
        advertiser:      adv,
        domain:          dom,
        platform:        network,
        country,
        filter_type:     s['filterType'] ?? null,
        ads_count:       s['adsCountOnSerach'] ?? null,
        filters_applied: [...new Set(filterPills)],
        other_activity,
      };
    });

    const fromLabel = new Date(fromTs * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const toLabel   = new Date(toTs   * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    return {
      code: 200,
      data: {
        rows,
        total,
        page:       pageNum,
        page_size:  pageSize,
        total_pages: Math.ceil(total / pageSize),
      },
      meta: {
        from_date:  new Date(fromTs * 1000).toISOString(),
        to_date:    new Date(toTs   * 1000).toISOString(),
        date_label: `${fromLabel} → ${toLabel}`,
      },
    };

  } catch (err) {
    logger?.error?.('[searchIntelligenceController] getAllSearches error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// ─── GET /intelligence/keyword-trends ────────────────────────────────────────
// Returns top keywords, advertisers, and domains with growth rate vs prior period.
// Growth rate = ((current_45d_count - prev_45d_count) / prev_45d_count) * 100
// Query params:
//   type      : "keyword" | "advertiser" | "domain" | "all" (default: "all")
//   sort_by   : "count" | "growth" (default: "count")
//   size      : number of top terms per type (default: 20)
// ─────────────────────────────────────────────────────────────────────────────

async function getKeywordTrends(req, elastic, logger) {
  try {
    if (!elastic) return { code: 500, message: 'Elasticsearch client not available' };

    const { type = 'all', sort_by = 'count', size = 20 } = req.query;
    const termSize = Math.min(100, Math.max(1, Number(size)));
    const DAY_S = 24 * 60 * 60;

    // Current period: last 45 days; previous period: 45 days before that
    const now     = Math.floor(Date.now() / 1000);
    const currTo  = now;
    const currFrom  = now - 45 * DAY_S;
    const prevTo  = currFrom - 1;
    const prevFrom  = prevTo - 45 * DAY_S;

    const FIELDS = {
      keyword:    'search.keyword.keyword',
      advertiser: 'search.advertiser.keyword',
      domain:     'search.domain.keyword',
    };

    // Which types to fetch
    const activeTypes = type === 'all'
      ? ['keyword', 'advertiser', 'domain']
      : [type].filter((t) => FIELDS[t]);

    // Build aggs for a given time window
    function buildAggs(types, termSz) {
      const aggs = {};
      for (const t of types) {
        aggs[`top_${t}`] = { terms: { field: FIELDS[t], size: termSz } };
      }
      return aggs;
    }

    function rangeFilter(from, to) {
      return { bool: { filter: [
        { range: { dateTime: { gte: from, lte: to } } },
        { bool: { should: activeTypes.map((t) => ({ exists: { field: `search.${t}` } })), minimum_should_match: 1 } },
      ] } };
    }


    // Run current and previous period queries in parallel
    const [currResult, prevResult] = await Promise.all([
      elastic.search({
        index: 'user_activities',
        body: { size: 0, query: rangeFilter(currFrom, currTo), aggs: buildAggs(activeTypes, termSize) },
      }),
      elastic.search({
        index: 'user_activities',
        body: { size: 0, query: rangeFilter(prevFrom, prevTo), aggs: buildAggs(activeTypes, termSize) },
      }),
    ]);

    const currAggs = getAggs(currResult);
    const prevAggs = getAggs(prevResult);

    function computeGrowth(curr, prev) {
      if (!prev || prev === 0) return null; // no previous data
      return Math.round(((curr - prev) / prev) * 100);
    }

    function buildTermList(typeName) {
      const currBuckets = currAggs[`top_${typeName}`]?.buckets ?? [];
      const prevBuckets = prevAggs[`top_${typeName}`]?.buckets ?? [];

      // Build prev count map
      const prevMap = {};
      for (const b of prevBuckets) prevMap[b.key] = b.doc_count;

      let terms = currBuckets.map((b) => ({
        term:        b.key,
        type:        typeName,
        count:       b.doc_count,
        prev_count:  prevMap[b.key] ?? 0,
        growth_pct:  computeGrowth(b.doc_count, prevMap[b.key] ?? 0),
      }));

      // Sort
      if (sort_by === 'growth') {
        terms = terms
          .filter((t) => t.growth_pct !== null)
          .sort((a, b) => b.growth_pct - a.growth_pct);
      } else {
        terms.sort((a, b) => b.count - a.count);
      }

      return terms;
    }

    const result = {};
    for (const t of activeTypes) {
      result[`${t}s`] = buildTermList(t);
    }

    const fromLabel = new Date(currFrom * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const toLabel   = new Date(currTo   * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const pfLabel   = new Date(prevFrom * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const ptLabel   = new Date(prevTo   * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    return {
      code: 200,
      data: result,
      meta: {
        current_period:  `${fromLabel} → ${toLabel}`,
        previous_period: `${pfLabel} → ${ptLabel}`,
        sort_by,
        growth_explanation: 'growth_pct = ((current 45d count - previous 45d count) / previous 45d count) × 100',
      },
    };

  } catch (err) {
    logger?.error?.('[searchIntelligenceController] getKeywordTrends error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// ─── GET /intelligence/projects ──────────────────────────────────────────────
// Paginated list of project activity docs (last 90 days), sorted by dateTime desc.
// Query params:
//   date_range : "Last 90 days" | "Last 30 days" | "Last 7 days" | "Today"
//   from_date  : ISO date string (overrides date_range)
//   to_date    : ISO date string (overrides date_range)
//   user       : email substring filter
//   page       : 0-based (default 0)
//   size       : page size (default 10, max 100)
// ─────────────────────────────────────────────────────────────────────────────

async function getProjectActivity(req, elastic, logger) {
  try {
    if (!elastic) return { code: 500, message: 'Elasticsearch client not available' };

    const DAY_S = 24 * 60 * 60;
    const {
      date_range = 'Last 90 days',
      from_date, to_date,
      user,
      page = 0, size = 10,
    } = req.query;

    const pageNum  = Math.max(0, Number(page));
    const pageSize = Math.min(100, Math.max(1, Number(size)));

    // Resolve time window
    let toTs, fromTs;
    if (from_date && to_date) {
      toTs   = Math.floor(new Date(to_date).getTime()   / 1000);
      fromTs = Math.floor(new Date(from_date).getTime() / 1000);
    } else {
      const now = new Date();
      toTs = Math.floor(now.getTime() / 1000);
      if (date_range === 'Today') {
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        fromTs = Math.floor(startOfDay.getTime() / 1000);
      } else if (date_range === 'Last 7 days') {
        fromTs = toTs - 7  * DAY_S;
      } else if (date_range === 'Last 30 days') {
        fromTs = toTs - 30 * DAY_S;
      } else {
        fromTs = toTs - 90 * DAY_S;
      }
    }

    const filters = [
      { range: { dateTime: { gte: fromTs, lte: toTs } } },
      { term: { 'network.keyword': 'Project' } },
      { bool: { should: [
        { exists: { field: 'project_name'          } },
        { exists: { field: 'competitors'            } },
        { exists: { field: 'brand'                  } },
        { exists: { field: 'advertiser'             } },
        { exists: { field: 'dashboard_Advertisers'  } },
        { exists: { field: 'dashboard_advertisers'  } },
        { exists: { field: 'deleted_Advertisers'    } },
        { exists: { field: 'monitoring_status'      } },
      ], minimum_should_match: 1 } },
    ];

    // Resolve user email → user_id, then filter by user.id in ES
    if (user && user.trim() !== '') {
      const uf = user.trim().toLowerCase();
      const userLookup = await elastic.search({
        index: 'user_activities',
        body: {
          size: 0,
          query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
          aggs: {
            per_user: {
              terms: { field: 'user.id', size: 2000 },
              aggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
            },
          },
        },
      });
      const matchedIds = [];
      for (const b of (getAggs(userLookup)?.per_user?.buckets ?? [])) {
        const src   = b.email_hit?.hits?.hits?.[0]?._source ?? {};
        const email = src['user.email'] ?? src?.user?.email ?? '';
        if (email.toLowerCase().includes(uf)) matchedIds.push(String(b.key));
      }
      if (matchedIds.length === 0) {
        return {
          code: 200,
          data: { rows: [], total: 0, page: pageNum, page_size: pageSize, total_pages: 0 },
          meta: { from_date: new Date(fromTs * 1000).toISOString(), to_date: new Date(toTs * 1000).toISOString(), date_label: '' },
        };
      }
      filters.push({ terms: { 'user.id': matchedIds } });
    }

    const body = {
      size: pageSize,
      from: pageNum * pageSize,
      query: { bool: { filter: filters } },
      sort: [{ dateTime: { order: 'desc' } }, { _id: { order: 'desc' } }],
      _source: true,
    };

    const [result, emailResult] = await Promise.all([
      elastic.search({ index: 'user_activities', body }),
      elastic.search({
        index: 'user_activities',
        body: {
          size: 0,
          query: { bool: { filter: [{ exists: { field: 'user.email' } }] } },
          aggs: {
            per_user: {
              terms: { field: 'user.id', size: 1000 },
              aggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
            },
          },
        },
      }),
    ]);

    // Build email map
    const emailMap = {};
    for (const b of (getAggs(emailResult)?.per_user?.buckets ?? [])) {
      const src   = b.email_hit?.hits?.hits?.[0]?._source ?? {};
      const email = src['user.email'] ?? src?.user?.email ?? null;
      if (email) emailMap[String(b.key)] = email;
    }

    const hitsArr = result?.hits?.hits ?? result?.body?.hits?.hits ?? [];
    const total   = (() => {
      const t = (result?.hits ?? result?.body?.hits ?? {}).total;
      return typeof t === 'object' ? (t.value ?? 0) : (t ?? 0);
    })();

    let rows = hitsArr.map((h) => {
      const s     = h._source ?? {};
      const uid   = s['user.id']    ?? s?.user?.id    ?? null;
      const email = s['user.email'] ?? s?.user?.email ?? emailMap[String(uid)] ?? null;
      const dtSec = s['dateTime'] ? Number(s['dateTime']) : null;
      const dateStr = dtSec
        ? new Date(dtSec * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
        : null;

      // Derive project_type
      let projectType = s['project_type'] ?? null;
      if (!projectType) {
        if (s['deleted_Advertisers'])                     projectType = 'delete_brand';
        else if (s['monitoring_status'] !== undefined)    projectType = 'monitoring_status';
        else if (s['project_name'] && s['competitors'])   projectType = 'project_click';
        else if (s['brand'] || s['advertiser'])           projectType = 'competitor_comparison';
        else if (s['dashboard_Advertisers'] || s['dashboard_advertisers']) projectType = 'dashboard';
        else                                              projectType = 'other';
      }

      const dashAdv = s['dashboard_Advertisers']
        ?? s['dashboard_advertisers']
        ?? s['dashboardAdvertisers']
        ?? s?.dashboard?.Advertisers
        ?? s?.dashboard?.advertisers
        ?? null;

      let brands = null;
      let competitors = null;

      if (projectType === 'delete_brand') {
        const del = s['deleted_Advertisers'];
        if (del) brands = Array.isArray(del) ? del.join(', ') : String(del);
      } else if (projectType === 'monitoring_status') {
        if (s['project_name']) brands      = String(s['project_name']);
        if (s['advertiser'])   competitors = Array.isArray(s['advertiser']) ? s['advertiser'].join(', ') : String(s['advertiser']);
      } else if (projectType === 'project_click') {
        // project_name → brand, competitors → competitors
        if (s['project_name']) brands = String(s['project_name']);
        if (s['competitors'])  competitors = Array.isArray(s['competitors']) ? s['competitors'].join(', ') : String(s['competitors']);
      } else if (projectType === 'competitor_comparison') {
        // brand → brand, advertiser → competitors
        if (s['brand'])      brands      = Array.isArray(s['brand'])      ? s['brand'].join(', ')      : String(s['brand']);
        if (s['advertiser']) competitors = Array.isArray(s['advertiser']) ? s['advertiser'].join(', ') : String(s['advertiser']);
      } else if (projectType === 'dashboard') {
        // dashboard_Advertisers → brands
        if (dashAdv) brands = Array.isArray(dashAdv) ? dashAdv.join(', ') : String(dashAdv);
      }

      return {
        _id:               h._id,
        timestamp:         dateStr,
        user_id:           uid,
        email,
        project_type:      projectType,
        monitoring_status: projectType === 'monitoring_status' ? (s['monitoring_status'] ?? null) : undefined,
        brands,
        competitors,
      };
    });

    const fromLabel = new Date(fromTs * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const toLabel   = new Date(toTs   * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    return {
      code: 200,
      data: {
        rows,
        total,
        page:        pageNum,
        page_size:   pageSize,
        total_pages: Math.ceil(total / pageSize),
      },
      meta: {
        from_date:  new Date(fromTs * 1000).toISOString(),
        to_date:    new Date(toTs   * 1000).toISOString(),
        date_label: `${fromLabel} → ${toLabel}`,
      },
    };

  } catch (err) {
    logger?.error?.('[searchIntelligenceController] getProjectActivity error:', err);
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

    // Delete by query
    const deleteResult = await elastic.deleteByQuery({
      index: 'user_activities',
      body: { query: rangeQuery },
      conflicts: 'proceed',
      refresh: true,
    });

    const deleted = deleteResult?.deleted ?? deleteResult?.body?.deleted ?? 0;
    const failures = (deleteResult?.failures ?? deleteResult?.body?.failures ?? []).length;

    logger?.info?.(`[purgeOldActivities] Deleted ${deleted} docs older than ${DAYS} days. Failures: ${failures}`);

    return {
      code: 200,
      message: `Deleted ${deleted} document(s) older than ${DAYS} days.`,
      data: {
        cutoff_timestamp: cutoffTs,
        cutoff_date: new Date(cutoffTs * 1000).toISOString(),
        deleted,
        failures,
      },
    };
  } catch (err) {
    logger?.error?.('[searchIntelligenceController] purgeOldActivities error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// ─── GET /intelligence/filter-options ────────────────────────────────────────
// Returns top unique values for keyword, advertiser, domain, country and user
// from the last 90 days — used to populate autocomplete dropdowns in the UI.
// Query params:
//   q    : optional search prefix (filters results client-side is fine; ES prefix too)
//   size : max results per field (default 50)
// ─────────────────────────────────────────────────────────────────────────────

async function getFilterOptions(req, elastic, logger) {
  try {
    if (!elastic) return { code: 500, message: 'Elasticsearch client not available' };

    const cacheKey = 'filter-options-90d';
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const DAY_S = 24 * 60 * 60;
    const now   = Math.floor(Date.now() / 1000);
    const fromTs = now - 90 * DAY_S;
    const size   = Math.min(200, Math.max(1, Number(req.query.size ?? 100)));

    const result = await elastic.search({
      index: 'user_activities',
      body: {
        size: 0,
        query: {
          bool: {
            filter: [
              { range: { dateTime: { gte: fromTs } } },
              { bool: { should: [
                { exists: { field: 'search.keyword'    } },
                { exists: { field: 'search.advertiser' } },
                { exists: { field: 'search.domain'     } },
              ], minimum_should_match: 1 } },
            ],
          },
        },
        aggs: {
          keywords:    { terms: { field: 'search.keyword.keyword',    size, order: { _count: 'desc' } } },
          advertisers: { terms: { field: 'search.advertiser.keyword', size, order: { _count: 'desc' } } },
          domains:     { terms: { field: 'search.domain.keyword',     size, order: { _count: 'desc' } } },
          countries:   { terms: { field: 'filter.country.keyword',    size, order: { _count: 'desc' } } },
        },
      },
    });

    const aggs = getAggs(result);
    const pick = (buckets) => (buckets ?? []).map((b) => b.key).filter(Boolean);

    // Also fetch unique user emails via email_hit trick
    const emailResult = await elastic.search({
      index: 'user_activities',
      body: {
        size: 0,
        query: { bool: { filter: [
          { range: { dateTime: { gte: fromTs } } },
          { exists: { field: 'user.email' } },
        ] } },
        aggs: {
          per_user: {
            terms: { field: 'user.id', size: 200, order: { _count: 'desc' } },
            aggs:  { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
          },
        },
      },
    });

    const users = (getAggs(emailResult)?.per_user?.buckets ?? [])
      .map((b) => {
        const src = b.email_hit?.hits?.hits?.[0]?._source ?? {};
        return src['user.email'] ?? src?.user?.email ?? null;
      })
      .filter(Boolean)
      .slice(0, size);

    const response = {
      code: 200,
      data: {
        keywords:    pick(aggs.keywords?.buckets),
        advertisers: pick(aggs.advertisers?.buckets),
        domains:     pick(aggs.domains?.buckets),
        countries:   pick(aggs.countries?.buckets),
        users,
      },
    };

    setCache(cacheKey, response, 5 * 60 * 1000); // cache 5 min
    return response;

  } catch (err) {
    logger?.error?.('[searchIntelligenceController] getFilterOptions error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

module.exports = { getIntelligenceStats, getTopUsers, getAllSearches, getKeywordTrends, getProjectActivity, getOtherActivities, purgeOldActivities, getFilterOptions };

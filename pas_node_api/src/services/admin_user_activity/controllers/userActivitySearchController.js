'use strict';

const {
  getAggs, getTotal, resolveTimeWindow, getAllUserEmails, fetchAllTermsBuckets,
  resolveUserIds: helperResolveUserIds, getCache, setCache,
  detectOtherActivity, parseFilterPills, parsePagination,
} = require('../helpers/searchIntelligenceHelpers');
const { buildAllSearchesQuery } = require('../queries/searchIntelligenceQueries');


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
      from_time, to_time,
      tz_offset_minutes,
      user, users, exclude_users,
      keyword, advertiser, domain,
      platform, ad_type, country,
      activity_type,
      page = 0, size = 10,
    } = req.query;

    const { pageNum, pageSize } = parsePagination({ page, size });

    // Resolve time window using helper
    const { fromTs, toTs } = resolveTimeWindow({ from_date, to_date, from_time, to_time, tz_offset_minutes, date_range });

    // Build base ES query using helper
    let body = buildAllSearchesQuery({
      pageNum,
      pageSize,
      fromTs,
      toTs,
      activity_type,
      platform,
      ad_type,
      country,
      keyword,
      advertiser,
      domain,
    });

    // Handle user filtering
    const resolveUserIds = (patterns) => helperResolveUserIds(patterns, elastic);
    const includeList = [
      ...(users        ? users.split(',').map((s) => s.trim()).filter(Boolean) : []),
      ...(user && user.trim() ? [user.trim()] : []),
    ];
    const excludeList = exclude_users
      ? exclude_users.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    if (includeList.length > 0 || excludeList.length > 0) {
      const [includeIds, excludeIds] = await Promise.all([
        resolveUserIds(includeList),
        resolveUserIds(excludeList),
      ]);

      if (includeList.length > 0 && includeIds.length === 0) {
        const fromLabel2 = new Date(fromTs * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const toLabel2   = new Date(toTs   * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        return {
          code: 200,
          data: { rows: [], total: 0, page: pageNum, page_size: pageSize, total_pages: 0 },
          meta: { from_date: new Date(fromTs * 1000).toISOString(), to_date: new Date(toTs * 1000).toISOString(), date_label: `${fromLabel2} → ${toLabel2}` },
        };
      }

      // Add user filters to existing query
      if (includeIds.length > 0) body.query.bool.filter.push({ terms: { 'user.id': includeIds } });
      if (excludeIds.length > 0) body.query.bool.filter.push({ bool: { must_not: [{ terms: { 'user.id': excludeIds } }] } });
    }



    const [result, emailMap] = await Promise.all([
      elastic.search({ index: 'user_activities', body }),
      getAllUserEmails(elastic),
    ]);

    const INVALID_EMAILS = new Set(['na', 'n/a', 'null', 'undefined', 'unknown', '-', '']);

    const hitsArr = result?.hits?.hits ?? result?.body?.hits?.hits ?? [];
    const total   = (() => {
      const t = (result?.hits ?? result?.body?.hits ?? {}).total;
      return typeof t === 'object' ? (t.value ?? 0) : (t ?? 0);
    })();

    let rows = hitsArr.map((h) => {
      const s       = h._source ?? {};
      const uid     = s['user.id']  ?? s?.user?.id  ?? null;
      const rawEmail = s['user.email'] ?? s?.user?.email ?? emailMap[String(uid)] ?? null;
      const email   = (rawEmail && !INVALID_EMAILS.has(String(rawEmail).trim().toLowerCase())) ? rawEmail : (emailMap[String(uid)] ?? null);
      const kw      = s['search.keyword']    ?? s?.search?.keyword    ?? null;
      const adv     = s['search.advertiser'] ?? s?.search?.advertiser ?? null;
      const dom     = s['search.domain']     ?? s?.search?.domain     ?? null;
      const network = s['network'] ?? s?.network ?? null;
      const dtSec   = s['dateTime'] ? Number(s['dateTime']) : null;
      const dateStr = dtSec
        ? new Date(dtSec * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
        : (s['date'] ?? null);

      // Detect other-activity type and build filter pills — shared with the
      // rest of the admin panel via searchIntelligenceHelpers.js instead of
      // being rebuilt here on every row.
      const other_activity = detectOtherActivity(s);
      const filterPills = parseFilterPills(s, other_activity);

      // Country: user's current country (not the filter.country they searched with)
      const country = s['user.current_country'] ?? null;

      // Get all platforms: check for platforms array first, fall back to single network
      const platformsArray = Array.isArray(s['platforms']) ? s['platforms'].filter(Boolean) : [];
      const allPlatforms = platformsArray.length > 0 ? platformsArray : (network ? [network] : []);
      const platformStr = allPlatforms.join(',');

      // Ad count + search errors: search_error_detail is stored as an array of
      // { network, message } pairs (see buildGetAdsInsertData/parseErrorObject in
      // frontend_user_activity/controllers/userActivityController.js). The UI
      // (AllSearches.jsx / SearchIntelligence.jsx) expects ads_count as
      // "<count> | { "<network>": "<message>", ... }" when errors are present.
      const rawAdsCount = s['adsCountOnSerach'] ?? 0;
      const errDetail = s['search_error_detail'] ?? s?.search_error_detail;
      let adsCount = rawAdsCount;
      if (errDetail && errDetail !== 'NA') {
        const errArr = Array.isArray(errDetail) ? errDetail : [errDetail];
        const errMap = {};
        for (const e of errArr) {
          if (e && typeof e === 'object' && e.network) errMap[e.network] = e.message ?? '';
        }
        if (Object.keys(errMap).length > 0) {
          adsCount = `${rawAdsCount} | ${JSON.stringify(errMap)}`;
        }
      }

      return {
        _id:             h._id,
        timestamp:       dateStr,
        datetime_unix:   dtSec,
        user_id:         uid,
        email,
        keyword:         kw,
        advertiser:      adv,
        domain:          dom,
        platform:        platformStr,
        country,
        filter_type:     s['filterType'] ?? null,
        ads_count:       adsCount,
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
    logger?.error?.('[userActivitySearchController] getAllSearches error:', err);
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

    const dropdownBody = {
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
    };



    const result = await elastic.search({
      index: 'user_activities',
      body: dropdownBody,
    });

    const aggs = getAggs(result);
    const pick = (buckets) => (buckets ?? []).map((b) => b.key).filter(Boolean);

    // Also fetch unique user emails via email_hit trick.
    // Paginated (no fixed size cap) so ranking by activity covers every user,
    // not just whichever ones happened to land in the first page.
    const emailBuckets = await fetchAllTermsBuckets(elastic, {
      query: { bool: { filter: [
        { range: { dateTime: { gte: fromTs } } },
        { exists: { field: 'user.email' } },
      ] } },
      field: 'user.id',
      subAggs: { email_hit: { top_hits: { size: 1, _source: ['user.email'] } } },
    });

    const INVALID_FO = new Set(['na', 'n/a', 'null', 'undefined', 'unknown', '-', '']);
    const users = emailBuckets
      .sort((a, b) => b.doc_count - a.doc_count)
      .map((b) => {
        const src = b.email_hit?.hits?.hits?.[0]?._source ?? {};
        return src['user.email'] ?? src?.user?.email ?? null;
      })
      .filter((e) => e && !INVALID_FO.has(String(e).trim().toLowerCase()) && String(e).includes('@'))
      .slice(0, size);

    const keywords = pick(aggs.keywords?.buckets);
    const advertisers = pick(aggs.advertisers?.buckets);
    const domains = pick(aggs.domains?.buckets);
    const countries = pick(aggs.countries?.buckets);


    const response = {
      code: 200,
      data: {
        keywords,
        advertisers,
        domains,
        countries,
        users,
      },
    };

    setCache(cacheKey, response, 5 * 60 * 1000); // cache 5 min
    return response;

  } catch (err) {
    logger?.error?.('[userActivitySearchController] getFilterOptions error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// ─── GET /intelligence/summary ───────────────────────────────────────────────
// Returns aggregated summary stats (platforms, pages, filters) for the entire
// filtered result set (not paginated). Same filters as getAllSearches.
// ─────────────────────────────────────────────────────────────────────────────

async function getSummaryStats(req, elastic, logger) {
  try {
    if (!elastic) return { code: 500, message: 'Elasticsearch client not available' };

    const DAY_S = 24 * 60 * 60;
    const {
      date_range = 'Last 90 days',
      from_date, to_date,
      user, users, exclude_users,
      keyword, advertiser, domain,
      platform, ad_type, country,
      activity_type,
    } = req.query;

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

    if (platform && platform !== 'Any')   filters.push({ match: { 'network': { query: platform.toLowerCase(), operator: 'or' } } });
    if (ad_type  && ad_type  !== 'Any')   filters.push({ term:  { 'filter.ad_type.keyword':     ad_type  } });
    if (country  && country  !== '')      filters.push({ term: { 'user.current_country.keyword': country } });
    if (keyword    && keyword    !== '')  filters.push({ match: { 'search.keyword':    { query: keyword,    operator: 'and' } } });
    if (advertiser && advertiser !== '')  filters.push({ match: { 'search.advertiser': { query: advertiser, operator: 'and' } } });
    if (domain     && domain     !== '')  filters.push({ match: { 'search.domain':     { query: domain,     operator: 'and' } } });

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

    // Wrapper: delegate to helper with elastic client
    const resolveUserIds = (patterns) => helperResolveUserIds(patterns, elastic);

    const includeList = [
      ...(users        ? users.split(',').map((s) => s.trim()).filter(Boolean) : []),
      ...(user && user.trim() ? [user.trim()] : []),
    ];
    const excludeList = exclude_users
      ? exclude_users.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    if (includeList.length > 0 || excludeList.length > 0) {
      const [includeIds, excludeIds] = await Promise.all([
        resolveUserIds(includeList),
        resolveUserIds(excludeList),
      ]);
      if (includeIds.length > 0) filters.push({ terms: { 'user.id': includeIds } });
      if (excludeIds.length > 0) filters.push({ bool: { must_not: [{ terms: { 'user.id': excludeIds } }] } });
    }

    const body = {
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        other_types: { terms: { field: 'filterType.keyword',  size: 20, order: { _count: 'desc' } } },
        sort_by:     { terms: { field: 'filter.sort_by.keyword', size: 20, order: { _count: 'desc' } } },
        keywords_agg: { filter: { exists: { field: 'search.keyword' } }, aggs: { count: { cardinality: { field: 'search.keyword.keyword' } } } },
        advertisers_agg: { filter: { exists: { field: 'search.advertiser' } }, aggs: { count: { cardinality: { field: 'search.advertiser.keyword' } } } },
        domains_agg: { filter: { exists: { field: 'search.domain' } }, aggs: { count: { cardinality: { field: 'search.domain.keyword' } } } },
        dashboard_page: { filter: { exists: { field: 'dashboard.newest_sort' } } },
        analytics_page: { filter: { exists: { field: 'show_analytics.ad_id' } } },
        favorite_page: { filter: { exists: { field: 'dashboard.favourite' } } },
        hidden_page: { filter: { exists: { field: 'dashboard.hidden' } } },
        all_projects_page: { filter: { bool: { must: [{ exists: { field: 'network' } }] } } },
        guest_page: { filter: { exists: { field: 'share.guest_page_url' } } },
        landing_page: { filter: { exists: { field: 'copy.landing_page_url' } } },
        sorting_count: { filter: { bool: { should: [
          { exists: { field: 'dashboard.newest_sort' } },
          { exists: { field: 'dashboard.impressions_sort' } },
          { exists: { field: 'dashboard.popularity_sort' } },
          { exists: { field: 'dashboard.running_longest_sort' } },
          { exists: { field: 'dashboard.domain_sort' } },
          { exists: { field: 'dashboard.last_seen_sort' } },
          { exists: { field: 'dashboard.likes_sort' } },
          { exists: { field: 'dashboard.comments_sort' } },
          { exists: { field: 'dashboard.shares_sort' } },
        ], minimum_should_match: 1 } } },
        other_actions_count: { filter: { bool: { should: [
          { exists: { field: 'dashboard.exportsAds' } },
          { exists: { field: 'favourite_ad_id' } },
          { exists: { field: 'download.ad_id' } },
          { exists: { field: 'hide_advertiser_id' } },
          { exists: { field: 'hide_ad_id' } },
          { exists: { field: 'unfavourite_ad_id' } },
          { exists: { field: 'unhide_advertiser_id' } },
          { exists: { field: 'unhide_ad_id' } },
          { exists: { field: 'dashboard.show_original' } },
          { exists: { field: 'user.language_name' } },
          { exists: { field: 'vieworiginal.ad_id' } },
        ], minimum_should_match: 1 } } },
        filters_count: { filter: { bool: { should: [
          { exists: { field: 'filter' } },
          { term: { 'filterType.keyword': 'filter_only' } },
        ], minimum_should_match: 1 } } },
        sorting_breakdown: { filter: { bool: { should: [
          { exists: { field: 'dashboard.newest_sort' } },
          { exists: { field: 'dashboard.impressions_sort' } },
          { exists: { field: 'dashboard.popularity_sort' } },
          { exists: { field: 'dashboard.running_longest_sort' } },
          { exists: { field: 'dashboard.domain_sort' } },
          { exists: { field: 'dashboard.last_seen_sort' } },
          { exists: { field: 'dashboard.likes_sort' } },
          { exists: { field: 'dashboard.comments_sort' } },
          { exists: { field: 'dashboard.shares_sort' } },
        ], minimum_should_match: 1 } }, aggs: {
          newest: { filter: { term: { 'dashboard.newest_sort.keyword': 'newest_sort' } } },
          impressions: { filter: { term: { 'dashboard.impressions_sort.keyword': 'impressions_sort' } } },
          popularity: { filter: { term: { 'dashboard.popularity_sort.keyword': 'popularity_sort' } } },
          running_longest: { filter: { term: { 'dashboard.running_longest_sort.keyword': 'running_longest_sort' } } },
          domain: { filter: { term: { 'dashboard.domain_sort.keyword': 'domain_sort' } } },
          last_seen: { filter: { term: { 'dashboard.last_seen_sort.keyword': 'last_seen_sort' } } },
          likes: { filter: { term: { 'dashboard.likes_sort.keyword': 'likes_sort' } } },
          comments: { filter: { term: { 'dashboard.comments_sort.keyword': 'comments_sort' } } },
          shares: { filter: { term: { 'dashboard.shares_sort.keyword': 'shares_sort' } } },
        } },
        other_breakdown: { filter: { bool: { should: [
          { exists: { field: 'dashboard.exportsAds' } },
          { exists: { field: 'favourite_ad_id' } },
          { exists: { field: 'download.ad_id' } },
          { exists: { field: 'hide_advertiser_id' } },
          { exists: { field: 'hide_ad_id' } },
          { exists: { field: 'unfavourite_ad_id' } },
          { exists: { field: 'unhide_advertiser_id' } },
          { exists: { field: 'unhide_ad_id' } },
          { exists: { field: 'dashboard.show_original' } },
          { exists: { field: 'user.language' } },
          { exists: { field: 'vieworiginal.ad_id' } },
        ], minimum_should_match: 1 } }, aggs: {
          export_ads: { filter: { exists: { field: 'dashboard.exportsAds' } } },
          favorite_ads: { filter: { exists: { field: 'favourite_ad_id' } } },
          download_ads: { filter: { exists: { field: 'download.ad_id' } } },
          hide_advertiser: { filter: { exists: { field: 'hide_advertiser_id' } } },
          hide_ads: { filter: { exists: { field: 'hide_ad_id' } } },
          unfavorite_ads: { filter: { exists: { field: 'unfavourite_ad_id' } } },
          unhide_advertiser: { filter: { exists: { field: 'unhide_advertiser_id' } } },
          unhide_ads: { filter: { exists: { field: 'unhide_ad_id' } } },
          show_original: { filter: { exists: { field: 'dashboard.show_original' } } },
          language_change: { filter: { exists: { field: 'user.language' } } },
          view_original: { filter: { exists: { field: 'vieworiginal.ad_id' } } },
        } },
        filters_breakdown: { filter: { bool: { should: [
          { exists: { field: 'filter.native_network' } },
          { exists: { field: 'filter.gender' } },
          { exists: { field: 'filter.ad_type' } },
          { exists: { field: 'filter.status' } },
          { exists: { field: 'filter.country' } },
          { exists: { field: 'filter.platform' } },
          { exists: { field: 'filter.sort_by' } },
          { exists: { field: 'filter.budget' } },
          { exists: { field: 'filter.ctr' } },
        ], minimum_should_match: 1 } }, aggs: {
          native_network: { filter: { exists: { field: 'filter.native_network' } } },
          gender: { filter: { exists: { field: 'filter.gender' } } },
          ad_type: { filter: { exists: { field: 'filter.ad_type' } } },
          status: { filter: { exists: { field: 'filter.status' } } },
          country: { filter: { exists: { field: 'filter.country' } } },
          platform: { filter: { exists: { field: 'filter.platform' } } },
          sort_by: { filter: { exists: { field: 'filter.sort_by' } } },
          budget: { filter: { exists: { field: 'filter.budget' } } },
          ctr: { filter: { exists: { field: 'filter.ctr' } } },
        } },
      },
    };



    const result = await elastic.search({ index: 'user_activities', body });
    const total  = getTotal(result);
    const aggs   = getAggs(result);

    // Fetch all docs to extract unique platforms (network field can be comma-separated)
    const allDocsBody = {
      query: { bool: { filter: filters } },
      _source: ['network'],
    };

    const platformsSet = new Set();
    let allDocsFetched = 0;
    let fetchSize = 1000;

    while (allDocsFetched < total && allDocsFetched < 10000) {
      const docsResult = await elastic.search({
        index: 'user_activities',
        body: { ...allDocsBody, from: allDocsFetched, size: fetchSize },
      });
      const hits = docsResult?.hits?.hits ?? docsResult?.body?.hits?.hits ?? [];
      if (hits.length === 0) break;
      hits.forEach((h) => {
        const network = h._source?.network ?? null;
        if (network) {
          String(network).split(',').forEach((p) => {
            const platform = p.trim().toLowerCase();
            if (platform) platformsSet.add(platform);
          });
        }
      });
      allDocsFetched += hits.length;
    }

    const otherTypesAgg = (aggs.other_types?.buckets ?? []).map((b) => b.key).filter(Boolean);
    const sortByAgg = (aggs.sort_by?.buckets ?? []).map((b) => b.key).filter(Boolean);

    const pagesVisited = [
      aggs.dashboard_page?.doc_count > 0 && { name: "Ads Library", count: aggs.dashboard_page?.doc_count ?? 0 },
      aggs.analytics_page?.doc_count > 0 && { name: "Analytics Model", count: aggs.analytics_page?.doc_count ?? 0 },
      aggs.favorite_page?.doc_count > 0 && { name: "Favorite Dashboard", count: aggs.favorite_page?.doc_count ?? 0 },
      aggs.hidden_page?.doc_count > 0 && { name: "Hidden Dashboard", count: aggs.hidden_page?.doc_count ?? 0 },
      aggs.all_projects_page?.doc_count > 0 && { name: "All Projects Dashboard", count: aggs.all_projects_page?.doc_count ?? 0 },
      aggs.guest_page?.doc_count > 0 && { name: "Guest Page", count: aggs.guest_page?.doc_count ?? 0 },
      aggs.landing_page?.doc_count > 0 && { name: "Landing Page", count: aggs.landing_page?.doc_count ?? 0 },
    ].filter(Boolean);

    const sortingBreakdown = [
      { name: 'Newest Sort', count: aggs.sorting_breakdown?.newest?.doc_count ?? 0 },
      { name: 'Impressions Sort', count: aggs.sorting_breakdown?.impressions?.doc_count ?? 0 },
      { name: 'Popularity Sort', count: aggs.sorting_breakdown?.popularity?.doc_count ?? 0 },
      { name: 'Ad running days', count: aggs.sorting_breakdown?.running_longest?.doc_count ?? 0 },
      { name: 'Domain reg date', count: aggs.sorting_breakdown?.domain?.doc_count ?? 0 },
      { name: 'Last Seen Sort', count: aggs.sorting_breakdown?.last_seen?.doc_count ?? 0 },
      { name: 'Likes Sort', count: aggs.sorting_breakdown?.likes?.doc_count ?? 0 },
      { name: 'Comments Sort', count: aggs.sorting_breakdown?.comments?.doc_count ?? 0 },
      { name: 'Shares Sort', count: aggs.sorting_breakdown?.shares?.doc_count ?? 0 },
    ].sort((a, b) => b.count - a.count);
    const otherActionsBreakdown = {
      export_ads: aggs.other_breakdown?.export_ads?.doc_count ?? 0,
      favorite_ads: aggs.other_breakdown?.favorite_ads?.doc_count ?? 0,
      download_ads: aggs.other_breakdown?.download_ads?.doc_count ?? 0,
      hide_advertiser: aggs.other_breakdown?.hide_advertiser?.doc_count ?? 0,
      hide_ads: aggs.other_breakdown?.hide_ads?.doc_count ?? 0,
      unfavorite_ads: aggs.other_breakdown?.unfavorite_ads?.doc_count ?? 0,
      unhide_advertiser: aggs.other_breakdown?.unhide_advertiser?.doc_count ?? 0,
      unhide_ads: aggs.other_breakdown?.unhide_ads?.doc_count ?? 0,
      show_original: aggs.other_breakdown?.show_original?.doc_count ?? 0,
      language_change: aggs.other_breakdown?.language_change?.doc_count ?? 0,
      view_original: aggs.other_breakdown?.view_original?.doc_count ?? 0,
    };
    const filtersBreakdown = [
      aggs.filters_breakdown?.native_network?.doc_count > 0 && { name: 'Native Network', count: aggs.filters_breakdown?.native_network?.doc_count ?? 0 },
      aggs.filters_breakdown?.gender?.doc_count > 0 && { name: 'Gender', count: aggs.filters_breakdown?.gender?.doc_count ?? 0 },
      aggs.filters_breakdown?.ad_type?.doc_count > 0 && { name: 'Ad Type', count: aggs.filters_breakdown?.ad_type?.doc_count ?? 0 },
      aggs.filters_breakdown?.status?.doc_count > 0 && { name: 'Status', count: aggs.filters_breakdown?.status?.doc_count ?? 0 },
      aggs.filters_breakdown?.country?.doc_count > 0 && { name: 'Country', count: aggs.filters_breakdown?.country?.doc_count ?? 0 },
      aggs.filters_breakdown?.platform?.doc_count > 0 && { name: 'Platform', count: aggs.filters_breakdown?.platform?.doc_count ?? 0 },
      aggs.filters_breakdown?.budget?.doc_count > 0 && { name: 'Budget', count: aggs.filters_breakdown?.budget?.doc_count ?? 0 },
      aggs.filters_breakdown?.ctr?.doc_count > 0 && { name: 'CTR', count: aggs.filters_breakdown?.ctr?.doc_count ?? 0 },
    ].filter(Boolean);

    return {
      code: 200,
      data: {
        total,
        platforms: [...platformsSet],
        activity_types: otherTypesAgg,
        sort_by: sortByAgg,
        pages_visited: pagesVisited,
        search_counts: {
          keywords: {
            unique: aggs.keywords_agg?.count?.value ?? 0,
            total: aggs.keywords_agg?.doc_count ?? 0,
          },
          advertisers: {
            unique: aggs.advertisers_agg?.count?.value ?? 0,
            total: aggs.advertisers_agg?.doc_count ?? 0,
          },
          domains: {
            unique: aggs.domains_agg?.count?.value ?? 0,
            total: aggs.domains_agg?.doc_count ?? 0,
          },
        },
        action_counts: {
          sorting_total: aggs.sorting_count?.doc_count ?? 0,
          sorting_breakdown: sortingBreakdown,
          other_actions_total: aggs.other_actions_count?.doc_count ?? 0,
          other_actions_breakdown: otherActionsBreakdown,
          filters_total: aggs.filters_count?.doc_count ?? 0,
          filters_breakdown: filtersBreakdown,
        },
      },
    };

  } catch (err) {
    logger?.error?.('[userActivitySearchController] getSummaryStats error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

module.exports = { getAllSearches, getFilterOptions, getSummaryStats };

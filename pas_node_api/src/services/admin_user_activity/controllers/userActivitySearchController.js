'use strict';

const { getAggs, getTotal, resolveTimeWindow, getAllUserEmails, resolveUserIds: helperResolveUserIds, getCache, setCache } = require('../helpers/searchIntelligenceHelpers');
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

    const pageNum  = Math.max(0, Number(page));
    const pageSize = Math.min(100, Math.max(1, Number(size)));

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

      // Get all platforms: check for platforms array first, fall back to single network
      const platformsArray = Array.isArray(s['platforms']) ? s['platforms'].filter(Boolean) : [];
      const allPlatforms = platformsArray.length > 0 ? platformsArray : (network ? [network] : []);
      const platformStr = allPlatforms.join(',');

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
        ads_count:       s['adsCountOnSerach'] ?? 0,
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

    // Also fetch unique user emails via email_hit trick
    const emailBody = {
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
    };


    const emailResult = await elastic.search({
      index: 'user_activities',
      body: emailBody,
    });

    const INVALID_FO = new Set(['na', 'n/a', 'null', 'undefined', 'unknown', '-', '']);
    const users = (getAggs(emailResult)?.per_user?.buckets ?? [])
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
      size: 1000,
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

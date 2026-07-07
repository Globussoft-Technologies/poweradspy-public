'use strict';

const { getAggs } = require('../helpers/searchIntelligenceHelpers');
const databaseManager = require('../../../database/DatabaseManager');
const { fetchAdsCountByPlatform,fetchAdsCountForKeywordsByPlatform } = require('../queries/searchIntelligenceQueries');

// Resolve a shared Mongo connection for the keyword_searches collection.
// If the caller passed one in, use it; otherwise borrow the user_activity pool.
function getKeywordSearchesCollection(mongo) {
  const conn = mongo || databaseManager.getMongo('user_activity');
  if (!conn || !conn.collection) return null;
  return conn.collection('keyword_searches');
}

// ─── GET /intelligence/keyword-trends ───────────────────────────────────────
// Query params: type (1=keyword, 2=advertiser, 3=domain, all=all), page, size
// Returns: keywords/advertisers/domains with scraping status, ad counts, pagination
// ─────────────────────────────────────────────────────────────────────────────

async function getKeywordTrends(req, elastic, logger, mongo) {
  try {
    const collection = getKeywordSearchesCollection(mongo);
    if (!collection) {
      return { code: 500, message: 'MongoDB not available' };
    }

    const { type = 'all', page = 0, size = 10, sort_by = 'createdAt', status, search_value } = req.query;

    const pageNum = Math.max(0, Number(page));
    const pageSize = Math.min(100, Math.max(1, Number(size)));
    const skip = pageNum * pageSize;

    // Map type string to typeNum (1=keyword, 2=advertiser, 3=domain)
    const typeMap = {
      'keyword': 1,
      'advertiser': 2,
      'domain': 3,
      'all': null,
    };

    const typeNum = typeMap[type];
    if (typeNum === undefined) {
      return { code: 400, message: 'Invalid type. Use: keyword, advertiser, domain, or all' };
    }

    // Build query filter based on type and status
    let filter = typeNum !== null ? { type: typeNum, users: { $ne: null } } : { users: { $ne: null } };

    // Add search_value filter if provided (exact match on value field)
    if (search_value) {
      filter.value = search_value;
    }

    // Add status-based filtering
    if (status) {
      switch (status) {
        case 'totalkeywords':
          // All time: all keywords (no additional filter)
          filter = {
            ...filter
          };
          break;
        case 'totalcompleted':
          // All time: has completed scraping with no failures
          filter = {
            ...filter,
            'scrapping_status': { $exists: true, $not: { $size: 0 } },
            'scrapping_status.status': 'completed'
          };
          break;
        case 'totalnotwent':
          // All time: never went for scrapping
          filter = {
            ...filter,
            $or: [
              { 'scrapping_status': { $exists: false } },
              { 'scrapping_status': { $size: 0 } }
            ]
          };
          break;
        case 'totalunderscrapping':
          // All time: currently under scrapping (has startTime but no endTime)
          filter = {
            ...filter,
            'scrapping_status': {
              $elemMatch: {
                startTime: { $exists: true },
                endTime: { $exists: false }
              }
            }
          };
          break;
        case 'todaycompleted':
          // Today: completed scraping with date=today (primary) or endTime within today (fallback)
          const todayDateStr = new Date().toISOString().split('T')[0];
          const todayStartMs = new Date(todayDateStr + 'T00:00:00Z').getTime();
          const todayEndMs = new Date(todayDateStr + 'T23:59:59.999Z').getTime();
          filter = {
            ...filter,
            'scrapping_status': {
              $elemMatch: {
                status: 'completed',
                $or: [
                  { date: todayDateStr },
                  { endTime: { $gte: todayStartMs, $lte: todayEndMs } }
                ]
              }
            }
          };
          break;
        case 'todaynotwent':
          // Today: keywords that were searched today but never went for scrapping
          const todayStr = new Date().toISOString().split('T')[0];
          filter = {
            ...filter,
            'searchDates': {
              $elemMatch: {
                $gte: new Date(todayStr + 'T00:00:00Z')
              }
            },
            $or: [
              { 'scrapping_status': { $exists: false } },
              { 'scrapping_status': { $size: 0 } }
            ]
          };
          break;
        case 'todayunderscrapping':
          // Today: under scrapping where date=today (primary) or startTime within today
          const todayDateStrUnder = new Date().toISOString().split('T')[0];
          const todayStartMsUnder = new Date(todayDateStrUnder + 'T00:00:00Z').getTime();
          const todayEndMsUnder = new Date(todayDateStrUnder + 'T23:59:59.999Z').getTime();
          filter = {
            ...filter,
            'scrapping_status': {
              $elemMatch: {
                startTime: { $exists: true },
                endTime: { $exists: false },
                $or: [
                  { date: todayDateStrUnder },
                  { startTime: { $gte: todayStartMsUnder, $lte: todayEndMsUnder } }
                ]
              }
            }
          };
          break;
        case 'totalfailed':
          // All time: failed scraping (has status='failed' in scrapping_status)
          filter = {
            ...filter,
            'scrapping_status': {
              $elemMatch: {
                status: 'failed'
              }
            }
          };
          break;
        case 'todayfailed':
          // Today: failed scraping with date=today or endTime within today
          const todayDateStrFailed = new Date().toISOString().split('T')[0];
          const todayStartMsFailed = new Date(todayDateStrFailed + 'T00:00:00Z').getTime();
          const todayEndMsFailed = new Date(todayDateStrFailed + 'T23:59:59.999Z').getTime();
          filter = {
            ...filter,
            'scrapping_status': {
              $elemMatch: {
                status: 'failed',
                $or: [
                  { date: todayDateStrFailed },
                  { endTime: { $gte: todayStartMsFailed, $lte: todayEndMsFailed } }
                ]
              }
            }
          };
          break;
      }
    }

    // Build aggregation pipeline for segregation by type
    const aggregationPipeline = [
      {
        $match: filter
      },
      {
        $facet: {
          total: [{ $count: 'count' }],
          data: [
            {
              $sort: sort_by === 'createdAt' || sort_by === 'created'
                ? { createdAt: -1 }
                : sort_by === 'count'
                ? { searchCount: -1 }
                : sort_by === 'recent' || sort_by === 'lastSearchedAt'
                ? { lastSearchedAt: -1 }
                : { createdAt: -1 }
            },
            { $skip: skip },
            { $limit: pageSize },
            {
              $group: {
                _id: '$type',
                items: { $push: '$$ROOT' },
                count: { $sum: 1 }
              }
            },
            {
              $sort: { _id: 1 }
            }
          ]
        }
      }
    ];

    const aggregationResult = await collection.aggregate(aggregationPipeline).toArray();
    const totalCount = aggregationResult[0]?.total[0]?.count || 0;
    const groupedData = aggregationResult[0]?.data || [];

    // Flatten the grouped data back to single array of docs
    const docs = [];
    for (const group of groupedData) {
      docs.push(...group.items);
    }

    const enriched = await enrichKeywordsWithAds(docs, 'value', typeNum, elastic, logger);

    const typeLabel = typeNum === 1 ? 'keywords' : typeNum === 2 ? 'advertisers' : typeNum === 3 ? 'domains' : 'items';

    return {
      code: 200,
      data: { [typeLabel]: enriched },
      meta: {
        page: pageNum,
        size: pageSize,
        total: totalCount,
        total_pages: Math.ceil(totalCount / pageSize),
      },
    };
  } catch (err) {
    logger?.error?.('[keyword_Trend_ProjectController] getKeywordTrends error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

async function enrichKeywordsWithAds(keywords, fieldName, typeNum, elastic, logger) {
  const docMap = {};
  const platformKeywordMap = {};

  // Step 1: Organize keywords by platform
  for (const doc of keywords) {
    const searchValue = doc[fieldName];
    const keyword_type = doc.type;
    const platforms = doc.networks || doc.platform || [];
    const scrapingHistory = doc.scrapping_status || [];

    const rawSearchedDate = doc.searchDates?.[0]?.$date || doc.searchDates?.[0] || doc.createdAt?.$date || doc.createdAt || null;
    const searchedDateStr = rawSearchedDate ? new Date(rawSearchedDate).toLocaleDateString() : null;

    const uniquePlatforms = [...new Set(platforms.length > 0 ? platforms : scrapingHistory.map(s => s.network).filter(Boolean))];

    const history = (scrapingHistory || []).map(run => ({
      date: run.date,
      status: run.status,
      startTime: run.startTime?.$date || run.startTime,
      endTime: run.endTime?.$date || run.endTime,
      network: run.network,
      adsCount: 0,
      owner: run.owner,
      mode: run.mode
    }));

    docMap[searchValue] = {
      doc,
      searchValue,
      keyword_type,
      uniquePlatforms,
      searchedDateStr,
      history,
      docTypeNum: doc.type || typeNum
    };

    // Map platform -> list of keywords for batch query
    for (const platform of uniquePlatforms) {
      if (!platformKeywordMap[platform]) {
        platformKeywordMap[platform] = [];
      }
      platformKeywordMap[platform].push({
        keyword: searchValue,
        scrappingHistory: history.map(h => ({
          startTime: h.startTime,
          endTime: h.endTime
        }))
      });
    }
  }

  // Step 2: Batch fetch using existing optimized function
  if (elastic && Object.keys(platformKeywordMap).length > 0) {
 
    try {
      const t1 = Date.now();
      const platformResults = await fetchAdsCountForKeywordsByPlatform(elastic, platformKeywordMap, logger);
      const t2 = Date.now();

      logger?.info?.('[enrichKeywordsWithAds] Fetch completed in', t2 - t1, 'ms');

      // Merge results back
      for (const [platform, keywordsWithCounts] of Object.entries(platformResults)) {
        for (const kwResult of keywordsWithCounts) {
          const searchValue = kwResult.keyword;
          const kwDoc = docMap[searchValue];

          if (kwDoc) {
            for (let i = 0; i < kwDoc.history.length; i++) {
              const historyRun = kwDoc.history[i];
              const matchedHistory = kwResult.history_with_counts?.find(h =>
                h.startTime === historyRun.startTime && h.endTime === historyRun.endTime
              );
              if (matchedHistory) {
                historyRun.adsCount = matchedHistory.ads_count || 0;
              }
            }
          }
        }
      }
    } catch (err) {
      logger?.error?.('[enrichKeywordsWithAds] Fetch failed:', err.message);
    }
  }

  // Step 3: Build final response
  const results = [];
  for (const doc of keywords) {
    const searchValue = doc[fieldName];
    const docInfo = docMap[searchValue];

    const typeLabel = docInfo.docTypeNum === 1 ? 'keyword' : docInfo.docTypeNum === 2 ? 'advertiser' : 'domain';

    const result = {
      [typeLabel]: searchValue,
      platform: docInfo.uniquePlatforms,
      searchedDate: docInfo.searchedDateStr,
      history: docInfo.history
    };

    if (typeLabel !== 'keyword') result.keyword = null;
    if (typeLabel !== 'advertiser') result.advertiser = null;
    if (typeLabel !== 'domain') result.domain = null;

    results.push(result);
  }

  return results;
}

// ─── GET /intelligence/items-list ──────────────────────────────────────────
// Query params: type (1=keyword, 2=advertiser, 3=domain)
// Returns: list of all unique items (keywords/advertisers/domains) for dropdown
// ─────────────────────────────────────────────────────────────────────────────

async function getItemsList(req, elastic, logger, mongo) {
  try {
    const collection = getKeywordSearchesCollection(mongo);
    if (!collection) {
      return { code: 500, message: 'MongoDB not available' };
    }

    const { type = 1 } = req.query;
    const typeNum = Number(type);

    if (![1, 2, 3].includes(typeNum)) {
      return { code: 400, message: 'Invalid type. Use: 1 (keyword), 2 (advertiser), or 3 (domain)' };
    }

    const items = await collection
      .find({ type: typeNum, users: { $ne: null } })
      .sort({ searchCount: -1 })  // Sort by most searched first
      .toArray();

    if (items.length === 0) {
      const typeLabel = typeNum === 1 ? 'keywords' : typeNum === 2 ? 'advertisers' : 'domains';
      return {
        code: 200,
        data: {
          type: typeNum,
          type_label: typeLabel,
          items: [],
          total: 0
        }
      };
    }

    // Extract unique items with their counts
    const itemsList = items.map((doc) => ({
      id: doc._id.toString(),
      value: doc.value,
      count: doc.searchCount || 0
    }));

    const typeLabel = typeNum === 1 ? 'keywords' : typeNum === 2 ? 'advertisers' : 'domains';

    logger?.info?.('[getItemsList] Fetched items for type:', { typeNum, typeLabel, count: itemsList.length });

    return {
      code: 200,
      data: {
        type: typeNum,
        type_label: typeLabel,
        items: itemsList,
        total: itemsList.length
      }
    };
  } catch (err) {
    logger?.error?.('[getItemsList] Error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// ─── GET /intelligence/total-ads-count ──────────────────────────────────────
// Query params: type (1=keyword, 2=advertiser, 3=domain), period (today|all)
// Returns: total ads count for all items of given type with per-platform breakdown
// ─────────────────────────────────────────────────────────────────────────────

async function getTotalAdsCount(req, elastic, logger, mongo) {
  try {
    const collection = getKeywordSearchesCollection(mongo);
    if (!collection) {
      return { code: 500, message: 'MongoDB not available' };
    }

    const { type = 1, fetch_ads_count = true, period = 'total', limit = 1000 } = req.query;
    const typeNum = Number(type);
    const maxKeywords = Math.min(5000, Math.max(100, Number(limit)));
    const shouldFetchAdsCount = fetch_ads_count === 'true' || fetch_ads_count === true;

    logger?.info?.('[getTotalAdsCount] API called with: type=' + typeNum + ', fetch_ads_count=' + shouldFetchAdsCount + ', period=' + period + ', limit=' + maxKeywords);

    if (![1, 2, 3].includes(typeNum)) {
      return { code: 400, message: 'Invalid type. Use: 1 (keyword), 2 (advertiser), or 3 (domain)' };
    }

    const aggregationPipeline = [
      {
        $match: {
          type: typeNum,
          users: { $ne: null },
          scrapping_status: { $exists: true, $ne: [] }
        }
      },
      {
        $unwind: "$scrapping_status"
      },
      {
        $group: {
          _id: {
            network: "$scrapping_status.network",
            keyword: "$value"
          },
          keyword: { $first: "$value" },
          scrappingHistory: {
            $push: {
              startTime: {
                $dateToString: {
                  format: "%Y-%m-%d %H:%M:%S",
                  date: "$scrapping_status.startTime"
                }
              },
              endTime: {
                $dateToString: {
                  format: "%Y-%m-%d %H:%M:%S",
                  date: "$scrapping_status.endTime"
                }
              }
            }
          }
        }
      },
      {
        $sort: {
          "_id.network": 1,
          "_id.keyword": 1
        }
      },
      {
        $group: {
          _id: "$_id.network",
          keywords: {
            $push: {
              keyword: "$keyword",
              scrappingHistory: "$scrappingHistory"
            }
          }
        }
      },
      {
        $sort: { _id: 1 }
      },
      {
        $project: {
          _id: 1,
          keywords: {
            $slice: ["$keywords", 0, maxKeywords]
          }
        }
      }
    ];

    const aggregation = collection.aggregate(aggregationPipeline);

    const results = await aggregation.toArray();

    if (results.length === 0) {
      return {
        code: 200,
        data: {
          type: typeNum,
          type_label: typeNum === 1 ? 'keywords' : typeNum === 2 ? 'advertisers' : 'domains',
          by_platform: {}
        }
      };
    }

    const platformKeywordMap = {};
    for (const result of results) {
      platformKeywordMap[result._id] = result.keywords;
    }

    let finalResults = platformKeywordMap;

    if (shouldFetchAdsCount && elastic) {
      const { fetchAdsCountForKeywordsByPlatform } = require('../queries/searchIntelligenceQueries');
      logger?.info?.('[getTotalAdsCount] shouldFetchAdsCount:', shouldFetchAdsCount, 'elastic available:', !!elastic);
      logger?.info?.('[getTotalAdsCount] Fetching ads count from Elasticsearch...');
      const t1 = Date.now();
      finalResults = await fetchAdsCountForKeywordsByPlatform(elastic, platformKeywordMap, logger);
      const t2 = Date.now();
      logger?.info?.('[getTotalAdsCount] Elasticsearch ads count fetch completed in', t2 - t1, 'ms');
      logger?.info?.('[getTotalAdsCount] Final results sample:', JSON.stringify(finalResults['facebook']?.slice(0, 1)));
    }

    const typeLabel = typeNum === 1 ? 'keywords' : typeNum === 2 ? 'advertisers' : 'domains';

    const summaryStats = {
      total_ads_count: 0,
      today_ads_count: 0,
      platform_wise_counts: {}
    };

    if (shouldFetchAdsCount && elastic) {
      const todayDateStr = new Date().toISOString().split('T')[0];

      for (const [platform, keywords] of Object.entries(finalResults)) {
        let platformTotal = 0;
        let platformToday = 0;

        for (const keyword of keywords) {
          if (keyword.history_with_counts && Array.isArray(keyword.history_with_counts)) {
            for (const run of keyword.history_with_counts) {
              const runDate = run.startTime?.split(' ')[0];
              const adsCount = run.ads_count || 0;

              platformTotal += adsCount;
              if (runDate === todayDateStr) {
                platformToday += adsCount;
              }
            }
          }
        }

        summaryStats.platform_wise_counts[platform] = {
          total: platformTotal,
          today: platformToday
        };

        summaryStats.total_ads_count += platformTotal;
        summaryStats.today_ads_count += platformToday;
      }
    }


    const response = {
      code: 200,
      data: {
        type: typeNum,
        type_label: typeLabel,
        summary: shouldFetchAdsCount ? summaryStats : null
      }
    };

    if (shouldFetchAdsCount) {
      response.data.by_platform = finalResults;
    }

    logger?.info?.('[getTotalAdsCount] Response ready. Summary stats:', summaryStats);

    return response;
  } catch (err) {
    logger?.error?.('[getTotalAdsCount] Error:', err);
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
        { term: { 'method.keyword': 'add_member'        } },
        { term: { 'method.keyword': 'delete_member'     } },
        { term: { 'method.keyword': 'export_competitors'} },
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

      // Derive project_type and method
      let projectType = s['project_type'] ?? null;
      const method = s['method'] ?? null;

      if (!projectType) {
        if (method === 'add_member')                   projectType = 'add_member';
        else if (method === 'delete_member')          projectType = 'delete_member';
        else if (method === 'export_competitors')     projectType = 'export_competitors';
        else if (s['deleted_Advertisers'])            projectType = 'delete_brand';
        else if (s['monitoring_status'] !== undefined) projectType = 'monitoring_status';
        else if (s['project_name'] && s['competitors']) projectType = 'project_click';
        else if (s['brand'] || s['advertiser'])       projectType = 'competitor_comparison';
        else if (s['dashboard_Advertisers'] || s['dashboard_advertisers']) projectType = 'dashboard';
        else                                          projectType = 'other';
      }

      const dashAdv = s['dashboard_Advertisers']
        ?? s['dashboard_advertisers']
        ?? s['dashboardAdvertisers']
        ?? s?.dashboard?.Advertisers
        ?? s?.dashboard?.advertisers
        ?? null;

      let brands = null;
      let competitors = null;
      let memberName = null;
      let memberEmail = null;
      let exportedCompetitors = null;

      if (projectType === 'add_member') {
        memberName = s['member_name'] ?? null;
        memberEmail = s['member_email'] ?? null;
      } else if (projectType === 'delete_member') {
        memberName = s['delete_member_name'] ?? null;
        memberEmail = s['delete_member_email'] ?? null;
      } else if (projectType === 'export_competitors') {
        exportedCompetitors = s['exported_Competitors'] ?? null;
      } else if (projectType === 'delete_brand') {
        const del = s['deleted_Advertisers'];
        if (del) brands = Array.isArray(del) ? del.join(', ') : String(del);
      } else if (projectType === 'monitoring_status') {
        if (s['project_name']) brands      = String(s['project_name']);
        if (s['advertiser'])   competitors = Array.isArray(s['advertiser']) ? s['advertiser'].join(', ') : String(s['advertiser']);
      } else if (projectType === 'project_click') {
        if (s['project_name']) brands = String(s['project_name']);
        if (s['competitors'])  competitors = Array.isArray(s['competitors']) ? s['competitors'].join(', ') : String(s['competitors']);
      } else if (projectType === 'competitor_comparison') {
        if (s['brand'])      brands      = Array.isArray(s['brand'])      ? s['brand'].join(', ')      : String(s['brand']);
        if (s['advertiser']) competitors = Array.isArray(s['advertiser']) ? s['advertiser'].join(', ') : String(s['advertiser']);
      } else if (projectType === 'dashboard') {
        if (dashAdv) brands = Array.isArray(dashAdv) ? dashAdv.join(', ') : String(dashAdv);
      }

      return {
        _id:               h._id,
        timestamp:         dateStr,
        user_id:           uid,
        email,
        project_type:      projectType,
        method:            method,
        monitoring_status: projectType === 'monitoring_status' ? (s['monitoring_status'] ?? null) : undefined,
        brands,
        competitors,
        member_name:       memberName,
        member_email:      memberEmail,
        delete_member_name: s['delete_member_name'] ?? null,
        delete_member_email: s['delete_member_email'] ?? null,
        exported_Competitors: exportedCompetitors,
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
    logger?.error?.('[keyword_Trend_ProjectController] getProjectActivity error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

// ─── GET /intelligence/top-keywords ─────────────────────────────────────────
// Fetch top 10 keywords based on search count from Elasticsearch user_activities
// Returns: array of top 10 keywords sorted by search count descending
// ─────────────────────────────────────────────────────────────────────────────

async function getTopKeywords(req, elastic, logger) {
  try {
    if (!elastic) return { code: 500, message: 'Elasticsearch client not available' };

    const { type = 'keyword' } = req.query; // keyword, advertiser, or domain

    // Map type to the corresponding field
    const fieldMap = {
      'keyword': 'search.keyword.keyword',
      'advertiser': 'search.advertiser.keyword',
      'domain': 'search.domain.keyword',
    };

    const field = fieldMap[type];
    if (!field) {
      return { code: 400, message: 'Invalid type. Use: keyword, advertiser, or domain' };
    }

    const response = await elastic.search({
      index: 'user_activities',
      body: {
        size: 0,
        query: {
          bool: {
            filter: [
              { exists: { field: field } }
            ]
          }
        },
        aggs: {
          top_items: {
            terms: {
              field: field,
              size: 10,
              order: { _count: 'desc' }
            }
          }
        }
      }
    });

    const buckets = getAggs(response)?.top_items?.buckets || [];

    const topItems = buckets.map((bucket) => ({
      [type]: bucket.key,
      searchCount: bucket.doc_count,
    })).filter(item => item[type] && item[type] !== 'null');


    return {
      code: 200,
      data: {
        items: topItems,
      },
      meta: {
        total: topItems.length,
        type: type,
      },
    };
  } catch (err) {
    logger?.error?.('[getTopKeywords] Error:', err);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}


// ─── GET /intelligence/summary-stats ────────────────────────────────────────
// Fetch all summary statistics in one optimized MongoDB aggregation
// Query params: type (keyword|advertiser|domain), date_range (today|all)
// Returns: total, completed_scraping, under_scraping, not_went_scrapping counts
// ─────────────────────────────────────────────────────────────────────────────

async function getSummaryStats(req, elastic, logger, mongo) {
  try {
    const collection = getKeywordSearchesCollection(mongo);
    if (!collection) {
      return { code: 500, message: 'MongoDB not available' };
    }

    const { type = 'keyword', date_range = 'all' } = req.query;

    // Map type string to typeNum (1=keyword, 2=advertiser, 3=domain)
    const typeMap = {
      'keyword': 1,
      'advertiser': 2,
      'domain': 3,
    };

    const typeNum = typeMap[type];
    if (typeNum === undefined) {
      return { code: 400, message: 'Invalid type. Use: keyword, advertiser, or domain' };
    }

    // Build date filter for today
    let dateFilter = {};
    if (date_range === 'today') {
      const now = new Date();
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      dateFilter = { createdAt: { $gte: startOfDay, $lt: endOfDay } };
    }

    // Single aggregation pipeline with $facet for parallel calculation
    const pipeline = [
      {
        $match: {
          type: typeNum,
          users: { $ne: null },
          ...dateFilter,
        }
      },
      {
        $facet: {
          // Total count of all keywords
          total_count: [
            { $count: 'count' }
          ],

          // Completed scraping: documents with scrapping_status containing status="completed"
          completed_scraping: [
            {
              $match: {
                'scrapping_status': { $exists: true, $not: { $size: 0 } },
                'scrapping_status.status': 'completed'
              }
            },
            { $count: 'count' }
          ],

          // Under scraping: documents with scrapping_status having startTime but no endTime
          under_scraping: [
            {
              $match: {
                'scrapping_status': { $exists: true, $not: { $size: 0 } }
              }
            },
            {
              $addFields: {
                has_running: {
                  $anyElementTrue: {
                    $map: {
                      input: '$scrapping_status',
                      as: 'status',
                      in: {
                        $and: [
                          { $ifNull: ['$$status.startTime', false] },
                          { $not: ['$$status.endTime'] }
                        ]
                      }
                    }
                  }
                }
              }
            },
            {
              $match: { has_running: true }
            },
            { $count: 'count' }
          ],

          // Not went for scrapping: documents without scrapping_status
          not_went_scrapping: [
            {
              $match: {
                $or: [
                  { 'scrapping_status': { $exists: false } },
                  { 'scrapping_status': { $size: 0 } }
                ]
              }
            },
            { $count: 'count' }
          ],

          // Failed scraping: documents with scrapping_status containing status="failed"
          failed_scraping: [
            {
              $match: {
                'scrapping_status': {
                  $elemMatch: {
                    status: 'failed'
                  }
                }
              }
            },
            { $count: 'count' }
          ]
        }
      }
    ];

   
    const result = await collection.aggregate(pipeline).toArray();
   
    // Always fetch BOTH today and all-time data
    const now = new Date();
    const todayDateStr = now.toISOString().split('T')[0]; // e.g., "2026-06-19"

    // Fetch today's stats - count keywords with scraping activity TODAY
    const todayPipeline = [
      {
        $match: {
          type: typeNum,
          users: { $ne: null }
        }
      },
      {
        $facet: {
          // Total keywords (created or searched today)
          total_count: [
            {
              $match: {
                $or: [
                  { createdAt: { $gte: new Date(todayDateStr + 'T00:00:00Z') } },
                  { 'searchDates': { $elemMatch: { $gte: new Date(todayDateStr + 'T00:00:00Z') } } }
                ]
              }
            },
            { $count: 'count' }
          ],
          // Today: completed scraping today
          completed_scraping: [
            {
              $match: {
                'scrapping_status': {
                  $elemMatch: {
                    status: 'completed',
                    date: todayDateStr
                  }
                }
              }
            },
            { $count: 'count' }
          ],
          // Today: currently under scrapping today
          under_scraping: [
            {
              $match: {
                'scrapping_status': {
                  $elemMatch: {
                    date: todayDateStr,
                    startTime: { $exists: true },
                    endTime: { $exists: false }
                  }
                }
              }
            },
            { $count: 'count' }
          ],
          // Today: searched today but never went for scrapping
          not_went_scrapping: [
            {
              $match: {
                'searchDates': {
                  $elemMatch: { $gte: new Date(todayDateStr + 'T00:00:00Z') }
                },
                $or: [
                  { 'scrapping_status': { $exists: false } },
                  { 'scrapping_status': { $size: 0 } }
                ]
              }
            },
            { $count: 'count' }
          ],

          // Today: failed scraping today
          failed_scraping: [
            {
              $match: {
                'scrapping_status': {
                  $elemMatch: {
                    status: 'failed',
                    date: todayDateStr
                  }
                }
              }
            },
            { $count: 'count' }
          ]
        }
      }
    ];

    const todayResult = await collection.aggregate(todayPipeline).toArray();
    const todayFacets = todayResult[0] || {};
    const allFacets = result[0] || {};

    // Extract today's counts
    const todayTotal = todayFacets.total_count?.[0]?.count || 0;
    const todayCompleted = todayFacets.completed_scraping?.[0]?.count || 0;
    const todayUnderScraping = todayFacets.under_scraping?.[0]?.count || 0;
    const todayNotWent = todayFacets.not_went_scrapping?.[0]?.count || 0;
    const todayFailed = todayFacets.failed_scraping?.[0]?.count || 0;

    // Extract all-time counts
    const allTotal = allFacets.total_count?.[0]?.count || 0;
    const allCompleted = allFacets.completed_scraping?.[0]?.count || 0;
    const allUnderScraping = allFacets.under_scraping?.[0]?.count || 0;
    const allNotWent = allFacets.not_went_scrapping?.[0]?.count || 0;
    const allFailed = allFacets.failed_scraping?.[0]?.count || 0;



    return {
      code: 200,
      data: {
        // Today's metrics
        today_total: todayTotal,
        today_completed_scraping: todayCompleted,
        today_under_scraping: todayUnderScraping,
        today_not_went_scrapping: todayNotWent,
        today_failed_scraping: todayFailed,

        // All time metrics
        total: allTotal,
        completed_scraping: allCompleted,
        under_scraping: allUnderScraping,
        not_went_scrapping: allNotWent,
        failed_scraping: allFailed
      },
      meta: {
        date_range: 'all_and_today',
        type: type,
      },
    };
  } catch (err) {
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}


module.exports = {
  getKeywordTrends,
  getProjectActivity,
  getTopKeywords,
  getSummaryStats,
  getTotalAdsCount,
  getItemsList,
};

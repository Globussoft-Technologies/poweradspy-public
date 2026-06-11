'use strict';

const EXCLUDED_FIELDS = new Set([
  'user.id', 'user.SubscriptionType', 'user.userSubscriptionType',
  'user.username', 'user.email', 'user.type',
]);

const EXCLUDED_VALUES = new Set(['NA', null, 'null']);

function yesterdayRange() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  return {
    fromTs: Math.floor(new Date(`${yStr}T00:00:00`).getTime() / 1000),
    toTs:   Math.floor(new Date(`${yStr}T23:59:59`).getTime() / 1000),
  };
}

function parseDateRange(req) {
  const src = req.method === 'POST' ? req.body : req.query;
  const { from_date, to_date } = src;
  const def = yesterdayRange();
  // dateTime in ES is stored as Unix seconds (sort values are ms but field is seconds)
  const fromTs = from_date ? Math.floor(new Date(from_date).getTime() / 1000) : def.fromTs;
  const toTs   = to_date   ? Math.floor(new Date(to_date).getTime()   / 1000) : def.toTs;
  return { fromTs, toTs };
}

function getElasticHits(result) {
  const hits = result.hits ?? result.body?.hits ?? {};
  return {
    total: hits.total?.value ?? hits.total ?? 0,
    hits:  hits.hits ?? [],
  };
}

function getAggs(result) {
  return result.aggregations ?? result.body?.aggregations ?? {};
}

function buildSearchAfterParam(lastHit) {
  return JSON.stringify([lastHit.sort[0], lastHit._id]);
}

function filterDoc(source, excludeExtraFields = []) {
  const doc = {};
  const allExcluded = new Set([...EXCLUDED_FIELDS, ...excludeExtraFields]);
  for (const [field, value] of Object.entries(source)) {
    if (!allExcluded.has(field) && !EXCLUDED_VALUES.has(value)) {
      doc[field] = value;
    }
  }
  return doc;
}

// ─── get-keywords ──────────────────────────────────────────────────────────────

async function getKeywords(req, elastic, logger) {
  try {
    const src = req.method === 'POST' ? req.body : req.query;
    const { user_id, size = 10, search_after, search_term } = src;
    const { fromTs, toTs } = parseDateRange(req);

    const must = [{ match: { 'user.id': user_id } }];
    const filter = [
      { exists: { field: 'search.keyword' } },
      { bool: { must_not: [{ match: { 'search.keyword': 'NA' } }] } },
    ];

    if (search_term) must.push({ match: { 'search.keyword': search_term } });
    filter.push({ range: { dateTime: { gte: fromTs, lte: toTs } } });

    const body = {
      query: { bool: { must, filter } },
      sort: [{ dateTime: { order: 'desc' } }, { _id: { order: 'desc' } }],
      size: Number(size),
    };
    if (search_after) body.search_after = JSON.parse(search_after);

    const result = await elastic.search({
      index: 'user_activities',
      body,
      _source: [
        'search.keyword', 'network', 'adsCountOnSerach', 'dateTime',
        'filter.*', 'search_by.*', 'lander.*',
        'dashboard.likes', 'dashboard.comments', 'dashboard.shares',
        'dashboard.post_date', 'dashboard.ad_seen', 'domain_date_btn_sort',
      ],
    });

    const { total, hits } = getElasticHits(result);
    if (!hits.length) return { code: 404, message: 'There is no activity from the user' };

    const lastHit = hits[hits.length - 1];
    const filteredData = [];

    for (const hit of hits) {
      const source = hit._source;
      if (!source['search.keyword'] || source['search.keyword'] === 'NA' || !source.network) continue;

      const doc = filterDoc(source, ['search.advertiser', 'search.domain', 'dateTime']);
      if (source['search.keyword']) {
        doc.search_keyword = source['search.keyword'];
        delete doc['search.keyword'];
      }
      if (!('adsCountOnSerach' in doc)) doc.adsCountOnSerach = '-';
      doc.adsCount = doc.adsCountOnSerach;
      filteredData.push(doc);
    }

    return {
      code:         200,
      message:      'Data retrieved successfully',
      count:        filteredData.length,
      totalCount:   total,
      search_after: buildSearchAfterParam(lastHit),
      data:         filteredData,
    };
  } catch (err) {
    logger.error('Error in getKeywords', { error: err.message });
    return { code: 401, message: `Error occurred in getKeywords: ${err.message}` };
  }
}

// ─── get-advertiser ────────────────────────────────────────────────────────────

async function getAdvertiser(req, elastic, logger) {
  try {
    const src = req.method === 'POST' ? req.body : req.query;
    const { user_id, size = 10, search_after, search_term } = src;
    const { fromTs, toTs } = parseDateRange(req);

    const must = [{ match: { 'user.id': user_id } }];
    const filter = [
      { exists: { field: 'search.advertiser' } },
      { bool: { must_not: [{ match: { 'search.advertiser': 'NA' } }] } },
    ];

    if (search_term) must.push({ match: { 'search.advertiser': search_term } });
    filter.push({ range: { dateTime: { gte: fromTs, lte: toTs } } });

    const body = {
      query: { bool: { must, filter } },
      sort: [{ dateTime: { order: 'desc' } }, { _id: { order: 'desc' } }],
      size: Number(size),
    };
    if (search_after) body.search_after = JSON.parse(search_after);

    const result = await elastic.search({
      index: 'user_activities',
      body,
      _source: [
        'search.advertiser', 'network', 'adsCountOnSerach', 'dateTime',
        'filter.*', 'search_by.*', 'lander.*',
        'dashboard.likes', 'dashboard.comments', 'dashboard.shares',
        'dashboard.post_date', 'dashboard.ad_seen', 'domain_date_btn_sort',
      ],
    });

    const { total, hits } = getElasticHits(result);
    if (!hits.length) return { code: 404, message: 'There is no activity from the user' };

    const lastHit = hits[hits.length - 1];
    const filteredData = [];

    for (const hit of hits) {
      const source = hit._source;
      if (!source['search.advertiser'] || source['search.advertiser'] === 'NA' || !source.network) continue;

      const doc = filterDoc(source, ['search.keyword', 'search.domain', 'dateTime']);
      if (source['search.advertiser']) {
        doc.search_advertiser = source['search.advertiser'];
        delete doc['search.advertiser'];
      }
      if (!('adsCountOnSerach' in doc)) doc.adsCountOnSerach = '-';
      doc.adsCount = doc.adsCountOnSerach;
      filteredData.push(doc);
    }

    return {
      code:         200,
      message:      'Data retrieved successfully',
      count:        filteredData.length,
      totalCount:   total,
      search_after: buildSearchAfterParam(lastHit),
      data:         filteredData,
    };
  } catch (err) {
    logger.error('Error in getAdvertiser', { error: err.message });
    return { code: 401, message: `Error occurred in getAdvertiser: ${err.message}` };
  }
}

// ─── get-domain ────────────────────────────────────────────────────────────────

async function getDomain(req, elastic, logger) {
  try {
    const src = req.method === 'POST' ? req.body : req.query;
    const { user_id, size = 10, search_after, search_term } = src;
    const { fromTs, toTs } = parseDateRange(req);

    const must = [{ match: { 'user.id': user_id } }];
    const filter = [
      { exists: { field: 'search.domain' } },
      { bool: { must_not: [{ match: { 'search.domain': 'NA' } }] } },
    ];

    if (search_term) must.push({ match: { 'search.domain': search_term } });
    filter.push({ range: { dateTime: { gte: fromTs, lte: toTs } } });

    const body = {
      query: { bool: { must, filter } },
      sort: [{ dateTime: { order: 'desc' } }, { _id: { order: 'desc' } }],
      size: Number(size),
    };
    if (search_after) body.search_after = JSON.parse(search_after);

    const result = await elastic.search({
      index: 'user_activities',
      body,
      _source: [
        'search.domain', 'network', 'adsCountOnSerach', 'dateTime',
        'filter.*', 'search_by.*', 'lander.*',
        'dashboard.likes', 'dashboard.comments', 'dashboard.shares',
        'dashboard.post_date', 'dashboard.ad_seen', 'domain_date_btn_sort',
      ],
    });

    const { total, hits } = getElasticHits(result);
    if (!hits.length) return { code: 404, message: 'There is no activity from the user' };

    const lastHit = hits[hits.length - 1];
    const filteredData = [];

    for (const hit of hits) {
      const source = hit._source;
      if (!source['search.domain'] || source['search.domain'] === 'NA' || !source.network) continue;

      const doc = filterDoc(source, ['search.advertiser', 'search.keyword', 'dateTime']);
      if (source['search.domain']) {
        doc.search_domain = source['search.domain'];
        delete doc['search.domain'];
      }
      if (!('adsCountOnSerach' in doc)) doc.adsCountOnSerach = '-';
      doc.adsCount = doc.adsCountOnSerach;
      filteredData.push(doc);
    }

    return {
      code:         200,
      message:      'Data retrieved successfully',
      count:        filteredData.length,
      totalCount:   total,
      search_after: buildSearchAfterParam(lastHit),
      data:         filteredData,
    };
  } catch (err) {
    logger.error('Error in getDomain', { error: err.message });
    return { code: 401, message: `Error occurred in getDomain: ${err.message}` };
  }
}

// ─── get-projects ──────────────────────────────────────────────────────────────

async function getProjects(req, elastic, logger) {
  try {
    const src = req.method === 'POST' ? req.body : req.query;
    const { user_id, size = 10, search_after } = src;
    const { fromTs, toTs } = parseDateRange(req);

    const must = [
      { match: { 'user.id': user_id } },
      { match: { network: 'Project' } },
    ];
    const filter = [{ range: { dateTime: { gte: fromTs, lte: toTs } } }];

    const body = {
      query: { bool: { must, filter } },
      sort: [{ dateTime: { order: 'desc' } }, { _id: { order: 'desc' } }],
      size: Number(size),
    };
    if (search_after) body.search_after = JSON.parse(search_after);

    const result = await elastic.search({
      index: 'user_activities',
      body,
      _source: [
        'network', 'project_name', 'project_type', 'competitors',
        'brand', 'advertiser', 'dashboard_Advertisers', 'dateTime',
      ],
    });

    const { total, hits } = getElasticHits(result);
    if (!hits.length) return { code: 404, message: 'There is no activity from the user' };

    const lastHit = hits[hits.length - 1];
    const projectExclude = new Set([
      'user.id', 'user.SubscriptionType', 'user.userSubscriptionType',
      'userSubscriptionType', 'user.username', 'user.email', 'user.type', 'dateTime',
    ]);

    const filteredData = hits.map(hit => {
      const source = hit._source;
      const doc = {};
      for (const [field, value] of Object.entries(source)) {
        if (!projectExclude.has(field) && value !== null && value !== 'null') {
          doc[field] = value;
        }
      }

      if (source.dateTime) {
        doc.date = new Date(source.dateTime * 1000).toISOString().slice(0, 10);
      }

      if ('competitors' in source) {
        doc.project_type = 'project_click';
      } else if ('brand' in source || 'advertiser' in source) {
        doc.project_type = 'competitor_comparison';
      } else if ('dashboard_Advertisers' in source) {
        doc.project_type = 'dashboard';
      } else {
        doc.project_type = 'other';
      }

      return doc;
    });

    return {
      code:         200,
      message:      'Data retrieved successfully',
      count:        filteredData.length,
      totalCount:   total,
      search_after: buildSearchAfterParam(lastHit),
      data:         filteredData,
    };
  } catch (err) {
    logger.error('Error in getProjects', { error: err.message });
    return { code: 401, message: `Error occurred in getProjects: ${err.message}` };
  }
}

// ─── get-all-searches ──────────────────────────────────────────────────────────

async function getAllSearches(req, elastic, logger) {
  try {
    const src = req.method === 'POST' ? req.body : req.query;
    const { user_id, size = 10, search_after } = src;
    const { fromTs, toTs } = parseDateRange(req);

    const must = [{ match: { 'user.id': user_id } }];
    const filter = [
      { range: { dateTime: { gte: fromTs, lte: toTs } } },
    ];
    const must_not = [
      { match: { network: 'Project' } },
      { exists: { field: 'search.keyword' } },
      { exists: { field: 'search.advertiser' } },
      { exists: { field: 'search.domain' } },
    ];

    const body = {
      query: { bool: { must, filter, must_not } },
      sort: [{ dateTime: { order: 'desc' } }, { _id: { order: 'desc' } }],
      size: Number(size),
    };
    if (search_after) body.search_after = JSON.parse(search_after);

    const result = await elastic.search({
      index: 'user_activities',
      body,
      _source: true,
    });

    const { total, hits } = getElasticHits(result);
    if (!hits.length) return { code: 404, message: 'There is no activity from the user' };

    const lastHit = hits[hits.length - 1];
    const allSearchExclude = new Set([
      'user.id', 'user.SubscriptionType', 'user.userSubscriptionType',
      'user.username', 'user.email', 'user.type',
    ]);

    const data = hits.map(hit => {
      const source = hit._source;
      const doc = { _id: hit._id };
      for (const [field, value] of Object.entries(source)) {
        if (!allSearchExclude.has(field) && !EXCLUDED_VALUES.has(value)) {
          if (field === 'dateTime') {
            doc.date = new Date(value * 1000).toISOString().replace('T', ' ').slice(0, 19);
          } else {
            doc[field] = value;
          }
        }
      }
      if (!('adsCountOnSerach' in doc)) doc.adsCountOnSerach = '-';
      doc.adsCount = doc.adsCountOnSerach;
      return doc;
    });

    return {
      code:         200,
      message:      'Data retrieved successfully',
      user_id,
      totalCount:   total,
      search_after: buildSearchAfterParam(lastHit),
      data,
    };
  } catch (err) {
    logger.error('Error in getAllSearches', { error: err.message });
    return { code: 401, message: `Error occurred in getAllSearches: ${err.message}` };
  }
}

// ─── get-search-counts ─────────────────────────────────────────────────────────

async function getSearchCounts(req, elastic, logger) {
  try {
    const { user_id } = req.method === 'POST' ? req.body : req.query;

    const result = await elastic.search({
      index: 'user_activities',
      body: {
        size: 0,
        query: { bool: { must: [{ match: { 'user.id': user_id } }] } },
        aggs: {
          unique_advertisers:  { cardinality: { field: 'search.advertiser.keyword' } },
          unique_keyword:      { cardinality: { field: 'search.keyword.keyword' } },
          unique_domain:       { cardinality: { field: 'search.domain.keyword' } },
          unique_competitors:  { cardinality: { field: 'competitors.keyword' } },
        },
      },
    });

    const aggs = getAggs(result);
    return {
      code:            200,
      advertiserCount: aggs.unique_advertisers?.value  ?? 0,
      keywordCount:    aggs.unique_keyword?.value       ?? 0,
      domainCount:     aggs.unique_domain?.value        ?? 0,
      competitorCount: aggs.unique_competitors?.value   ?? 0,
    };
  } catch (err) {
    logger.error('Error in getSearchCounts', { error: err.message });
    return { code: 400, message: `Error occurred in getSearchCounts: ${err.message}` };
  }
}

module.exports = { getKeywords, getAdvertiser, getDomain, getProjects, getAllSearches, getSearchCounts };

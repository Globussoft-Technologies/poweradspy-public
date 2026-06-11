'use strict';

const config = require('../../../config');
const databaseManager = require('../../../database/DatabaseManager');
const https = require('https');
const http = require('http');

const ELASTIC_FALLBACK_NETWORKS = ['facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'pinterest', 'quora', 'native', 'gdn', 'google'];

function getElastic(db) {
  if (db && db.elastic) return db.elastic;
  for (const slug of ELASTIC_FALLBACK_NETWORKS) {
    const elastic = databaseManager.getElastic(slug);
    if (elastic) return elastic;
  }
  return null;
}

const CACHE_TTL_MS   = 5 * 60 * 1000;   // 5 min — amember counts + ES logged-in-today
const TOTAL_DOCS_TTL = 60 * 60 * 1000;  // 1 hr  — full-index doc count (changes slowly)

let cache = null;
let cacheTsMs = 0;
let totalDocsCache = null;
let totalDocsTsMs  = 0;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}

async function fetchAmemberCounts() {
  const apiUrl = config.amember.apiUrl || process.env.AMEMBER_API_URL;
  const apiKey = config.amember.apiKey || process.env.AMEMBER_API_KEY;

  if (!apiUrl || !apiKey) {
    return { 1: 0, 2: 0, 0: 0 };
  }

  const base = `${apiUrl}users?_key=${apiKey}&_filter[status]=`;
  const [active, expired, pending] = await Promise.all([
    fetchUrl(base + '1'),
    fetchUrl(base + '2'),
    fetchUrl(base + '0'),
  ]);
  return {
    1: active._total  ?? 0,
    2: expired._total ?? 0,
    0: pending._total ?? 0,
  };
}

async function fetchLoggedInToday(elastic) {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const result = await elastic.search({
    index: 'user_activities',
    body: {
      size: 0,
      query: {
        range: {
          dateTime: {
            gte: Math.floor(start.getTime() / 1000),
            lte: Math.floor(end.getTime() / 1000),
          },
        },
      },
      aggs: {
        logged_in_today:  { cardinality: { field: 'user.id' } },
        total_activities: { value_count:  { field: '_id' } },
      },
    },
  });

  const aggs = result.aggregations || result.body?.aggregations || {};
  return {
    loggedInTodayCount:   aggs.logged_in_today?.value  ?? 0,
    totalActivitiesCount: aggs.total_activities?.value ?? 0,
  };
}

async function fetchTopUsers(elastic) {
  const now            = new Date();
  const lastMonthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  lastMonthStart.setHours(0, 0, 0, 0);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const result = await elastic.search({
    index: 'user_activities',
    body: {
      size: 0,
      query: {
        range: {
          dateTime: {
            gte: Math.floor(lastMonthStart.getTime() / 1000),
            lte: Math.floor(lastMonthEnd.getTime() / 1000),
          },
        },
      },
      aggs: {
        users_doc_count: {
          terms: { field: 'user.id', size: 10000, order: { _count: 'desc' } },
        },
        active_users_last_month: {
          cardinality: { field: 'user.id' },
        },
      },
    },
  });

  const aggs   = result.aggregations || result.body?.aggregations || {};
  const buckets = aggs.users_doc_count?.buckets ?? [];
  const activeUsersLastMonth = aggs.active_users_last_month?.value ?? 0;

  if (!buckets.length) {
    return { maxSearchCount: 0, minThreshold: 0, topUsersCount: 0, topUsers: [], allUsersDocCount: [], activeUsersLastMonth };
  }

  const maxSearchCount = buckets[0].doc_count;
  const magnitude      = Math.pow(10, Math.floor(Math.log10(maxSearchCount)));
  const minThreshold   = (Math.floor(maxSearchCount / magnitude) - 1) * magnitude;

  const topUsers         = [];
  const allUsersDocCount = [];

  for (const bucket of buckets) {
    allUsersDocCount.push({ user_id: bucket.key, doc_count: bucket.doc_count });
    if (bucket.doc_count >= minThreshold) {
      topUsers.push({ user_id: bucket.key, searchCount: bucket.doc_count });
    }
  }

  return { maxSearchCount, minThreshold, topUsersCount: topUsers.length, topUsers, allUsersDocCount, activeUsersLastMonth };
}

async function fetchTotalDocCount(elastic) {
  const result = await elastic.count({ index: 'user_activities' });
  return result.count ?? result.body?.count ?? 0;
}

async function getUsersCount(req, db, logger) {
  const elastic = getElastic(db);
  if (!elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  try {
    const nowMs = Date.now();

    // --- cached bundle (amember + today's ES aggs + top-users) ---
    if (!cache || nowMs - cacheTsMs > CACHE_TTL_MS) {
      const [counts, todayAggs, topUsersData] = await Promise.all([
        fetchAmemberCounts(),
        fetchLoggedInToday(elastic),
        fetchTopUsers(elastic),
      ]);
      cache = { counts, ...todayAggs, ...topUsersData };
      cacheTsMs = nowMs;
    }

    // --- total doc count (slower-changing, 1-hr cache) ---
    if (!totalDocsCache || nowMs - totalDocsTsMs > TOTAL_DOCS_TTL) {
      totalDocsCache = await fetchTotalDocCount(elastic);
      totalDocsTsMs  = nowMs;
    }

    const { counts } = cache;

    return {
      code:                 200,
      message:              'User counts fetched successfully',
      activeUsersCount:     counts[1],
      expireUsersCount:     counts[2],
      pendingUserCount:     counts[0],
      loggedInTodayCount:   cache.loggedInTodayCount,
      totalActivitiesCount: totalDocsCache,
      maxSearchCount:       cache.maxSearchCount,
      minThreshold:         cache.minThreshold,
      topUsersCount:        cache.topUsersCount,
      topUsers:             cache.topUsers,
      allUsersDocCount:     cache.allUsersDocCount,
      activeUsersLastMonth: cache.activeUsersLastMonth,
    };
  } catch (err) {
    console.log('Error in getUsersCount:', err);
    logger.error('Error in getUsersCount', { error: err.message });
    return { code: 400, message: `Error occurred in getUsersCount: ${err.message}` };
  }
}

module.exports = { getUsersCount };

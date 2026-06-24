'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware, generateToken } = require('../../../middleware/auth');
const databaseManager = require('../../../database/DatabaseManager');
const { getAllSearches, getFilterOptions, getSummaryStats: getSearchesSummaryStats } = require('../controllers/userActivitySearchController');
const { getIntelligenceStats, getTopUsers, purgeOldActivities, getKeywordScrapingHistory } = require('../controllers/searchIntelligenceController');
const { getKeywordTrends, getProjectActivity, getTopKeywords, getSummaryStats: getTrendsSummaryStats, getTotalAdsCount, getItemsList } = require('../controllers/keyword_Trend_ProjectController');

const ELASTIC_FALLBACK_NETWORKS = ['facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'pinterest', 'quora', 'native', 'gdn', 'google'];
const MONGO_FALLBACK_NETWORKS = ['user_activity', 'facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'pinterest', 'quora', 'native', 'gdn', 'google', 'tiktok'];

function getElastic(db) {
  // dedicated single user-activity ES connection (shared by frontend + admin)
  const ua = databaseManager.getElastic('user_activity');
  if (ua) return ua;
  if (db && db.elastic) return db.elastic;
  for (const slug of ELASTIC_FALLBACK_NETWORKS) {
    const elastic = databaseManager.getElastic(slug);
    if (elastic) return elastic;
  }
  return null;
}

function getMongo(db) {
  // dedicated single user-activity Mongo connection (shared by frontend + admin)
  const ua = databaseManager.getMongo('user_activity');
  if (ua) return ua;
  if (db && db.mongo) return db.mongo;
  for (const slug of MONGO_FALLBACK_NETWORKS) {
    const mongo = databaseManager.getMongo(slug);
    if (mongo) return mongo;
  }
  return null;
}

function createAdmin_user_activityRoutes(service) {
  const router = Router();

  // POST /api/v1/admin_user_activity/login
  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { username, password } = req.body;
      const adminUser = process.env.PAS_ADMIN_USERNAME || 'Admin';
      const adminPass = process.env.PAS_ADMIN_PASSWORD || 'Admin@123';
      if (!username || !password || username !== adminUser || password !== adminPass) {
        return res.status(400).json({ code: 400, message: 'Username or password incorrect' });
      }
      const token = generateToken({ user_name: username, role: 'admin' });
      return res.json({ code: 200, message: 'Logged in successfully.', data: { token } });
    })
  );


  // POST /api/v1/admin_user_activity/get-all-searches
  router.post(
    '/get-all-searches',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAllSearches(req, getElastic(service.db), service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/top-users
  // Query params: from_date, to_date, size (default 20), flagged_only (true/false)
  router.get(
    '/intelligence/top-users',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getTopUsers(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/all-searches
  router.get(
    '/intelligence/all-searches',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAllSearches(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/filter-options
  // Returns unique keywords, advertisers, domains, countries, users from last 90 days for autocomplete
  router.get(
    '/intelligence/filter-options',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getFilterOptions(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/summary
  // Returns aggregated summary stats (platforms, pages, filters) for entire filtered result set
  router.get(
    '/intelligence/summary',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getSearchesSummaryStats(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/scraping-history
  // Returns 30-day scraping history for a keyword, advertiser, or domain
  // Query params: keyword, advertiser, domain (at least one required)
  router.get(
    '/intelligence/scraping-history',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getKeywordScrapingHistory(req, getElastic(service.db), service.log, getMongo(service.db));
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/stats
  router.get(
    '/intelligence/stats',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getIntelligenceStats(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/keyword-trends
  // Query params: type (keyword|advertiser|domain|all), sort_by (count|growth), size
  router.get(
    '/intelligence/keyword-trends',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getKeywordTrends(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/top-keywords
  // Fetch top 10 keywords based on search count from user_activities
  router.get(
    '/intelligence/top-keywords',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getTopKeywords(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/summary-stats
  // Fetch all summary statistics (total, completed, under scraping, not went, etc) for Keyword Trends
  router.get(
    '/intelligence/summary-stats',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getTrendsSummaryStats(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/items-list
  // Query params: type (1=keyword, 2=advertiser, 3=domain)
  // Returns: list of all unique items for dropdown filter
  router.get(
    '/intelligence/items-list',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getItemsList(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/total-ads-count
  // Query params: type (1=keyword, 2=advertiser, 3=domain), period (today|all)
  // Returns: total ads count for all items of given type
  router.get(
    '/intelligence/total-ads-count',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getTotalAdsCount(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/intelligence/projects
  // Query params: date_range, from_date, to_date, user, page, size
  router.get(
    '/intelligence/projects',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getProjectActivity(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/purge-old-activities
  // Deletes user_activities docs older than 90 days.
  // Add ?dry_run=true to preview count without deleting.
  router.get(
    '/purge-old-activities',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await purgeOldActivities(req, getElastic(service.db), service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/nas-storage
  // NAS capacity (total/used/free) + per-network storage breakdown + day-over-day growth, for the
  // react_admin "NAS Storage" page. JWT-guarded like the rest of this service (the panel's own
  // login token validates here). Query: ?days=30 (1-150); ?refresh=1 forces a fresh df read.
  router.get(
    '/nas-storage',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const { buildNasReport } = require('../../../insertion/helpers/nasStorageReport');
      const data = await buildNasReport({ days: req.query.days, refresh: req.query.refresh === '1' });
      return res.status(200).json({ code: 200, data });
    })
  );

  return router;
}

module.exports = { createAdmin_user_activityRoutes };

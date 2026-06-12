'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware, generateToken } = require('../../../middleware/auth');
const databaseManager = require('../../../database/DatabaseManager');
const { getUsersCount } = require('../controllers/getUsersCountController');
const { getActiveUsers, getExpiredUsers, getPendingUsers } = require('../controllers/getUsersListController');
const { getKeywords, getAdvertiser, getDomain, getProjects, getAllSearches: getUserActivitySearches, getSearchCounts } = require('../controllers/userActivitySearchController');
const { getIntelligenceStats, getTopUsers, getAllSearches, getKeywordTrends, getProjectActivity, getOtherActivities, purgeOldActivities, getFilterOptions, getSummaryStats } = require('../controllers/searchIntelligenceController');

const ELASTIC_FALLBACK_NETWORKS = ['facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'pinterest', 'quora', 'native', 'gdn', 'google'];

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

  // GET /api/v1/admin_user_activity/get-users-count
  router.get(
    '/get-users-count',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getUsersCount(req, service.db, service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/get-active-users?page=1&size=20
  router.get(
    '/get-active-users',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getActiveUsers(req, service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/get-expired-users?page=1&size=20
  router.get(
    '/get-expired-users',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getExpiredUsers(req, service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // GET /api/v1/admin_user_activity/get-pending-users?page=1&size=20
  router.get(
    '/get-pending-users',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getPendingUsers(req, service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // POST /api/v1/admin_user_activity/get-search-counts
  router.post(
    '/get-search-counts',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getSearchCounts(req, getElastic(service.db), service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // POST /api/v1/admin_user_activity/get-keywords
  router.post(
    '/get-keywords',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getKeywords(req, getElastic(service.db), service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // POST /api/v1/admin_user_activity/get-advertiser
  router.post(
    '/get-advertiser',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiser(req, getElastic(service.db), service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // POST /api/v1/admin_user_activity/get-domain
  router.post(
    '/get-domain',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getDomain(req, getElastic(service.db), service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // POST /api/v1/admin_user_activity/get-projects
  router.post(
    '/get-projects',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getProjects(req, getElastic(service.db), service.log);
      return res.status(result.code === 401 ? 401 : 200).json(result);
    })
  );

  // POST /api/v1/admin_user_activity/get-all-searches
  router.post(
    '/get-all-searches',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getUserActivitySearches(req, getElastic(service.db), service.log);
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
      const result = await getSummaryStats(req, getElastic(service.db), service.log);
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

  return router;
}

module.exports = { createAdmin_user_activityRoutes };

'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const databaseManager = require('../../../database/DatabaseManager');
const {
  userActivity,
  userActivityData,
  userDetails,
  userActivityProject,
} = require('../controllers/userActivityController');

const ELASTIC_FALLBACK_NETWORKS = [
  'facebook', 'instagram', 'youtube', 'linkedin',
  'reddit', 'pinterest', 'quora', 'native', 'gdn', 'google',
];

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
function createFrontend_user_activityRoutes(service) {
  const router = Router();

  // POST /api/v1/frontend_user_activity/user-activity
  // Store user activity in ES (mirrors PHP ShwDetail in helper.php)
  router.post(
    '/user-activity',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const elastic = getElastic(service.db);
      if (!elastic) return res.status(503).json({ code: 503, message: 'Elasticsearch not available' });
      const result = await userActivity(req, elastic, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/frontend_user_activity/user-activity-data
  // Retrieve user activity for a date range and optional platforms
  router.post(
    '/user-activity-data',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const elastic = getElastic(service.db);
      if (!elastic) return res.status(503).json({ code: 503, message: 'Elasticsearch not available' });
      const result = await userActivityData(req, elastic, service.log);
      return res.status(result.code === 200 ? 200 : (result.code || 200)).json(result);
    })
  );

  // POST /api/v1/frontend_user_activity/user-details
  // Paginated user activity lookup with optional platform filter
  router.post(
    '/user-details',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const elastic = getElastic(service.db);
      if (!elastic) return res.status(503).json({ code: 503, message: 'Elasticsearch not available' });
      const result = await userDetails(req, elastic, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/frontend_user_activity/user-activity-project
  // Store project activity (brand, competitors, dashboard advertisers) in ES
  router.post(
    '/user-activity-project',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const elastic = getElastic(service.db);
      if (!elastic) return res.status(503).json({ code: 503, message: 'Elasticsearch not available' });
      const result = await userActivityProject(req, elastic, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = { createFrontend_user_activityRoutes };

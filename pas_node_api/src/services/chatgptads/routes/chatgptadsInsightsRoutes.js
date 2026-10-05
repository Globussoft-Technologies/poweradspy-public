'use strict';

/**
 * ChatGPT Ads analytics routes. Auto-mounted by ServiceRegistry under /api/v1/chatgptads.
 *
 *   POST /api/v1/chatgptads/ads/getAdvertiserInsightsByDateRange
 *        → adInsightsController@getAdvertiserInsightsByDateRange
 *
 * Used by the analytics modal's "Select Range" picker (frontend api.js →
 * getAdvertiserInsightsByDateRange, routed via PLATFORM_ROUTE_MAP). The per-ad insights
 * themselves are served by POST /api/v1/common/ads/getAdInsights (network "chatgptads").
 *
 * Guards: same as chatgptadsRoutes.js — auth → plan access → requirePlatform('chatgptads').
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const { planAccessMiddleware, requirePlatform } = require('../../../middleware/planAccess');
const { getAdvertiserInsightsByDateRange } = require('../controllers/adInsightsController');

function createChatgptadsInsightsRoutes(service) {
  const router = Router();

  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    planAccessMiddleware,
    requirePlatform('chatgptads'),
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  return router;
}

module.exports = createChatgptadsInsightsRoutes;

'use strict';

/**
 * ChatGPT Ads search/read routes (separate from chatgptadsInsertionRoutes.js, same split
 * facebook uses). Auto-mounted by ServiceRegistry under /api/v1/chatgptads.
 *
 *   POST /api/v1/chatgptads/ads/search  → adSearchController@searchAds
 *
 * The dashboard itself searches through POST /api/v1/common/ads/search (network
 * "chatgptads"), which calls the same searchAds handler; this route is the direct,
 * network-scoped entry point.
 *
 * Guards: auth → plan access (allow-list + plan) → requirePlatform('chatgptads').
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const { planAccessMiddleware, requirePlatform } = require('../../../middleware/planAccess');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');

function createChatgptadsRoutes(service) {
  const router = Router();

  router.post(
    '/ads/search',
    authMiddleware,
    planAccessMiddleware,
    requirePlatform('chatgptads'),
    asyncHandler(async (req, res) => {
      const result = await searchAds(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, { data: result.data, meta: { total: result.total } });
      }
      return res.status(result.code).json(result);
    })
  );

  return router;
}

module.exports = { createChatgptadsRoutes };

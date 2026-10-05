'use strict';

/**
 * ChatGPT Ads search/read routes (separate from chatgptadsInsertionRoutes.js, same split
 * facebook uses). Auto-mounted by ServiceRegistry under /api/v1/chatgptads.
 *
 *   POST /api/v1/chatgptads/ads/search              → adSearchController@searchAds
 *   POST /api/v1/chatgptads/ads/hide_ads            → hideAdsController@hideAds   (save / hide)
 *   POST /api/v1/chatgptads/ads/getHiddenPostOwners → hideAdsController@getHiddenPostOwners
 *   POST /api/v1/chatgptads/ads/un-hide             → hideAdsController@unHide
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
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');

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

  // Save / hide — same shape and auth as every other network's hide endpoints.
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  return router;
}

module.exports = { createChatgptadsRoutes };

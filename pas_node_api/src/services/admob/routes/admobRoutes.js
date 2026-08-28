'use strict';

/**
 * AdMob search/read routes (mirrors facebookRoutes.js — search/read endpoints
 * live in their own file, separate from insertion routes).
 *
 *   POST /api/v1/admob/ads/search
 *   POST /api/v1/admob/ads/sessions
 *   POST /api/v1/admob/ads/hide_ads
 *   POST /api/v1/admob/ads/getHiddenPostOwners
 *   POST /api/v1/admob/ads/un-hide
 *
 * Auto-mounted by ServiceRegistry (every .js file in routes/ that exports
 * createAdmobRoutes gets picked up — see admobInsertionRoutes.js for the
 * insertion-only endpoints).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const { searchAds, getAdSessions } = require('../controllers/adSearchController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');

function createAdmobRoutes(service) {
  const router = Router();
  router.post(
    '/ads/search',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await searchAds(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
  router.post(
    '/ads/sessions',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdSessions(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
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

module.exports = { createAdmobRoutes };

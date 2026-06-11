'use strict';

/**
 * GDN Routes — Defines the API endpoints for Google Display Network ad operations.
 *
 * POST /ads/search               → Ad search with filters
 * POST /ads/detail               → Full ad details
 * GET  /ads/count                → Total ad count
 * POST /ads/hide_ads             → Hide / favorite an ad
 * POST /ads/getHiddenPostOwners  → Get hidden/favorite data for user
 * POST /ads/un-hide              → Un-hide / un-favorite
 * POST /ads/getGdnAdCountry      → Country targeting data
 * POST /ads/getGdnOutgoings      → Outgoing link chain
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds }                        = require('../controllers/adSearchController');
const { getAdDetails }                     = require('../controllers/adDetailController');
const { getAdsCount }                      = require('../controllers/adCountController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const { getGdnAdCountry, getGdnOutgoings, getAdvertiserCountryData, getAdvertiserInsightsByDateRange } = require('../controllers/adInsightsController');
const { authMiddleware }                   = require('../../../middleware/auth');
const { freePlanCheck }                    = require('../../../middleware/freePlanCheck');
const { planAccessMiddleware, requirePlatform } = require('../../../middleware/planAccess');
const validator                            = require('../../../middleware/validator');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

/**
 * Create GDN-specific routes.
 * @param {Object} service - the GdnService instance (provides db + logger)
 * @returns {Router}
 */
function createGdnRoutes(service) {
  const router = Router();

  // ─── Ad Search (Dashboard) ────────────────────────────
  // POST /api/v1/gdn/ads/search
  router.post(
    '/ads/search',
    authMiddleware,
    planAccessMiddleware,
    requirePlatform('gdn'),
    validator(searchSchema),
    // freePlanCheck,
    asyncHandler(async (req, res) => {
      const result = await searchAds(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, {
          data: result.data,
          meta: { total: result.total },
        });
      }
      return res.status(result.code).json(result);
    })
  );

  // ─── Ad Details ───────────────────────────────────────
  // POST /api/v1/gdn/ads/detail
  router.post(
    '/ads/detail',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, {
          data: result.data,
          meta: { builtwithStatusCode: result.builtwithStatusCode },
        });
      }
      return res.status(result.code).json(result);
    })
  );

  // ─── Ad Count ─────────────────────────────────────────
  // GET /api/v1/gdn/ads/count
  router.get(
    '/ads/count',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdsCount(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, { data: result.data });
      }
      return res.status(result.code).json(result);
    })
  );

  // ─── Hide / Favorite Ads ──────────────────────────────
  // POST /api/v1/gdn/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Get Hidden Post Owners ───────────────────────────
  // POST /api/v1/gdn/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Un-hide / Un-favorite ────────────────────────────
  // POST /api/v1/gdn/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Ad Country Targeting ─────────────────────────────
  // POST /api/v1/gdn/ads/getGdnAdCountry
  router.post(
    '/ads/getGdnAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getGdnAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Outgoing Links ───────────────────────────────────
  // POST /api/v1/gdn/ads/getGdnOutgoings
  router.post(
    '/ads/getGdnOutgoings',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getGdnOutgoings(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Advertiser Country Data (Last 12 Months) ─────────
  // POST /api/v1/gdn/ads/getAdvertiserCountryData
  router.post(
    '/ads/getAdvertiserCountryData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserCountryData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/gdn/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = { createGdnRoutes };

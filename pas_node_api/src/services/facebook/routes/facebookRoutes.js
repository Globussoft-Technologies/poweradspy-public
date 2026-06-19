'use strict';

/**
 * Facebook Routes — Defines the API endpoints for Facebook ad operations.
 *
 * POST /ads/search                    → Ad search with 30+ filters
 * POST /ads/detail                    → Full ad details with analytics
 * GET  /ads/count                     → Total ad count for platform
 * POST /ads/hide_ads                  → Hide/favorite an ad
 * POST /ads/getHiddenPostOwners       → Get hidden/favorite data for user
 * POST /ads/getLikeCommentShareDetails → LCS analytics timeline
 * POST /ads/getFacebookAdCountry       → Country targeting data
 * POST /ads/getFacebookUserData        → User demographics & graph data
 * POST /ads/getFacebookOutgoings       → Outgoing link chain
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');
const { getAdDetails } = require('../controllers/adDetailController');
const { getAdsCount } = require('../controllers/adCountController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const {
  getLikeCommentShareDetails,
  getFacebookAdCountry,
  getFacebookUserData,
  getFacebookOutgoings,
  getAdsPageDetails,
  getAdvertiserInsightsByDateRange,
} = require('../controllers/adInsightsController');
const { authMiddleware } = require('../../../middleware/auth');
const { freePlanCheck } = require('../../../middleware/freePlanCheck');
const { planAccessMiddleware, requirePlatform } = require('../../../middleware/planAccess');
const validator = require('../../../middleware/validator');
const { getAdsByAdvertiser } = require('../controllers/getAdsByAdvertiserController');
const { userChk, adsData } = require('../controllers/userCheckController');
const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

/**
 * Create Facebook-specific routes.
 * @param {Object} service - the FacebookService instance (provides db + logger)
 * @returns {Router}
 */
function createFacebookRoutes(service) {
  const router = Router();

  // ─── Ad Search (Dashboard) ────────────────────────────
  // POST /api/v1/facebook/ads/search
  // Uses authMiddleware to get req.user, then planAccess to verify plan/platform
  router.post(
    '/ads/search',
    authMiddleware,
    planAccessMiddleware,
    requirePlatform('facebook'),
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

  // ─── Ad Details (Show Analytics) ──────────────────────
  // POST /api/v1/facebook/ads/detail
  router.post(
    '/ads/detail',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, {
          data: result.data,
          meta: {
            country: result.country,
            builtwithStatusCode: result.builtwithStatusCode,
          },
        });
      }
      return res.status(result.code).json(result);
    })
  );

  // ─── Ad Count (Platform Stats) ────────────────────────
  // GET /api/v1/facebook/ads/count
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

  // ─── Hide / Favorite Ads ─────────────────────────────
  // POST /api/v1/facebook/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Get Hidden Post Owners ───────────────────────────
  // POST /api/v1/facebook/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Un-hide / Un-favorite ─────────────────────────────
  // POST /api/v1/facebook/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Like/Comment/Share Analytics Timeline ──────────
  // POST /api/v1/facebook/ads/getLikeCommentShareDetails
  router.post(
    '/ads/getLikeCommentShareDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLikeCommentShareDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Ad Country Targeting ──────────────────────────────
  // POST /api/v1/facebook/ads/getFacebookAdCountry
  router.post(
    '/ads/getFacebookAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getFacebookAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── User Demographics & Graph Data ────────────────────
  // POST /api/v1/facebook/ads/getFacebookUserData
  router.post(
    '/ads/getFacebookUserData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getFacebookUserData(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Outgoing Links ────────────────────────────────────
  // POST /api/v1/facebook/ads/getFacebookOutgoings
  router.post(
    '/ads/getFacebookOutgoings',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getFacebookOutgoings(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Ads Page Details (Library) ────────────────────────
  // POST /api/v1/facebook/ads/getAdsPageDetails
  router.post(
    '/ads/getAdsPageDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdsPageDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Advertiser Insights by Date Range ────────────────
  // POST /api/v1/facebook/ads/getAdvertiserInsightsByDateRange
  // Body: { post_owner_id, from_date, to_date, type }
  // type: "lcs" | "country" | "user"
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/ads/getAdsByAdvertiser',
    // authMiddleware, // optional (same as your system)
    asyncHandler(async (req, res) => {
      const result = await getAdsByAdvertiser(req, service.db, service.log);
      return res
        .status(result.code === 200 ? 200 : result.code)
        .json(result);
    })
  );

  // ─── User Check (browser extension) ────────────────────
  // POST /api/v1/facebook/user-chk  → Userv2Controller@checkFbUser  (check-only)
  // Public (no auth in PHP); the payload may be XOR-encrypted in body.data.
  router.post(
    '/user-chk',
    asyncHandler(async (req, res) => {
      const result = await userChk(req, service.db, service.log);
      // PHP returns json_encode($response) → HTTP 200 always; app status is body.code.
      return res.status(200).json(result);
    })
  );

  // ─── User Insert / Update (browser extension) ──────────
  // POST /api/v1/facebook/ads-data  → Userv2Controller@fb_user_data  (insert/update)
  router.post(
    '/ads-data',
    asyncHandler(async (req, res) => {
      const result = await adsData(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  return router;
}

module.exports = { createFacebookRoutes };


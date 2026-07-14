'use strict';

/**
 * Instagram Routes — Defines the API endpoints for Instagram ad operations.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');
const { getAdDetails } = require('../controllers/adDetailController');
const { getAdsCount } = require('../controllers/adCountController');
const { hideAds, getHiddenPostOwners,unHide } = require('../controllers/hideAdsController');
const {
  getLikeCommentShareDetails,
  getInstagramAdCountry,
  getInstagramUserData,
  getRedirectOutgoingUrls,
  getAdsLibUserData,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
  } = require('../controllers/adInsightsController');
const { userChk } = require('../controllers/userCheckController');
const { getDomainRegistration } = require('../controllers/domainRegistrationController');
const { authMiddleware } = require('../../../middleware/auth');
const { freePlanCheck } = require('../../../middleware/freePlanCheck');
const { planAccessMiddleware, requirePlatform } = require('../../../middleware/planAccess');
const validator = require('../../../middleware/validator');
const createInstagramLandersRoutes = require('./instagramLandersRoutes');
const createInstagramAdversuiteRoutes = require('./adversuite_Api_routes');
const { getUrlForBuiltWith, updateBuiltWith } = require('../controllers/built-withController');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

/**
 * Create Instagram-specific routes.
 * @param {Object} service - the InstagramService instance (provides db + logger)
 * @returns {Router}
 */
function createInstagramRoutes(service) {
  const router = Router();

  // ─── Ad Search (Dashboard) ────────────────────────────
  router.post(
    '/ads/search',
    authMiddleware,
    planAccessMiddleware,
    requirePlatform('instagram'),
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
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Get Hidden Post Owners ───────────────────────────
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Like/Comment/Share Analytics Timeline ──────────
  // POST /api/v1/instagram/ads/getLikeCommentShareDetails
  router.post(
    '/ads/getLikeCommentShareDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLikeCommentShareDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Ad Country Targeting ──────────────────────────────
  // POST /api/v1/instagram/ads/getInstagramAdCountry
  router.post(
    '/ads/getInstagramAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getInstagramAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── User Data ─────────────────────────────────────────
  // POST /api/v1/instagram/ads/getInstagramUserData
  router.post(
    '/ads/getInstagramUserData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getInstagramUserData(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Outgoing / Redirect URLs ──────────────────────────
  // POST /api/v1/instagram/ads/getRedirectOutgoingUrls
  router.post(
    '/ads/getRedirectOutgoingUrls',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getRedirectOutgoingUrls(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Ads Library User Data (Age & Gender) ──────────────
  // POST /api/v1/instagram/ads/getAdsLibUserData
  router.post(
    '/ads/getAdsLibUserData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdsLibUserData(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Advertiser LCS (Monthly, Last 12 Months) ──────────
  // POST /api/v1/instagram/ads/getAdvertiserLCSData
  router.post(
    '/ads/getAdvertiserLCSData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserLCSData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Advertiser Country Data (Last 12 Months) ─────────
  // POST /api/v1/instagram/ads/getAdvertiserCountryData
  router.post(
    '/ads/getAdvertiserCountryData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserCountryData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Advertiser Insights By Date Range ────────────────
  // POST /api/v1/instagram/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Un-hide / Un-favorite ─────────────────────────────
  // POST /api/v1/instagram/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── User Check / Upsert (browser extension) ───────────
  // POST /api/v1/instagram/user-chk  → UserController@instagram_user_data
  // Public (no auth in PHP); the payload may be XOR-encrypted in body.data.
  router.post(
    '/user-chk',
    asyncHandler(async (req, res) => {
      const result = await userChk(req, service.db, service.log);
      // PHP returns json_encode($response) as a plain string → HTTP 200 always;
      // the app-level status lives in the body `code` (the extension reads that).
      return res.status(200).json(result);
    })
  );

  // ─── Domain registration lookup (gramapi) ─────────────
  // GET /api/v1/instagram/get-domain-registration?domain=<domain> → Userv2Controller@getDomainRegistration
  // Public (no auth in PHP). `code` is mapped to the real HTTP status (200/404/400/401).
  router.get(
    '/get-domain-registration',
    asyncHandler(async (req, res) => {
      const result = await getDomainRegistration(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  // ─── Landers Routes ────────────────────────────────────
  const landersRouter = createInstagramLandersRoutes(service);
  router.use('/landers', landersRouter);

  // ─── Adversuite API Routes (getLocation etc.) ─────────
  const adversuiteRouter = createInstagramAdversuiteRoutes(service);
  router.use('/adversuite', adversuiteRouter);

  // ─── Built-with scrape queue (worker endpoints) ──────
  router.get(
    '/built-with/getUrlForBuiltWith',
    asyncHandler(async (req, res) => {
      const result = await getUrlForBuiltWith(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );
  router.post(
    '/built-with/updateBuiltWith',
    asyncHandler(async (req, res) => {
      const result = await updateBuiltWith(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = { createInstagramRoutes };

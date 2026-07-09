'use strict';

/**
 * YouTube Routes — Defines the API endpoints for YouTube ad operations.
 *
 * POST /ads/search  → Ad search with filters (views, dislikes, country, etc.)
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');
const { getAdDetails } = require('../controllers/adDetailController');
const { getOverview: getYtDashOverview, getLive: getYtDashLive } = require('../controllers/youtubeDashboardController');
const {
  getLikeCommentShareDetails,
  getYoutubeAdCountry,
  getYoutubeOutgoings,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require('../controllers/adInsightsController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const { getDomainRegistration } = require('../controllers/domainRegistrationController');
const createYoutubeAdversuiteRoutes = require('./adversuite_Api_routes');
const { authMiddleware } = require('../../../middleware/auth');
const { freePlanCheck } = require('../../../middleware/freePlanCheck');
const { planAccessMiddleware, requirePlatform } = require('../../../middleware/planAccess');
const validator = require('../../../middleware/validator');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

/**
 * Create YouTube-specific routes.
 * @param {Object} service - the YouTubeService instance (provides db + logger)
 * @returns {Router}
 */
function createYoutubeRoutes(service) {
  const router = Router();

  // ─── Ad Search (Dashboard) ────────────────────────────
  // POST /api/v1/youtube/ads/search
  router.post(
    '/ads/search',
    authMiddleware,
    planAccessMiddleware,
    requirePlatform('youtube'),
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

  // ─── Ad Details ────────────────────────────────────────
  // POST /api/v1/youtube/ads/getAdDetails
  router.post(
    '/ads/getAdDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Monitoring dashboard (read-only, unguarded — same convention as GDN dashboard) ──
  // GET /api/v1/youtube/dashboard/overview
  router.get('/dashboard/overview', asyncHandler(async (req, res) => {
    const r = await getYtDashOverview(req, service.db, service.log);
    return res.status(r.code === 200 ? 200 : r.code).json({ code: r.code, status: r.code === 200 ? 'ok' : 'error', data: r.data, message: r.message });
  }));
  // GET /api/v1/youtube/dashboard/live
  router.get('/dashboard/live', asyncHandler(async (req, res) => {
    const r = await getYtDashLive(req, service.db, service.log);
    return res.status(r.code === 200 ? 200 : r.code).json({ code: r.code, status: r.code === 200 ? 'ok' : 'error', data: r.data, message: r.message });
  }));

  // ─── Like/Comment/Share Analytics Timeline ────────────
  // POST /api/v1/youtube/ads/getLikeCommentShareDetails
  router.post(
    '/ads/getLikeCommentShareDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLikeCommentShareDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Ad Country Data ─────────────────────────────────
  // POST /api/v1/youtube/ads/getYoutubeAdCountry
  router.post(
    '/ads/getYoutubeAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getYoutubeAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Outgoing Links ──────────────────────────────────
  // POST /api/v1/youtube/ads/getYoutubeOutgoings
  router.post(
    '/ads/getYoutubeOutgoings',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getYoutubeOutgoings(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Advertiser LCS (Monthly, Last 12 Months) ──────────
  // POST /api/v1/youtube/ads/getAdvertiserLCSData
  router.post(
    '/ads/getAdvertiserLCSData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserLCSData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Hide / Favorite Ads ──────────────────────────────
  // POST /api/v1/youtube/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Get Hidden Post Owners ───────────────────────────
  // POST /api/v1/youtube/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Un-hide / Un-favorite ────────────────────────────
  // POST /api/v1/youtube/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Advertiser Country Data (Last 12 Months) ─────────
  // POST /api/v1/youtube/ads/getAdvertiserCountryData
  router.post(
    '/ads/getAdvertiserCountryData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserCountryData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/youtube/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Domain registration lookup (tubeapi) ─────────────
  // GET /api/v1/youtube/get-domain-registration?domain=<domain> → SearchController@getDomainRegistration
  // Public (no auth in PHP). `code` mapped to the real HTTP status (200/404/400/401).
  router.get(
    '/get-domain-registration',
    asyncHandler(async (req, res) => {
      const result = await getDomainRegistration(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  // ─── Adversuite API Routes (getLocation, getCallToActions) ────
  const adversuiteRouter = createYoutubeAdversuiteRoutes(service);
  router.use('/adversuite', adversuiteRouter);

  return router;
}

module.exports = { createYoutubeRoutes };

'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');
const { getAdsCount } = require('../controllers/adCountController');
const { getAdDetails } = require('../controllers/adDetailController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const {
  getLikeCommentShareDetails,
  getRedditAdCountry,
  getRedirectOutgoingUrls,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require('../controllers/adInsightsController');
const { authMiddleware } = require('../../../middleware/auth');
const validator = require('../../../middleware/validator');
const createRedditInsertionRoutes = require('./redditInsertionRoutes');
const createRedditLandersRoutes = require('../landers/redditLandersRoutes');
const { getUrlForBuiltWith, updateBuiltWith } = require('../controllers/built-withController');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

function createRedditRoutes(service) {
  const router = Router();

  // ─── Ad Search (Dashboard) ────────────────────────────
  // POST /api/v1/reddit/ads/search
  router.post(
    '/ads/search',
    authMiddleware,
    validator(searchSchema),
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

  // ─── Ad Count (Platform Stats) ────────────────────────
  // GET /api/v1/reddit/ads/count
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

  // POST /api/v1/reddit/ads/detail
  router.post(
    '/ads/detail',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/getAdDetails
  router.post(
    '/ads/getAdDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/getLikeCommentShareDetails
  router.post(
    '/ads/getLikeCommentShareDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLikeCommentShareDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/getRedditAdCountry
  router.post(
    '/ads/getRedditAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getRedditAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/getRedirectOutgoingUrls
  router.post(
    '/ads/getRedirectOutgoingUrls',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getRedirectOutgoingUrls(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/getAdvertiserLCSData
  router.post(
    '/ads/getAdvertiserLCSData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserLCSData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/getAdvertiserCountryData
  router.post(
    '/ads/getAdvertiserCountryData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserCountryData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // Mount insertion routes (parallel to read routes)
  const insertionRouter = createRedditInsertionRoutes(service);
  router.use(insertionRouter);

  // Mount lander routes (blackhat scraping pipeline)
  const landerRouter = createRedditLandersRoutes(service);
  router.use(landerRouter);

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

module.exports = { createRedditRoutes };

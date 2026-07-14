'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');
const { getAdsCount } = require('../controllers/adCountController');
const { getAdDetails } = require('../controllers/adDetailController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const {
  getNativeAdCountry,
  getTargetSite,
  getAdNetwork,
  getRedirect,
  getRedirectOutgoingUrls,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require('../controllers/adInsightsController');
const { authMiddleware } = require('../../../middleware/auth');
const validator = require('../../../middleware/validator');
const { getUrlForBuiltWith, updateBuiltWith } = require('../controllers/built-withController');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

function createNativeRoutes(service) {
  const router = Router();

  // ─── Ad Search (Dashboard) ────────────────────────────
  // POST /api/v1/native/ads/search
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
  // GET /api/v1/native/ads/count
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

  // POST /api/v1/native/ads/detail
  router.post(
    '/ads/detail',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getAdDetails
  router.post(
    '/ads/getAdDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getNativeAdCountry
  router.post(
    '/ads/getNativeAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getNativeAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getTargetSite
  router.post(
    '/ads/getTargetSite',
    asyncHandler(async (req, res) => {
      const result = await getTargetSite(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getAdNetwork
  router.post(
    '/ads/getAdNetwork',
    asyncHandler(async (req, res) => {
      const result = await getAdNetwork(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getRedirect
  router.post(
    '/ads/getRedirect',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getRedirect(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getRedirectOutgoingUrls
  router.post(
    '/ads/getRedirectOutgoingUrls',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getRedirectOutgoingUrls(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getAdvertiserCountryData
  router.post(
    '/ads/getAdvertiserCountryData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserCountryData(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/native/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

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

module.exports = { createNativeRoutes };

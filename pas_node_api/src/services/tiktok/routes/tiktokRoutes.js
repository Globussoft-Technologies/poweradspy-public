'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');
const { getAdsCount } = require('../controllers/adCountController');
const { getLCS, getAnalytics, getIndustries, getAdvertiserInsightsByDateRange } = require('../controllers/adInsightsController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const { refreshVideoUrl } = require('../controllers/videoRefreshController');
const { proxyTikTokVideo } = require('../controllers/videoProxyController');
const { authMiddleware } = require('../../../middleware/auth');
const validator = require('../../../middleware/validator');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

function createTiktokRoutes(service) {
  // console.log(service.db.elastic,"90qw");
  const router = Router();

  // ─── Ad Search (Dashboard searchFilter) ───────────────
  // POST /api/v1/tiktok/ads/search
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

  // ─── Ad Count ─────────────────────────────────────────
  // GET /api/v1/tiktok/ads/count
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

  // ─── Get Industries ───────────────────────────────────
  // GET /api/v1/tiktok/ads/getIndustries
  router.get(
    '/ads/getIndustries',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getIndustries(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── LCS (Likes/Comments/Shares Timeline) ─────────────
  // POST /api/v1/tiktok/ads/getLCS
  router.post(
    '/ads/getLCS',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLCS(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Analytics (single ad from ES) ────────────────────
  // POST /api/v1/tiktok/ads/analytics
  router.post(
    '/ads/analytics',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAnalytics(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Hide Ads ─────────────────────────────────────────
  // POST /api/v1/tiktok/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/tiktok/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/tiktok/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );
  // ─── Advertiser Insights by Date Range ────────────────
  // POST /api/v1/tiktok/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );
  // ─── Refresh Expired Video URL ─────────────────────────
  // POST /api/v1/tiktok/ads/refresh-video
  router.post(
    '/ads/refresh-video',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await refreshVideoUrl(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, { data: result.data });
      }
      return res.status(result.code).json(result);
    })
  );
  // ─── Video Proxy (bypasses TikTok CDN Referer 403) ────
  // GET /api/v1/tiktok/ads/video-proxy?url=<encoded_tiktok_cdn_url>
  // No auth — used directly in <video src="...">
  router.get(
    '/ads/video-proxy',
    asyncHandler(async (req, res) => {
      await proxyTikTokVideo(req, res, service.log);
    })
  );

  return router;
}

module.exports = { createTiktokRoutes };
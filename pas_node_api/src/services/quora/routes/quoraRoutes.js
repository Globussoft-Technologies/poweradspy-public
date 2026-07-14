'use strict';

const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const { searchAds } = require('../controllers/adSearchController');
const { getAdsCount } = require('../controllers/adCountController');
const { getAdDetails } = require('../controllers/adDetailController');
const { getLatestVideoAdUrls } = require('../controllers/videoUrlController');
const { updateNasImage } = require('../controllers/updateNasImageController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const {
  getLikeCommentShareDetails,
  getQuoraAdCountry,
  getQuoraOutgoings,
  getQuoraUserData,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require('../controllers/adInsightsController');
const { authMiddleware } = require('../../../middleware/auth');
const validator = require('../../../middleware/validator');
const createQuoraInsertionRoutes = require('./quoraInsertionRoutes');
const createQuoraLandersRoutes = require('../landers/quoraLandersRoutes');
const { getUrlForBuiltWith, updateBuiltWith } = require('../controllers/built-withController');

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

// Multer config for the NAS image upload (single binary field named "image").
const uploadImage = multer({ dest: '/tmp/quora-nas-image/' });

// Hardcoded passkey guard for the NAS image upload endpoint (worker-to-server auth).
// The calling worker must send this exact value in the `x-passkey` header.
const NAS_IMAGE_PASSKEY = 'pas-quora-nas-img-9f3Kx7QwZ2p';
const NAS_IMAGE_PASSKEY_HEADER = 'x-passkey';

function requireNasImagePasskey(req, res, next) {
  const provided = req.get(NAS_IMAGE_PASSKEY_HEADER);
  if (!provided || provided !== NAS_IMAGE_PASSKEY) {
    return res.status(401).json({ code: 401, message: 'Unauthorized: invalid or missing passkey' });
  }
  return next();
}

function createQuoraRoutes(service) {
  const router = Router();

  // POST /api/v1/quora/ads/search
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

  // GET /api/v1/quora/ads/count
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

  // GET /api/v1/quora/ads/get-ad-url
  // Latest VIDEO ads whose new_nas_image_url is still "/DefaultImage.jpg".
  // ?limit=<n> (default 1). Returns [{ ad_id, video_url }].
  router.get(
    '/ads/get-ad-url',
    asyncHandler(async (req, res) => {
      const result = await getLatestVideoAdUrls(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, { data: result.data, meta: { total: result.total } });
      }
      return res.status(result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/update-nas-image
  // Store an uploaded image binary in NAS and set the ad's new_nas_image_url in ES.
  // Requires the `x-passkey` header. multipart/form-data: ad_id, network (must be "quora"), image (file).
  router.post(
    '/ads/update-nas-image',
    requireNasImagePasskey,
    uploadImage.single('image'),
    asyncHandler(async (req, res) => {
      const result = await updateNasImage(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, { data: result.data }, result.message);
      }
      return res.status(result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/detail
  router.post(
    '/ads/detail',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getAdDetails
  router.post(
    '/ads/getAdDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getLikeCommentShareDetails
  router.post(
    '/ads/getLikeCommentShareDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLikeCommentShareDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getQuoraAdCountry
  router.post(
    '/ads/getQuoraAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getQuoraAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getQuoraOutgoings
  router.post(
    '/ads/getQuoraOutgoings',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getQuoraOutgoings(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getQuoraUserData
  router.post(
    '/ads/getQuoraUserData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getQuoraUserData(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getAdvertiserLCSData
  router.post(
    '/ads/getAdvertiserLCSData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserLCSData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getAdvertiserCountryData
  router.post(
    '/ads/getAdvertiserCountryData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserCountryData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // Mount insertion routes (parallel to read routes)
  const insertionRouter = createQuoraInsertionRoutes(service);
  router.use(insertionRouter);

  // Mount landers routes
  const landersRouter = createQuoraLandersRoutes(service);
  router.use(landersRouter);

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

module.exports = { createQuoraRoutes };

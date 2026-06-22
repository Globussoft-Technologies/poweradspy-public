'use strict';

const { Router } = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ResponseFormatter = require('../../../utils/responseFormatter');
const config = require('../../../config');
const { searchAds } = require('../controllers/adSearchController');
const { getTopAds } = require('../controllers/getTopAdsController');
const { getAdsCount } = require('../controllers/adCountController');
const { getAdDetails } = require('../controllers/adDetailController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const {
  getLikeCommentShareDetails,
  getGoogleAdCountry,
  getGoogleOutgoings,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require('../controllers/adInsightsController');
const { searchAuditKeywords, insertSearchAuditKeywords } = require('../controllers/searchAuditController');
const { authMiddleware } = require('../../../middleware/auth');
const validator = require('../../../middleware/validator');

// CSV upload for the keyword insert endpoint → temp file on disk, parsed (streamed) then
// unlinked by the service. Size capped at config.googleKeywordAudit.maxUploadMb.
const KEYWORD_UPLOAD_TMP = path.join(os.tmpdir(), 'pas-google-keyword-audit');
function ensureKeywordTmp() { try { fs.mkdirSync(KEYWORD_UPLOAD_TMP, { recursive: true }); } catch { /* ignore */ } }
ensureKeywordTmp();
const keywordStorage = multer.diskStorage({
  destination: (_req, _file, cb) => { ensureKeywordTmp(); cb(null, KEYWORD_UPLOAD_TMP); },
  filename: (_req, file, cb) => cb(null, `kw_${Date.now()}_${Math.round(process.hrtime()[1])}${path.extname(file.originalname || '') || '.csv'}`),
});
const keywordUpload = multer({
  storage: keywordStorage,
  limits: { fileSize: (config.googleKeywordAudit.maxUploadMb || 50) * 1024 * 1024 },
}).single('file');
// Run multer but turn its errors (e.g. file too large) into a clean 400 instead of a throw.
function keywordUploadMw(req, res, next) {
  keywordUpload(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      code: tooBig ? 413 : 400,
      message: tooBig ? `CSV exceeds the ${config.googleKeywordAudit.maxUploadMb || 50} MB limit.` : `Upload error: ${err.message}`,
    });
  });
}

const searchSchema = {
  body: {
    page:      { type: 'number' },
    page_size: { type: 'number' },
  },
};

function createGoogleRoutes(service) {
  const router = Router();

  // POST /api/v1/google/ads/search
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

  // POST /api/v1/google/ads/getTopAds
  router.post(
    '/ads/getTopAds',
    authMiddleware,
    validator(searchSchema),
    asyncHandler(async (req, res) => {
      const result = await getTopAds(req, service.db, service.log);
      if (result.code === 200) {
        return ResponseFormatter.success(res, {
          data: result.data,
          meta: { total: result.total },
        });
      }
      return res.status(result.code).json(result);
    })
  );

  // GET /api/v1/google/ads/count
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

  // POST /api/v1/google/ads/detail
  router.post(
    '/ads/detail',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getAdDetails
  router.post(
    '/ads/getAdDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getLikeCommentShareDetails
  router.post(
    '/ads/getLikeCommentShareDetails',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLikeCommentShareDetails(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getGoogleAdCountry
  router.post(
    '/ads/getGoogleAdCountry',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getGoogleAdCountry(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getGoogleOutgoings
  router.post(
    '/ads/getGoogleOutgoings',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getGoogleOutgoings(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getAdvertiserCountryData
  router.post(
    '/ads/getAdvertiserCountryData',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserCountryData(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getAdvertiserInsightsByDateRange
  router.post(
    '/ads/getAdvertiserInsightsByDateRange',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdvertiserInsightsByDateRange(req, service.db, service.log);
      if (!result) return res.status(400).json({ code: 400, message: 'No data found.', data: null });
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/hide_ads
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/getHiddenPostOwners
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/google/ads/un-hide
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Search-Audit Keywords (gtext → MongoDB google_audit_keywords) ──────────
  // GET  /api/v1/google/get-search-audit-keywords    — crawler pull (cursored batch)
  // POST /api/v1/google/insert-search-audit-keywords — bulk insert (CSV file or JSON)
  // Public (gtext routes had no auth); dedupe + 100k cap handled in the service.
  router.get(
    '/get-search-audit-keywords',
    asyncHandler(async (req, res) => {
      const result = await searchAuditKeywords(req, service.db, service.log);
      // HTTP 200 always; the app-level status lives in body.code (legacy contract).
      return res.status(200).json(result);
    })
  );

  router.post(
    '/insert-search-audit-keywords',
    keywordUploadMw,
    asyncHandler(async (req, res) => {
      const result = await insertSearchAuditKeywords(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = { createGoogleRoutes };

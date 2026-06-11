'use strict';

/**
 * Google landers (destination-lander / blackhat) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/google. Same layout as
 * facebookLandersRoutes.js.
 *
 *   GET  /api/v1/google/landers/get_ads_for_blackhat  → BlackhatController@getGoogleAdsWithCounrty
 *   POST /api/v1/google/landers/upload_gtext_blackhat → BlackhatController@uploadBlackhatContent
 *   POST /api/v1/google/landers/insert_html_content   → BlackhatController@inserHtmlContentToDBO
 *
 * Legacy endpoint names preserved so existing scrapers keep working.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getAds, uploadFiles, insertHtml } = require('../controllers/googleLandersController');

const httpStatus = (code) => (code === 200 ? 200 : code || 400);

// Multipart upload (screenshot + html zip) → temp files on disk, uploaded to NAS by
// uploadService then unlinked.
const UPLOAD_TMP = path.join(os.tmpdir(), 'pas-google-landers');
function ensureTmpDir() {
  try { fs.mkdirSync(UPLOAD_TMP, { recursive: true }); } catch { /* ignore */ }
}
ensureTmpDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => { ensureTmpDir(); cb(null, UPLOAD_TMP); },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    cb(null, `${file.fieldname}_${Date.now()}_${Math.round(process.hrtime()[1])}${ext}`);
  },
});
const landerUpload = multer({ storage }).fields([
  { name: 'media', maxCount: 1 },
  { name: 'zip', maxCount: 1 },
]);

function createGoogleLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/google/landers/get_ads_for_blackhat
  router.get(
    '/landers/get_ads_for_blackhat',
    asyncHandler(async (req, res) => {
      const result = await getAds(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/google/landers/upload_gtext_blackhat
  router.post(
    '/landers/upload_gtext_blackhat',
    landerUpload,
    asyncHandler(async (req, res) => {
      const result = await uploadFiles(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/google/landers/insert_html_content
  router.post(
    '/landers/insert_html_content',
    asyncHandler(async (req, res) => {
      const result = await insertHtml(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createGoogleLandersRoutes;

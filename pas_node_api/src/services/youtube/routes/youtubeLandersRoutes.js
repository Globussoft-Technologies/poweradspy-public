'use strict';

/**
 * YouTube landers (destination-lander / blackhat) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/youtube. Same layout as
 * facebook/google landers routes.
 *
 *   GET  /api/v1/youtube/landers/get_youtubeid_for_lander    → BlackhatControllerYoutube@getYoutubeAdsWithCounrty
 *   POST /api/v1/youtube/landers/upload_blackhat_image_zip   → BlackhatControllerYoutube@uploadBlackhatContent
 *   POST /api/v1/youtube/landers/insert_html_content_lander  → BlackhatControllerYoutube@inserHtmlContentToDB
 *
 * Legacy endpoint names preserved so existing scrapers keep working.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getAds, uploadFiles, insertHtml } = require('../controllers/youtubeLandersController');

const httpStatus = (code) => (code === 200 ? 200 : code || 400);

const UPLOAD_TMP = path.join(os.tmpdir(), 'pas-youtube-landers');
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

function createYoutubeLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/youtube/landers/get_youtubeid_for_lander
  router.get(
    '/landers/get_youtubeid_for_lander',
    asyncHandler(async (req, res) => {
      const result = await getAds(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/youtube/landers/upload_blackhat_image_zip
  router.post(
    '/landers/upload_blackhat_image_zip',
    landerUpload,
    asyncHandler(async (req, res) => {
      const result = await uploadFiles(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/youtube/landers/insert_html_content_lander
  router.post(
    '/landers/insert_html_content_lander',
    asyncHandler(async (req, res) => {
      const result = await insertHtml(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createYoutubeLandersRoutes;

'use strict';

/**
 * LinkedIn landers (destination-lander / blackhat) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/linkedin. Same layout as
 * youtube/facebook/google landers routes.
 *
 *   GET  /api/v1/linkedin/landers/get-ads-for-blackhat   → BlackhatController@getAdsForBlackHat
 *   POST /api/v1/linkedin/landers/upload_file_to-server  → BlackhatController@uploadBlackhatContent
 *   POST /api/v1/linkedin/landers/insert_html_lander     → BlackhatController@inserHtmlContentToDB
 *
 * Legacy endpoint names preserved so existing scrapers keep working. Unauthenticated (PHP-faithful).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getAds, uploadFiles, insertHtml } = require('../controllers/landersController');

const httpStatus = (code) => (code === 200 ? 200 : code || 400);

const UPLOAD_TMP = path.join(os.tmpdir(), 'pas-linkedin-landers');
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

function createLinkedinLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/linkedin/landers/get-ads-for-blackhat
  router.get(
    '/landers/get-ads-for-blackhat',
    asyncHandler(async (req, res) => {
      const result = await getAds(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/linkedin/landers/upload_file_to-server
  router.post(
    '/landers/upload_file_to-server',
    landerUpload,
    asyncHandler(async (req, res) => {
      const result = await uploadFiles(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/linkedin/landers/insert_html_lander
  router.post(
    '/landers/insert_html_lander',
    asyncHandler(async (req, res) => {
      const result = await insertHtml(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createLinkedinLandersRoutes;

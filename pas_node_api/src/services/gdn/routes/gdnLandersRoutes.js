'use strict';

/**
 * GDN landers (destination-lander / blackhat) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/gdn. Same layout as
 * googleLandersRoutes.js (default-function export → mounted via the
 * `typeof routeModule === 'function'` branch in ServiceRegistry).
 *
 *   GET  /api/v1/gdn/landers/get_ads_for_blackhat → BlackhatController@getGDNAdsWithCounrty
 *   POST /api/v1/gdn/landers/upload_gdn_blackhat  → BlackhatController@uploadBlackhatContent
 *   POST /api/v1/gdn/landers/insert_html_content  → BlackhatController@inserHtmlContentToDB
 *
 * Legacy endpoint names preserved so existing scrapers keep working.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getAds, uploadFiles, insertHtml } = require('../controllers/gdnLandersController');

const httpStatus = (code) => (code === 200 ? 200 : code || 400);

// Multipart upload (screenshot + html zip) → temp files on disk, uploaded to NAS by
// uploadService then unlinked.
const UPLOAD_TMP = path.join(os.tmpdir(), 'pas-gdn-landers');
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

function createGdnLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/gdn/landers/get_ads_for_blackhat
  router.get(
    '/landers/get_ads_for_blackhat',
    asyncHandler(async (req, res) => {
      const result = await getAds(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/gdn/landers/upload_gdn_blackhat
  router.post(
    '/landers/upload_gdn_blackhat',
    landerUpload,
    asyncHandler(async (req, res) => {
      const result = await uploadFiles(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/gdn/landers/insert_html_content
  router.post(
    '/landers/insert_html_content',
    asyncHandler(async (req, res) => {
      const result = await insertHtml(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createGdnLandersRoutes;

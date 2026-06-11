'use strict';

/**
 * Facebook landers (destination-lander / blackhat) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/facebook.
 *
 *   GET  /api/v1/facebook/landers/getAdwithCountryCode      → BlackHatController@getAdwithCountryCode
 *   POST /api/v1/facebook/landers/uploadFileToServer        → BlackHatController@uploadFileToServer
 *   POST /api/v1/facebook/landers/insertHtmlRedirectCountry → BlackHatController@insertHtmlRedirectCountry
 *
 * Legacy endpoint names are preserved so the existing scrapers keep working; they
 * are grouped under /landers per the landers-subsystem manifest.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getAds, uploadFiles, insertHtml } = require('../controllers/facebookLandersController');

const httpStatus = (code) => (code === 200 ? 200 : code || 400);

// Multipart upload (screenshot + html zip) → temp files on disk, uploaded to NAS by
// uploadService then unlinked. Disk storage keeps memory flat for large bundles.
const UPLOAD_TMP = path.join(os.tmpdir(), 'pas-fb-landers');
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
const upload = multer({ storage });
const landerUpload = upload.fields([
  { name: 'media', maxCount: 1 },
  { name: 'zip', maxCount: 1 },
]);

function createFacebookLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/facebook/landers/getAdwithCountryCode
  router.get(
    '/landers/getAdwithCountryCode',
    asyncHandler(async (req, res) => {
      const result = await getAds(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/facebook/landers/uploadFileToServer
  router.post(
    '/landers/uploadFileToServer',
    landerUpload,
    asyncHandler(async (req, res) => {
      const result = await uploadFiles(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/facebook/landers/insertHtmlRedirectCountry
  router.post(
    '/landers/insertHtmlRedirectCountry',
    asyncHandler(async (req, res) => {
      const result = await insertHtml(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createFacebookLandersRoutes;

'use strict';

/**
 * AdMob landers routes.
 *
 * Scraper-facing pipeline for AdMob destination pages:
 *   GET  /api/v1/admob/landers/get_ads_for_blackhat
 *   POST /api/v1/admob/landers/upload_admob_blackhat
 *   POST /api/v1/admob/landers/insert_html_content
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getAds, uploadFiles, insertHtml } = require('../controllers/admobLandersController');

const httpStatus = (code) => (code === 200 ? 200 : code || 400);
const UPLOAD_TMP = path.join(os.tmpdir(), 'pas-admob-landers');

function ensureTmpDir() {
  try {
    fs.mkdirSync(UPLOAD_TMP, { recursive: true });
  } catch {
    // The upload route will fail naturally if the temp directory cannot be created.
  }
}

ensureTmpDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureTmpDir();
    cb(null, UPLOAD_TMP);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    cb(null, `${file.fieldname}_${Date.now()}_${Math.round(process.hrtime()[1])}${ext}`);
  },
});

const landerUpload = multer({ storage }).fields([
  { name: 'media', maxCount: 1 },
  { name: 'zip', maxCount: 1 },
]);

function createAdmobRoutes(service) {
  const router = Router();

  router.get(
    '/landers/get_ads_for_blackhat',
    asyncHandler(async (req, res) => {
      const result = await getAds(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  router.post(
    '/landers/upload_admob_blackhat',
    landerUpload,
    asyncHandler(async (req, res) => {
      const result = await uploadFiles(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  router.post(
    '/landers/insert_html_content',
    asyncHandler(async (req, res) => {
      const result = await insertHtml(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = { createAdmobRoutes };

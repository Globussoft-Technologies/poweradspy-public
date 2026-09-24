'use strict';

/**
 * Quora landers routes — GET/POST endpoints for lander management.
 * Auto-mounted by ServiceRegistry under /api/v1/quora.
 *
 *   GET  /api/v1/quora/landers/get-ads-for-lander           → getAdsForLander
 *   POST /api/v1/quora/landers/upload-lander-image-zip      → uploadLanderImageZip (multipart)
 *   POST /api/v1/quora/landers/insert-lander-details-todb   → insertLanderDetailsToDB
 *
 * No auth required (matching PHP routes).
 */

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { asyncHandler } = require('../../../middleware/errorHandler');
const {
  getAdsForLander,
  uploadLanderImageZip,
  insertLanderDetailsToDB
} = require('./quoraLandersController');

// Multer config for file uploads
// storeInNas derives the stored file's extension from the temp file path, and multer's `dest`
// writes extensionless temp names — which produced NAS paths ending in "." (no .jpg/.zip).
// Use diskStorage so the original extension is preserved on the temp file.
const uploadDir = '/tmp/quora-landers/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').replace(/[^A-Za-z0-9.]/g, '').toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  })
});

function createQuoraLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/quora/landers/get-ads-for-lander
  router.get(
    '/landers/get-ads-for-lander',
    asyncHandler(async (req, res) => {
      const result = await getAdsForLander(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/landers/upload-lander-image-zip
  router.post(
    '/landers/upload-lander-image-zip',
    upload.fields([
      { name: 'media', maxCount: 1 },
      { name: 'zip', maxCount: 1 }
    ]),
    asyncHandler(async (req, res) => {
      const result = await uploadLanderImageZip(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/landers/insert-lander-details-todb
  router.post(
    '/landers/insert-lander-details-todb',
    asyncHandler(async (req, res) => {
      const result = await insertLanderDetailsToDB(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = createQuoraLandersRoutes;

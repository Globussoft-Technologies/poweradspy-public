'use strict';

/**
 * Pinterest landers routes — GET/POST endpoints for lander management.
 * Auto-mounted by ServiceRegistry under /api/v1/pinterest.
 *
 *   GET  /api/v1/pinterest/landers/get-ads-for-blackhat         → getAdsForLander
 *   POST /api/v1/pinterest/landers/upload-pinterest-blackhat    → uploadPinterestBlackhat (multipart)
 *   POST /api/v1/pinterest/landers/insert-html-content          → insertPinterestHtml
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
  uploadPinterestBlackhat,
  insertPinterestHtml
} = require('./pinterestLandersController');

// Multer config for file uploads
const uploadDir = path.join(__dirname, '../../../..', 'tmp', 'pinterest-landers');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
// Keep the original extension on the temp file: storeInNas derives the stored extension from it,
// and multer's `dest` writes extensionless names (→ NAS paths ending in ".").
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').replace(/[^A-Za-z0-9.]/g, '').toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  })
});

function createPinterestLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/pinterest/landers/get-ads-for-blackhat
  router.get(
    '/landers/get-ads-for-blackhat',
    asyncHandler(async (req, res) => {
      const result = await getAdsForLander(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/pinterest/landers/upload-pinterest-blackhat
  router.post(
    '/landers/upload-pinterest-blackhat',
    upload.fields([
      { name: 'media', maxCount: 1 },
      { name: 'zip', maxCount: 1 }
    ]),
    asyncHandler(async (req, res) => {
      const result = await uploadPinterestBlackhat(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/pinterest/landers/insert-html-content
  router.post(
    '/landers/insert-html-content',
    asyncHandler(async (req, res) => {
      const result = await insertPinterestHtml(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = createPinterestLandersRoutes;

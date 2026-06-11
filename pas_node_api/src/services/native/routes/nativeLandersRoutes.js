'use strict';

/**
 * Native landers routes — mirrors insertion routes pattern
 * Auto-mounted by ServiceRegistry under /api/v1/native
 *
 *   GET  /api/v1/native/landers/get_ads_for_blackhat       → getNativeAdsWithCountry
 *   POST /api/v1/native/landers/upload_native_blackhat      → uploadBlackhatContent
 *   POST /api/v1/native/landers/insert_html_content         → insertHtmlContent
 */

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const LandersController = require('../controllers/nativeLandersController');

function createNativeLandersRoutes(service) {
  const router = Router();

  // Setup multer for file uploads
  const uploadDir = path.join(__dirname, '../../../../storage/nativeData');

  // Create upload directories if they don't exist
  const imageDir = path.join(uploadDir, 'Image');
  const zipDir = path.join(uploadDir, 'zip');

  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }
  if (!fs.existsSync(zipDir)) {
    fs.mkdirSync(zipDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      const folder = file.fieldname === 'media' ? imageDir : zipDir;
      cb(null, folder);
    },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname);
      const filename = `${req.body.ad_id}_${req.body.country}_${req.body.status}_${Date.now()}${ext}`;
      cb(null, filename);
    },
  });

  const upload = multer({
    storage: storage,
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB
    },
  });

  router.get('/landers/get_ads_for_blackhat', async (req, res, next) => {
    return LandersController.getNativeAdsWithCountry(req, res, next, service);
  });

  router.post(
    '/landers/upload_native_blackhat',
    upload.fields([
      { name: 'media', maxCount: 1 },
      { name: 'zip', maxCount: 1 },
    ]),
    async (req, res, next) => {
      return LandersController.uploadBlackhatContent(req, res, next, service);
    }
  );

  router.post('/landers/insert_html_content', async (req, res, next) => {
    return LandersController.insertHtmlContent(req, res, next, service);
  });

  return router;
}

module.exports = createNativeLandersRoutes;

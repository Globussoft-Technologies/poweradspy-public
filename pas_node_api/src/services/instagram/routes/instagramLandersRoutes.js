const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const LandersController = require('../controllers/instagramLandersController');

function createInstagramLandersRoutes(service) {
  const router = express.Router();

  const tempDir = path.join(__dirname, '../../../temp');

  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, tempDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  });

  const upload = multer({ storage });

  router.get(
    '/get-ads-for-blackhat',
    (req, res, next) =>
      LandersController.getInstagramAdsWithCountry(req, res, next, service)
  );

  router.post(
    '/upload_file_to-server',
    upload.fields([
      { name: 'media', maxCount: 1 },
      { name: 'zip', maxCount: 1 },
    ]),
    (req, res, next) =>
      LandersController.uploadBlackhatContent(req, res, next, service)
  );

  router.post(
    '/insert_html_lander',
    (req, res, next) =>
      LandersController.insertHtmlContent(req, res, next, service)
  );

  return router;
}

module.exports = createInstagramLandersRoutes;

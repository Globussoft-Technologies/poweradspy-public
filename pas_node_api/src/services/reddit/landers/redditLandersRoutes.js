'use strict';

/**
 * Reddit landers routes — GET/POST endpoints for lander management.
 * Auto-mounted by ServiceRegistry under /api/v1/reddit.
 *
 *   GET  /api/v1/reddit/landers/get_ads_for_blackhat         → getAdsForLander
 *   POST /api/v1/reddit/landers/upload_reddit_blackhat       → uploadRedditBlackhat (multipart)
 *   POST /api/v1/reddit/landers/insert_reddit_blackhat_html  → insertRedditBlackhatHtml
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
  uploadRedditBlackhat,
  insertRedditBlackhatHtml
} = require('./redditLandersController');

// Multer config for file uploads
const uploadDir = path.join(__dirname, '../../../..', 'tmp', 'reddit-landers');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

function createRedditLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/reddit/landers/get_ads_for_blackhat
  router.get(
    '/landers/get_ads_for_blackhat',
    asyncHandler(async (req, res) => {
      const result = await getAdsForLander(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/landers/upload_reddit_blackhat
  router.post(
    '/landers/upload_reddit_blackhat',
    upload.fields([
      { name: 'media', maxCount: 1 },
      { name: 'zip', maxCount: 1 }
    ]),
    asyncHandler(async (req, res) => {
      const result = await uploadRedditBlackhat(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/reddit/landers/insert_reddit_blackhat_html
  router.post(
    '/landers/insert_reddit_blackhat_html',
    asyncHandler(async (req, res) => {
      const result = await insertRedditBlackhatHtml(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = createRedditLandersRoutes;

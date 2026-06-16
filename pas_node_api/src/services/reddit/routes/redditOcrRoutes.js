'use strict';

/**
 * Reddit OCR/OCB routes — mirrors the quora ocr / native ocr route pattern.
 * Auto-mounted by ServiceRegistry under /api/v1/reddit.
 *
 *   GET  /api/v1/reddit/ocr/getImageUrl         → getImageUrl          (PHP getImageUrl → getImagesUrl)
 *   POST /api/v1/reddit/ocr/updateImageDetails  → updateImageDetails   (PHP updateImageDetails)
 */

const { Router } = require('express');
const RedditOcrController = require('../controllers/redditOcrController');

function createRedditOcrRoutes(service) {
  const router = Router();

  router.get('/ocr/getImageUrl', async (req, res, next) => {
    return RedditOcrController.getImageUrl(req, res, next, service);
  });

  router.post('/ocr/updateImageDetails', async (req, res, next) => {
    return RedditOcrController.updateImageDetails(req, res, next, service);
  });

  return router;
}

module.exports = createRedditOcrRoutes;

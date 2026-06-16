'use strict';

/**
 * Instagram OCR/OCB routes — mirrors the native OCR route pattern.
 * Auto-mounted by ServiceRegistry under /api/v1/instagram.
 *
 *   GET  /api/v1/instagram/ocr/getImageUrl        → getImageUrl          (PHP getImageUrl → AdDetails@getImageUrls)
 *   POST /api/v1/instagram/ocr/updateImageDetails → updateImageDetails   (PHP updateImageDetails)
 */

const { Router } = require('express');
const InstagramOcrController = require('../controllers/instagramOcrController');

function createInstagramOcrRoutes(service) {
  const router = Router();

  router.get('/ocr/getImageUrl', async (req, res, next) => {
    return InstagramOcrController.getImageUrl(req, res, next, service);
  });

  router.post('/ocr/updateImageDetails', async (req, res, next) => {
    return InstagramOcrController.updateImageDetails(req, res, next, service);
  });

  return router;
}

module.exports = createInstagramOcrRoutes;

'use strict';

/**
 * Pinterest OCR/OCB routes — mirrors the native OCR route pattern.
 * Auto-mounted by ServiceRegistry under /api/v1/pinterest (every *.js in
 * routes/ is discovered; this module exports a (service) => Router creator).
 *
 *   GET  /api/v1/pinterest/ocr/get-pinterest-image-url → getImageUrl            (PHP get-pinterest-image-url)
 *   POST /api/v1/pinterest/ocr/update-image-info       → updateImageOcrDetails  (PHP update-image-info)
 *
 * No auth required (faithful to the PHP, which had these outside the jwt.auth group).
 */

const { Router } = require('express');
const PinterestOcrController = require('../controllers/pinterestOcrController');

function createPinterestOcrRoutes(service) {
  const router = Router();

  router.get('/ocr/get-pinterest-image-url', async (req, res, next) => {
    return PinterestOcrController.getImageUrl(req, res, next, service);
  });

  router.post('/ocr/update-image-info', async (req, res, next) => {
    return PinterestOcrController.updateImageOcrDetails(req, res, next, service);
  });

  return router;
}

module.exports = createPinterestOcrRoutes;

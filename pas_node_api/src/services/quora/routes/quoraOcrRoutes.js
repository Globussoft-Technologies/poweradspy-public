'use strict';

/**
 * Quora OCR/OCB routes — mirrors the native ocr / landers / insertion route pattern.
 * Auto-mounted by ServiceRegistry under /api/v1/quora.
 *
 *   GET  /api/v1/quora/ocr/getQuoraImageUrl   → getImageUrl            (PHP getQuoraImageUrl)
 *   POST /api/v1/quora/ocr/update-image-info  → updateImageOcrDetails  (PHP update-image-info)
 */

const { Router } = require('express');
const QuoraOcrController = require('../controllers/quoraOcrController');

function createQuoraOcrRoutes(service) {
  const router = Router();

  router.get('/ocr/getQuoraImageUrl', async (req, res, next) => {
    return QuoraOcrController.getImageUrl(req, res, next, service);
  });

  router.post('/ocr/update-image-info', async (req, res, next) => {
    return QuoraOcrController.updateImageOcrDetails(req, res, next, service);
  });

  return router;
}

module.exports = createQuoraOcrRoutes;

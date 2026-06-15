'use strict';

/**
 * Native OCR/OCB routes — mirrors the landers/insertion route pattern.
 * Auto-mounted by ServiceRegistry under /api/v1/native.
 *
 *   GET  /api/v1/native/ocr/getNativeImageUrl  → getImageUrl            (PHP getNativeImageUrl)
 *   POST /api/v1/native/ocr/update-image-info  → updateImageOcrDetails  (PHP update-image-info)
 */

const { Router } = require('express');
const NativeOcrController = require('../controllers/nativeOcrController');

function createNativeOcrRoutes(service) {
  const router = Router();

  router.get('/ocr/getNativeImageUrl', async (req, res, next) => {
    return NativeOcrController.getImageUrl(req, res, next, service);
  });

  router.post('/ocr/update-image-info', async (req, res, next) => {
    return NativeOcrController.updateImageOcrDetails(req, res, next, service);
  });

  return router;
}

module.exports = createNativeOcrRoutes;

'use strict';

/**
 * Facebook OCR/OCB (image-processing) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/facebook.
 *
 *   GET  /api/v1/facebook/ocr/getFBImageUrl     → Userv2Controller@getImageUrl
 *   POST /api/v1/facebook/ocr/update-image-info → Userv2Controller@updateImageOcrDetails
 *
 * Legacy endpoint names are preserved so the existing OCB/OCR scrapers keep working;
 * they are grouped under /ocr per the OCR-subsystem manifest. Both endpoints are
 * unauthenticated (faithful to the PHP, which had these outside the jwt.auth group)
 * and ALWAYS reply HTTP 200 — the real outcome is the body `code`.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getImageUrl, updateImageOcr } = require('../controllers/facebookOcrController');

function createFacebookOcrRoutes(service) {
  const router = Router();

  // GET /api/v1/facebook/ocr/getFBImageUrl — lease a batch of image ads.
  router.get(
    '/ocr/getFBImageUrl',
    asyncHandler(async (req, res) => {
      const result = await getImageUrl(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  // POST /api/v1/facebook/ocr/update-image-info — persist OCB/OCR results.
  router.post(
    '/ocr/update-image-info',
    asyncHandler(async (req, res) => {
      const result = await updateImageOcr(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  return router;
}

module.exports = createFacebookOcrRoutes;

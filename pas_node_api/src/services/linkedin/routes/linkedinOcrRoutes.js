'use strict';

/**
 * LinkedIn OCR/OCB (image-processing) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/linkedin (default-function export →
 * mounted via the `typeof routeModule === 'function'` branch, same as gdnOcrRoutes).
 *
 *   GET  /api/v1/linkedin/ocr/get-linkedin-image-url → UserController@getImagesUrl
 *   POST /api/v1/linkedin/ocr/update-image-info      → UserController@updateImageOcrDetails
 *
 * Legacy endpoint names are preserved so the existing OCB/OCR scrapers keep working;
 * they are grouped under /ocr per the OCR-subsystem manifest. Both endpoints are
 * unauthenticated (faithful to the PHP) and ALWAYS reply HTTP 200 — the real outcome
 * is the body `code`.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getImageUrl, updateImageOcr } = require('../controllers/linkedinOcrController');

function createLinkedinOcrRoutes(service) {
  const router = Router();

  // GET /api/v1/linkedin/ocr/get-linkedin-image-url — lease a batch of image ads.
  router.get(
    '/ocr/get-linkedin-image-url',
    asyncHandler(async (req, res) => {
      const result = await getImageUrl(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  // POST /api/v1/linkedin/ocr/update-image-info — persist OCB/OCR results.
  router.post(
    '/ocr/update-image-info',
    asyncHandler(async (req, res) => {
      const result = await updateImageOcr(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  return router;
}

module.exports = createLinkedinOcrRoutes;

'use strict';

/**
 * GDN OCR/OCB (image-processing) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/gdn (default-function export →
 * mounted via the `typeof routeModule === 'function'` branch, same as gdnLandersRoutes).
 *
 *   GET  /api/v1/gdn/ocr/getGDNImageUrl        → ApiController@getImageUrl
 *   POST /api/v1/gdn/ocr/insert-GDN-imageUrl-data → ApiController@insertGDNImageData
 *
 * Legacy endpoint names are preserved so the existing OCB/OCR scrapers keep working;
 * they are grouped under /ocr per the OCR-subsystem manifest. Both endpoints are
 * unauthenticated (faithful to the PHP) and ALWAYS reply HTTP 200 — the real outcome
 * is the body `code`.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getImageUrl, updateImageOcr } = require('../controllers/gdnOcrController');

function createGdnOcrRoutes(service) {
  const router = Router();

  // GET /api/v1/gdn/ocr/getGDNImageUrl — lease a batch of image ads.
  router.get(
    '/ocr/getGDNImageUrl',
    asyncHandler(async (req, res) => {
      const result = await getImageUrl(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  // POST /api/v1/gdn/ocr/insert-GDN-imageUrl-data — persist OCB/OCR results.
  router.post(
    '/ocr/insert-GDN-imageUrl-data',
    asyncHandler(async (req, res) => {
      const result = await updateImageOcr(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  return router;
}

module.exports = createGdnOcrRoutes;

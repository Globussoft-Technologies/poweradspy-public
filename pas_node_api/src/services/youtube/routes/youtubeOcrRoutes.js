'use strict';

/**
 * YouTube OCB/OCR (image-processing) routes.
 * Auto-mounted by ServiceRegistry under /api/v1/youtube (default-function export →
 * mounted via the `typeof routeModule === 'function'` branch, like youtubeLandersRoutes).
 *
 *   GET  /api/v1/youtube/ocr/get-ocb-url      → VideoURLController@getOcbUrl
 *   POST /api/v1/youtube/ocr/insert-update-ocb → VideoURLController@insertUpdateOcb
 *
 * Legacy endpoint names preserved so the existing OCB scraper keeps working; grouped
 * under /ocr. Unauthenticated (faithful to the PHP); always replies HTTP 200 — the real
 * outcome is the body `code`.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getOcbUrl, updateOcb } = require('../controllers/youtubeOcrController');

function createYoutubeOcrRoutes(service) {
  const router = Router();

  // GET /api/v1/youtube/ocr/get-ocb-url?type=1 — lease a batch of OCB ads.
  router.get(
    '/ocr/get-ocb-url',
    asyncHandler(async (req, res) => {
      const result = await getOcbUrl(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  // POST /api/v1/youtube/ocr/insert-update-ocb — persist OCB/OCR results.
  router.post(
    '/ocr/insert-update-ocb',
    asyncHandler(async (req, res) => {
      const result = await updateOcb(req, service.db, service.log);
      return res.status(200).json(result);
    })
  );

  return router;
}

module.exports = createYoutubeOcrRoutes;

'use strict';

/**
 * Quora landers routes — GET/POST endpoints for lander management.
 * Auto-mounted by ServiceRegistry under /api/v1/quora.
 *
 *   GET  /api/v1/quora/landers/get-ads-for-lander           → getAdsForLander
 *   POST /api/v1/quora/landers/upload-lander-image-zip      → uploadLanderImageZip (multipart)
 *   POST /api/v1/quora/landers/insert-lander-details-todb   → insertLanderDetailsToDB
 *
 * No auth required (matching PHP routes).
 */

const { Router } = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../../middleware/errorHandler');
const {
  getAdsForLander,
  uploadLanderImageZip,
  insertLanderDetailsToDB
} = require('./quoraLandersController');

// Multer config for file uploads
const upload = multer({ dest: '/tmp/quora-landers/' });

function createQuoraLandersRoutes(service) {
  const router = Router();

  // GET /api/v1/quora/landers/get-ads-for-lander
  router.get(
    '/landers/get-ads-for-lander',
    asyncHandler(async (req, res) => {
      const result = await getAdsForLander(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/landers/upload-lander-image-zip
  router.post(
    '/landers/upload-lander-image-zip',
    upload.fields([
      { name: 'media', maxCount: 1 },
      { name: 'zip', maxCount: 1 }
    ]),
    asyncHandler(async (req, res) => {
      const result = await uploadLanderImageZip(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // POST /api/v1/quora/landers/insert-lander-details-todb
  router.post(
    '/landers/insert-lander-details-todb',
    asyncHandler(async (req, res) => {
      const result = await insertLanderDetailsToDB(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = createQuoraLandersRoutes;

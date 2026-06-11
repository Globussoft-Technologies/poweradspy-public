'use strict';

/**
 * Native insertion routes — mirrors facebookInsertionRoutes.js pattern.
 * Auto-mounted by ServiceRegistry under /api/v1/native.
 *
 *   POST /api/v1/native/insertion/adsData   → NativeAdController@insertAds  (PHP route)
 *   POST /api/v1/native/insertion/delete    → NativeAdController@deleteads
 */

const { Router } = require('express');
const { asyncHandler }     = require('../../../middleware/errorHandler');
const { insertionAuth }    = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth }       = require('../../../middleware/deleteAuth');
const { insertAds, deleteAd } = require('../controllers/nativeAdInsertionController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createNativeInsertionRoutes(service) {
  const router = Router();
  const guard  = [insertionEnabled('native'), insertionAuth];

  // POST /api/v1/native/insertion/adsData
  router.post(
    '/insertion/adsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await insertAds(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/native/insertion/delete
  router.post(
    '/insertion/delete',
    insertionEnabled('native'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createNativeInsertionRoutes;

'use strict';

/**
 * Facebook insertion routes (NEW, parallel to facebookRoutes.js — does not touch it).
 * Auto-mounted by ServiceRegistry under /api/v1/facebook.
 *
 *   POST /api/v1/facebook/insertion/metaAdsData  → adsDataController@adsdata
 *   POST /api/v1/facebook/insertion/adsLibrary   → adsDataController@adsLibraryInsert
 *
 * Guards (in order): insertionEnabled('facebook') → insertionAuth (x-signature / platform bypass).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { metaAdsData } = require('../controllers/metaAdsDataController');
const { adsLibrary } = require('../controllers/adsLibraryController');
const { deleteAd } = require('../controllers/deleteAdController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createFacebookInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('facebook'), insertionAuth];

  // POST /api/v1/facebook/insertion/metaAdsData
  router.post(
    '/insertion/metaAdsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await metaAdsData(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/facebook/insertion/adsLibrary
  router.post(
    '/insertion/adsLibrary',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await adsLibrary(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/facebook/insertion/delete — secure delete (token-guarded)
  router.post(
    '/insertion/delete',
    insertionEnabled('facebook'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createFacebookInsertionRoutes;

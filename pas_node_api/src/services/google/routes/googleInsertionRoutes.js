'use strict';

/**
 * GTEXT (Google Text) insertion routes (NEW, parallel to googleRoutes.js — does not touch it).
 * Auto-mounted by ServiceRegistry under /api/v1/google.
 *
 *   POST /api/v1/google/insertion/gtAdsData → GoogleTextAdController@insertAdsFromPluginO
 *   POST /api/v1/google/insertion/delete    → UserController@deleteads
 *
 * Guards: insertionEnabled('google') → insertionAuth (x-signature / platform bypass).
 * Delete uses deleteAuth (x-delete-token / body.token).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { gtAdsData } = require('../controllers/gtAdsDataController');
const { deleteAd } = require('../controllers/deleteAdController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createGoogleInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('google'), insertionAuth];

  // POST /api/v1/google/insertion/gtAdsData
  router.post(
    '/insertion/gtAdsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await gtAdsData(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/google/insertion/delete — secure delete (token-guarded)
  router.post(
    '/insertion/delete',
    insertionEnabled('google'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createGoogleInsertionRoutes;

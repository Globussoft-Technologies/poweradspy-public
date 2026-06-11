'use strict';

/**
 * LinkedIn insertion routes (NEW, parallel to linkedinRoutes.js — does not touch it).
 * Auto-mounted by ServiceRegistry under /api/v1/linkedin.
 *
 *   POST /api/v1/linkedin/insertion/lnAdsData → adsDataController@adsdata
 *   POST /api/v1/linkedin/insertion/delete    → UserController@deleteads
 *
 * Guards: insertionEnabled('linkedin') → insertionAuth (x-signature / platform bypass).
 * Delete uses deleteAuth (x-delete-token / body.token) instead of signature.
 *
 * NOTE: exported as a default function — ServiceRegistry's creator-name lookup
 * (createLinkedinRoutes) belongs to linkedinRoutes.js; this file is mounted via the
 * `typeof routeModule === 'function'` fallback branch.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { lnAdsData } = require('../controllers/lnAdsDataController');
const { deleteAd } = require('../controllers/deleteAdController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createLinkedinInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('linkedin'), insertionAuth];

  // POST /api/v1/linkedin/insertion/lnAdsData
  router.post(
    '/insertion/lnAdsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await lnAdsData(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/linkedin/insertion/delete — secure delete (token-guarded)
  router.post(
    '/insertion/delete',
    insertionEnabled('linkedin'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createLinkedinInsertionRoutes;

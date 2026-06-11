'use strict';

/**
 * GDN insertion routes (NEW, parallel to gdnRoutes.js — does not touch it).
 * Auto-mounted by ServiceRegistry under /api/v1/gdn.
 *
 *   POST /api/v1/gdn/insertion/gdnAdsData → GdnAdController@insertAds
 *   POST /api/v1/gdn/insertion/delete      → UserController@deleteads
 *
 * Guards: insertionEnabled('gdn') → insertionAuth (x-signature / platform bypass).
 * Delete uses deleteAuth (x-delete-token / body.token) instead of signature.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { metaAdsData } = require('../controllers/metaAdsDataController');
const { deleteAd } = require('../controllers/deleteAdController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createGdnInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('gdn'), insertionAuth];

  // POST /api/v1/gdn/insertion/gdnAdsData
  router.post(
    '/insertion/gdnAdsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await metaAdsData(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/gdn/insertion/delete — secure delete (token-guarded)
  router.post(
    '/insertion/delete',
    insertionEnabled('gdn'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createGdnInsertionRoutes;

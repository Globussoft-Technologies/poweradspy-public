'use strict';

/**
 * Quora insertion routes (NEW, parallel to quoraRoutes.js).
 * Auto-mounted by ServiceRegistry under /api/v1/quora.
 *
 *   POST /api/v1/quora/insertion/quoraAdsData  → quoraAdsDataController@quoraAdsData
 *   POST /api/v1/quora/insertion/delete        → deleteAdController@deleteAd
 *
 * Guards: insertionEnabled('quora') → insertionAuth (x-signature / platform bypass).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { quoraAdsData } = require('../controllers/quoraAdsDataController');
const { deleteAd } = require('../controllers/deleteAdController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createQuoraInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('quora'), insertionAuth];

  // POST /api/v1/quora/insertion/quoraAdsData
  router.post(
    '/insertion/quoraAdsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await quoraAdsData(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/quora/insertion/delete — secure delete (token-guarded)
  router.post(
    '/insertion/delete',
    insertionEnabled('quora'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createQuoraInsertionRoutes;

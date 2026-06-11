'use strict';

/**
 * Reddit insertion routes (NEW, parallel to redditRoutes.js).
 * Auto-mounted by ServiceRegistry under /api/v1/reddit.
 *
 *   POST /api/v1/reddit/insertion/redAdsData   → redditAdsDataController@redditAdsData
 *   POST /api/v1/reddit/insertion/delete        → deleteAdController@deleteAd
 *
 * Guards: insertionEnabled('reddit') → insertionAuth (x-signature / platform bypass).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { redditAdsData } = require('../controllers/redditAdsDataController');
const { deleteAd } = require('../controllers/deleteAdController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createRedditInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('reddit'), insertionAuth];

  // POST /api/v1/reddit/insertion/redAdsData
  router.post(
    '/insertion/redAdsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await redditAdsData(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/reddit/insertion/delete — secure delete (token-guarded)
  router.post(
    '/insertion/delete',
    insertionEnabled('reddit'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createRedditInsertionRoutes;

'use strict';

/**
 * Pinterest insertion routes — auto-mounted by ServiceRegistry under /api/v1/pinterest.
 *
 *   POST /api/v1/pinterest/insertion/pintAdsData  → adsController@insertAds (PHP route)
 *   POST /api/v1/pinterest/insertion/delete       → adsController@deleteads
 */

const { Router } = require('express');
const { asyncHandler }     = require('../../../middleware/errorHandler');
const { insertionAuth }    = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth }       = require('../../../middleware/deleteAuth');
const { insertAds, deleteAd } = require('../controllers/pinterestAdInsertionController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createPinterestInsertionRoutes(service) {
  const router = Router();
  const guard  = [insertionEnabled('pinterest'), insertionAuth];

  // POST /api/v1/pinterest/insertion/pintAdsData
  router.post(
    '/insertion/pintAdsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await insertAds(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/pinterest/insertion/delete
  router.post(
    '/insertion/delete',
    insertionEnabled('pinterest'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createPinterestInsertionRoutes;

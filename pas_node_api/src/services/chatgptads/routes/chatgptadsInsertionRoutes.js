'use strict';

/**
 * ChatGPT Ads insertion routes. Auto-mounted by ServiceRegistry under /api/v1/chatgptads.
 *
 *   POST /api/v1/chatgptads/insertion/adsData  → chatgptadsDataController@adsData
 *   POST /api/v1/chatgptads/insertion/delete   → deleteAdController@deleteAd
 *
 * Only ONE insertion endpoint (not facebook's metaAdsData+adsLibrary pair) — see
 * docs/insertion/chatgptads/MANIFEST.md §1/§6 for why. Named `adsData`, matching the
 * single-endpoint convention Native uses for the same "only one real pipeline" shape
 * (POST /api/v1/native/insertion/adsData).
 *
 * Guards (in order): insertionEnabled('chatgptads') → insertionAuth (x-signature / platform bypass).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { adsData } = require('../controllers/chatgptadsDataController');
const { deleteAd } = require('../controllers/deleteAdController');

function createChatgptadsInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('chatgptads'), insertionAuth];

  router.post(
    '/insertion/adsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await adsData(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  router.post(
    '/insertion/delete',
    insertionEnabled('chatgptads'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );

  return router;
}

module.exports = createChatgptadsInsertionRoutes;

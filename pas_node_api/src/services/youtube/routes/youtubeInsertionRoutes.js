'use strict';

/**
 * YouTube insertion routes (NEW, parallel to youtubeRoutes.js — does not touch it).
 * Auto-mounted by ServiceRegistry under /api/v1/youtube.
 *
 *   POST /api/v1/youtube/insertion/ytAdsData → YoutubeAdController@insertNewYoutubeAds
 *   POST /api/v1/youtube/insertion/delete    → YoutubeAdController@deleteads
 *
 * Guards: insertionEnabled('youtube') → insertionAuth (x-signature / platform-12 bypass).
 * Delete uses deleteAuth (x-delete-token / body.token).
 *
 * Exported as a default function — ServiceRegistry's creator-name lookup (createYoutubeRoutes)
 * belongs to youtubeRoutes.js; this file mounts via the `typeof routeModule === 'function'` branch.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { ytAdsData } = require('../controllers/ytAdsDataController');
const { deleteAd } = require('../controllers/deleteAdController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createYoutubeInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('youtube'), insertionAuth];

  // POST /api/v1/youtube/insertion/ytAdsData
  router.post(
    '/insertion/ytAdsData',
    ...guard,
    asyncHandler(async (req, res) => {
      const result = await ytAdsData(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  // POST /api/v1/youtube/insertion/delete — secure delete (token-guarded)
  router.post(
    '/insertion/delete',
    insertionEnabled('youtube'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(httpStatus(result.code)).json(result);
    })
  );

  return router;
}

module.exports = createYoutubeInsertionRoutes;

'use strict';

/**
 * YouTube Adversuite API Routes — mirrors legacy PHP endpoints from
 * api_youtube/UserController.php that don't fit into the ad-search /
 * hide-ads / insights routers.
 *
 * Mounted under `/adversuite` from youtubeRoutes.js so full paths become:
 *   GET /api/v1/youtube/adversuite/getLocation
 *   GET /api/v1/youtube/adversuite/get-call-to-actions
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const { getLocation, getCallToActions } = require('../controllers/adversuite_Api_Controller');

function createYoutubeAdversuiteRoutes(service) {
  const router = Router();

  // GET /getLocation — Mirrors PHP UserController@getLocation (api_youtube).
  router.get(
    '/getLocation',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLocation(req, service.db, service.log);
      return res.status(result.code === 202 || result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // GET /get-call-to-actions — Mirrors PHP UserController@getCallToActions.
  // No DB read; 60 hardcoded CTA labels.
  router.get(
    '/get-call-to-actions',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getCallToActions(req, service.db, service.log);
      return res.status(result.code === 202 || result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = createYoutubeAdversuiteRoutes;

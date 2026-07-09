'use strict';

/**
 * Google Adversuite API Routes — mirrors legacy PHP endpoints from
 * api_gtext/UserController.php that don't fit into the ad-search /
 * hide-ads / insights routers.
 *
 * Mounted under `/adversuite` from googleRoutes.js so full paths become:
 *   GET /api/v1/google/adversuite/getLocation
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const { getLocation } = require('../controllers/adversuite_Api_Controller');

function createGoogleAdversuiteRoutes(service) {
  const router = Router();

  // GET /getLocation — Mirrors PHP UserController@getLocation (api_gtext).
  router.get(
    '/getLocation',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLocation(req, service.db, service.log);
      return res.status(result.code === 202 || result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = createGoogleAdversuiteRoutes;

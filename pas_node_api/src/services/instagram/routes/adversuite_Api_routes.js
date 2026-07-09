'use strict';

/**
 * Instagram Adversuite API Routes — mirrors legacy PHP endpoints from
 * api_instagram/UserController.php that don't fit into the ad-search /
 * hide-ads / insights routers.
 *
 * Mounted under `/adversuite` from instagramRoutes.js so full paths become:
 *   GET /api/v1/instagram/adversuite/getLocation
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const { getLocation } = require('../controllers/adversuite_Api_Controller');

function createInstagramAdversuiteRoutes(service) {
  const router = Router();

  // GET /getLocation — Mirrors PHP UserController@getLocation (api_instagram).
  // Returns { code: 202, data: [{country}, ...] } (202 preserved for PHP parity).
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

module.exports = createInstagramAdversuiteRoutes;

'use strict';

/**
 * Facebook Adversuite API Routes — mirrors legacy PHP endpoints from
 * api/Userv2Controller.php, adsDataController.php and AdDetails.php that don't
 * fit into the ad-search / hide-ads / insights routers.
 *
 * Mounted under `/adversuite` from facebookRoutes.js so full paths become:
 *   POST /api/v1/facebook/adversuite/insert_free_plan
 *   POST /api/v1/facebook/adversuite/insert_user_data
 *   GET  /api/v1/facebook/adversuite/getLocation
 *   GET  /api/v1/facebook/adversuite/getCalltoAction
 *   GET  /api/v1/facebook/adversuite/get-available-tags
 *   GET  /api/v1/facebook/adversuite/get_all_language
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authMiddleware } = require('../../../middleware/auth');
const {
  insertFreePlan,
  insertUserData,
  getLocation,
  getCalltoAction,
  getAvailableTags,
  getAllLanguage,
} = require('../controllers/adversuite_Api_Controller');

function createFacebookAdversuiteRoutes(service) {
  const router = Router();

  // ─── Insert Free Plan ─────────────────────────────────
  // POST /insert_free_plan — Mirrors PHP Userv2Controller@insert_free_plan.
  router.post(
    '/insert_free_plan',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await insertFreePlan(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Insert User Data (user_socket upsert) ─────────────
  // POST /insert_user_data — Mirrors PHP adsDataController@insert_user_data.
  router.post(
    '/insert_user_data',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await insertUserData(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Location list (country dropdown) ──────────────────
  // GET /getLocation — Mirrors PHP Userv2Controller@getLocation.
  // Returns 202 on success (PHP parity).
  router.get(
    '/getLocation',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getLocation(req, service.db, service.log);
      return res.status(result.code === 202 || result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Call-to-Action dropdown list ──────────────────────
  // GET /getCalltoAction — Mirrors PHP Userv2Controller@getCalltoAction.
  // Hardcoded 88-item list, no DB read.
  router.get(
    '/getCalltoAction',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getCalltoAction(req, service.db, service.log);
      return res.status(result.code === 202 || result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── Available Niches / Tags ───────────────────────────
  // GET /get-available-tags — Mirrors PHP Userv2Controller@getAvailableTags.
  router.get(
    '/get-available-tags',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAvailableTags(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  // ─── All Languages (iso + name) ────────────────────────
  // GET /get_all_language — Mirrors PHP Userv2Controller@get_all_language.
  // The PHP handler returned the raw array (no envelope), so we do the same.
  router.get(
    '/get_all_language',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAllLanguage(req, service.db, service.log);
      // Raw array on success; error object with `code` on failure.
      if (Array.isArray(result)) return res.status(200).json(result);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = createFacebookAdversuiteRoutes;

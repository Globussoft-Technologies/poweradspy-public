'use strict';

/**
 * ChatGPT Ads built-with / outgoing scrape queue routes.
 * Auto-mounted by ServiceRegistry under /api/v1/chatgptads.
 *
 * Worker endpoints — no auth (same as facebook).
 *   GET  /api/v1/chatgptads/built-with/getUrlsForOutgoingBuiltWith
 *   POST /api/v1/chatgptads/built-with/updateOutgoingBuiltWithStatus
 *
 * Same endpoint names as facebook's built-with routes so the existing worker can be
 * pointed at this network unchanged.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { getUrlsForOutgoingBuiltWith, updateOutgoingBuiltWithStatus } = require('../controllers/built-withController');

function createChatgptadsBuiltWithRoutes(service) {
  const router = Router();

  router.get(
    '/built-with/getUrlsForOutgoingBuiltWith',
    asyncHandler(async (req, res) => {
      const result = await getUrlsForOutgoingBuiltWith(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  router.post(
    '/built-with/updateOutgoingBuiltWithStatus',
    asyncHandler(async (req, res) => {
      const result = await updateOutgoingBuiltWithStatus(req, service.db, service.log);
      return res.status(result.code === 200 ? 200 : result.code).json(result);
    })
  );

  return router;
}

module.exports = createChatgptadsBuiltWithRoutes;

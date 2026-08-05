'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { authMiddleware } = require('../../../middleware/auth');
const { planAccessMiddleware } = require('../../../middleware/planAccess');
const { requireCapability } = require('../../planControl/registries/routeClassification');
const controller = require('../controllers/admobInsertionController');
const { searchAds } = require('../controllers/adSearchController');

function createAdmobRoutes(service) {
  const router = Router();
  router.post(
    '/ads/search',
    authMiddleware,
    requireCapability('ads.search', { network: () => 'admob' }),
    planAccessMiddleware,
    asyncHandler(async (req, res) => {
      const result = await searchAds(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
  router.post(
    '/insertion/adsData',
    insertionEnabled('admob'),
    insertionAuth,
    asyncHandler(async (req, res) => {
      const result = await controller.insertAds(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
  return router;
}

module.exports = { createAdmobRoutes };

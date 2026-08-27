'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { authMiddleware } = require('../../../middleware/auth');
const controller = require('../controllers/admobInsertionController');
const { searchAds, getAdSessions } = require('../controllers/adSearchController');
const { hideAds, getHiddenPostOwners, unHide } = require('../controllers/hideAdsController');
const { deleteAd } = require('../controllers/deleteAdController');

function createAdmobRoutes(service) {
  const router = Router();
  router.post(
    '/ads/search',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await searchAds(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
  router.post(
    '/ads/sessions',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getAdSessions(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
  router.post(
    '/ads/hide_ads',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await hideAds(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
  router.post(
    '/ads/getHiddenPostOwners',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await getHiddenPostOwners(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
  router.post(
    '/ads/un-hide',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const result = await unHide(req, service.db, service.log);
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
  router.post(
    '/insertion/delete',
    insertionEnabled('admob'),
    deleteAuth,
    asyncHandler(async (req, res) => {
      const result = await deleteAd(req, service.db, service.log);
      return res.status(result.code).json(result);
    })
  );
  return router;
}

module.exports = { createAdmobRoutes };

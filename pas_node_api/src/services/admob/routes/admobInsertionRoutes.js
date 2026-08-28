'use strict';

/**
 * AdMob insertion routes (mirrors facebookInsertionRoutes.js — insertion-only,
 * search/read endpoints moved out to admobRoutes.js).
 *
 *   POST /api/v1/admob/insertion/adsData
 *   POST /api/v1/admob/insertion/delete
 *
 * Guards: insertionEnabled('admob') -> insertionAuth (x-signature / platform
 * bypass) for adsData, deleteAuth (x-delete-token) for delete.
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const controller = require('../controllers/admobInsertionController');
const { deleteAd } = require('../controllers/deleteAdController');

function createAdmobRoutes(service) {
  const router = Router();
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

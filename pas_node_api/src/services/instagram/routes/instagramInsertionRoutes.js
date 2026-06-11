'use strict';

/**
 * Instagram insertion routes (NEW, parallel to instagramRoutes.js — does not touch it).
 * Auto-mounted by ServiceRegistry under /api/v1/instagram.
 *
 *   POST /api/v1/instagram/insertion/gramAdsData → InstagramUserController@instaAdsData
 *   POST /api/v1/instagram/insertion/adsLibrary  → InstagramUserController@adsLibraryInsert
 *   POST /api/v1/instagram/insertion/delete       → InstagramUserController@deleteads
 *
 * Guards: insertionEnabled('instagram') → insertionAuth (x-signature / platform bypass).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { deleteAuth } = require('../../../middleware/deleteAuth');
const { gramAdsData } = require('../controllers/gramAdsDataController');
const { adsLibrary } = require('../controllers/adsLibraryController');
const { deleteAd } = require('../controllers/deleteAdController');

const httpStatus = (code) => (code === 200 ? 200 : code);

function createInstagramInsertionRoutes(service) {
  const router = Router();
  const guard = [insertionEnabled('instagram'), insertionAuth];

  router.post('/insertion/gramAdsData', ...guard, asyncHandler(async (req, res) => {
    const result = await gramAdsData(req, service.db, service.log);
    return res.status(httpStatus(result.code)).json(result);
  }));

  router.post('/insertion/adsLibrary', ...guard, asyncHandler(async (req, res) => {
    const result = await adsLibrary(req, service.db, service.log);
    return res.status(httpStatus(result.code)).json(result);
  }));

  router.post('/insertion/delete', insertionEnabled('instagram'), deleteAuth, asyncHandler(async (req, res) => {
    const result = await deleteAd(req, service.db, service.log);
    return res.status(httpStatus(result.code)).json(result);
  }));

  return router;
}

module.exports = createInstagramInsertionRoutes;

'use strict';

/**
 * Mounted before googleInsertionRoutes.js by filename. It intercepts platform 18
 * on the existing gtAdsData URL; requests containing no platform-18 item fall
 * through to the untouched legacy Google insertion router.
 */
const { Router } = require('express');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { insertionAuth } = require('../../../middleware/insertionAuth');
const { insertionEnabled } = require('../../../middleware/insertionEnabled');
const { googleTransparencyAds } = require('../controllers/googleTransparencyAdsController');

function items(body) {
  return Array.isArray(body) ? body : Array.isArray(body?.ads) ? body.ads : [body];
}

function containsPlatform18(req, _res, next) {
  if (!items(req.body).some((ad) => Number(ad?.platform) === 18)) return next('router');
  return next();
}

function createGoogle18TransparencyInsertionRoutes(service) {
  const router = Router();
  const handler = asyncHandler(async (req, res) => {
    const result = await googleTransparencyAds(req, service.db, service.log);
    return res.status(result.code === 200 ? 200 : result.code).json(result);
  });

  router.post(
    '/insertion/gtAdsData',
    containsPlatform18,
    insertionEnabled('google'),
    insertionAuth,
    handler
  );
  return router;
}

module.exports = createGoogle18TransparencyInsertionRoutes;

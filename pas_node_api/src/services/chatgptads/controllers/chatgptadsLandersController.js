'use strict';

/**
 * ChatGPT Ads landers controller (thin).
 *
 * Delegates to the three landers services. Each returns a plain
 * { code, message, ... } object; the route maps `code` to the HTTP status.
 * Mirrors facebook/controllers/facebookLandersController.js.
 */

const { getAdwithCountryCode } = require('../landers/getAdsService');
const { uploadFileToServer } = require('../landers/uploadService');
const { insertHtmlRedirectCountry } = require('../landers/insertHtmlService');

async function getAds(req, db, log) {
  return getAdwithCountryCode(db, log);
}

async function uploadFiles(req, db, log) {
  return uploadFileToServer(req, log);
}

async function insertHtml(req, db, log) {
  return insertHtmlRedirectCountry(req, db, log);
}

module.exports = { getAds, uploadFiles, insertHtml };

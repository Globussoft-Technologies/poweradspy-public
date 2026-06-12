'use strict';

/**
 * LinkedIn landers controller (thin) — mirrors youtube/controllers/youtubeLandersController.js.
 * Delegates to the three landers services; each returns a { code, message, ... } object whose
 * `code` the route maps to the HTTP status.
 */

const { getLinkedinAdsWithCountry } = require('../landers/getAdsService');
const { uploadBlackhatContent } = require('../landers/uploadService');
const { insertHtmlContent } = require('../landers/insertHtmlService');

async function getAds(req, db, log) {
  return getLinkedinAdsWithCountry(db, log);
}

async function uploadFiles(req, db, log) {
  return uploadBlackhatContent(req, log);
}

async function insertHtml(req, db, log) {
  return insertHtmlContent(req, db, log);
}

module.exports = { getAds, uploadFiles, insertHtml };

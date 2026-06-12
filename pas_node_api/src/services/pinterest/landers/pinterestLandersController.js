'use strict';

const { getAdsForBlackhat } = require('./getAdsService');
const { uploadBlackhatContent } = require('./uploadService');
const { insertHtmlRedirectCountry } = require('./insertHtmlService');

async function getAdsForLander(req, db, log) {
  return getAdsForBlackhat(db, log);
}

async function uploadPinterestBlackhat(req, db, log) {
  return uploadBlackhatContent(req);
}

async function insertPinterestHtml(req, db, log) {
  return insertHtmlRedirectCountry(req, db, log);
}

module.exports = {
  getAdsForLander,
  uploadPinterestBlackhat,
  insertPinterestHtml
};

'use strict';

const { getAdwithCountryCode } = require('./getAdsService');
const { uploadBlackhatContent } = require('./uploadService');
const { insertHtmlRedirectCountry } = require('./insertHtmlService');

async function getAdsForLander(req, db, log) {
  return getAdwithCountryCode(db, log);
}

async function uploadLanderImageZip(req, db, log) {
  return uploadBlackhatContent(req);
}

async function insertLanderDetailsToDB(req, db, log) {
  return insertHtmlRedirectCountry(req, db, log);
}

module.exports = {
  getAdsForLander,
  uploadLanderImageZip,
  insertLanderDetailsToDB
};

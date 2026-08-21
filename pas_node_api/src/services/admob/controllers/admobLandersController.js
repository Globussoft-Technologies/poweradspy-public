'use strict';

const { getAdmobAdsWithCountry } = require('../landers/getAdsService');
const { uploadAdmobBlackhatContent } = require('../landers/uploadService');
const { insertHtmlContent } = require('../landers/insertHtmlService');

async function getAds(req, db, log) {
  return getAdmobAdsWithCountry(req, db, log);
}

async function uploadFiles(req, db, log) {
  return uploadAdmobBlackhatContent(req, log);
}

async function insertHtml(req, db, log) {
  return insertHtmlContent(req, db, log);
}

module.exports = { getAds, uploadFiles, insertHtml };

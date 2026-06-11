'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../instagram/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getLikeCommentShareDetails,
  getInstagramAdCountry,
  getInstagramUserData,
  getRedirectOutgoingUrls,
  getAdsLibUserData,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
} = require('../../instagram/controllers/adInsightsController');
const { getAdDetails } = require('../../instagram/controllers/adDetailController');

const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ ad_id: p.instagram_ad_id, user_id: p.user_id, language: p.language }),
  },
  {
    key: 'advertiserLCSData',
    fn: getAdvertiserLCSData,
    payload: (p) => ({ instagram_ad_id: p.instagram_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ instagram_ad_id: p.instagram_ad_id, user_id: p.user_id }),
  },
  {
    key: 'lcs',
    fn: getLikeCommentShareDetails,
    payload: (p) => ({ instagram_ad_id: p.instagram_ad_id, user_id: p.user_id }),
  },
  {
    key: 'country',
    fn: getInstagramAdCountry,
    payload: (p) => ({ instagram_ad_id: p.instagram_ad_id, user_id: p.user_id }),
  },
  {
    key: 'userData',
    fn: getInstagramUserData,
    payload: (p) => ({ instagram_ad_id: p.instagram_ad_id, user_id: p.user_id }),
  },
  {
    key: 'outgoingLinks',
    fn: getRedirectOutgoingUrls,
    payload: (p) => ({ instagram_ad_id: p.instagram_ad_id, user_id: p.user_id }),
  },
  {
    key: 'adsLibUserData',
    fn: getAdsLibUserData,
    payload: (p) => ({ instagram_ad_id: p.instagram_ad_id, user_id: p.user_id }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.instagram_ad_id || !p.user_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: instagram_ad_id and user_id are required' });
  }

  const service = serviceRegistry.getService('instagram');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'Instagram service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

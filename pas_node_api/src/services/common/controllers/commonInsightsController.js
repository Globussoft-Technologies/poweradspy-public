'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../facebook/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getLikeCommentShareDetails,
  getFacebookAdCountry,
  getFacebookUserData,
  getFacebookOutgoings,
  getAdsPageDetails,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserUserData
} = require('../../facebook/controllers/adInsightsController');
const {
  getAdDetails
} = require('../../facebook/controllers/adDetailController');

/**
 * Insight registry — config-driven list of fetchers.
 * To add a new insight in the future, just push an entry here.
 */
const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ ad_id: p.facebook_ad_id, user_id: p.user_id, language: p.language }),
  },
  {
    key: 'advertiserLCSData',
    fn: getAdvertiserLCSData,
    payload: (p) => ({ facebook_ad_id: p.facebook_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ facebook_ad_id: p.facebook_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserUserData',
    fn: getAdvertiserUserData,
    payload: (p) => ({ facebook_ad_id: p.facebook_ad_id, user_id: p.user_id }),
  },
  {
    key: 'lcs',
    fn: getLikeCommentShareDetails,
    payload: (p) => ({ facebook_ad_id: p.facebook_ad_id, user_id: p.user_id }),
  },
  {
    key: 'country',
    fn: getFacebookAdCountry,
    payload: (p) => ({ facebook_ad_id: p.facebook_ad_id, user_id: p.user_id }),
  },
  {
    key: 'userData',
    fn: getFacebookUserData,
    payload: (p) => ({ facebook_ad_id: p.facebook_ad_id, user_id: p.user_id }),
  },
  {
    key: 'outgoingLinks',
    fn: getFacebookOutgoings,
    payload: (p) => ({ ad_id: p.facebook_ad_id }),
  },
  {
    key: 'pageDetails',
    fn: getAdsPageDetails,
    payload: (p) => ({ facebook_ad_id: p.facebook_ad_id, user_id: p.user_id }),
    condition: (p) => parseInt(p.platform, 10) === 15,
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.facebook_ad_id || !p.user_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: facebook_ad_id and user_id are required' });
  }

  const fbService = serviceRegistry.getService('facebook');
  if (!fbService) {
    return res.status(503).json({ code: 503, message: 'Facebook service not available' });
  }
  const { db, log: logger } = fbService;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

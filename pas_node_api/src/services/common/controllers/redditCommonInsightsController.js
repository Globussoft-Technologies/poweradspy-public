'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../reddit/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getLikeCommentShareDetails,
  getRedditAdCountry,
  getRedirectOutgoingUrls,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
} = require('../../reddit/controllers/adInsightsController');
const { getAdDetails } = require('../../reddit/controllers/adDetailController');

const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ ad_id: p.reddit_ad_id, user_id: p.user_id, language: p.language }),
  },
  {
    key: 'advertiserLCSData',
    fn: getAdvertiserLCSData,
    payload: (p) => ({ reddit_ad_id: p.reddit_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ reddit_ad_id: p.reddit_ad_id, user_id: p.user_id }),
  },
  {
    key: 'lcs',
    fn: getLikeCommentShareDetails,
    payload: (p) => ({ reddit_ad_id: p.reddit_ad_id, user_id: p.user_id }),
  },
  {
    key: 'country',
    fn: getRedditAdCountry,
    payload: (p) => ({ reddit_ad_id: p.reddit_ad_id, user_id: p.user_id }),
  },
  {
    key: 'outgoingLinks',
    fn: getRedirectOutgoingUrls,
    payload: (p) => ({ reddit_ad_id: p.reddit_ad_id, user_id: p.user_id }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.reddit_ad_id || !p.user_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: reddit_ad_id and user_id are required' });
  }

  const service = serviceRegistry.getService('reddit');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'Reddit service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

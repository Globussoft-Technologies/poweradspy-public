'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../linkedin/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getLikeCommentFollowerCount,
  getLinkedinAdCountry,
  getLinkedinOutgoings,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
} = require('../../linkedin/controllers/adInsightsController');
const { getAdDetails } = require('../../linkedin/controllers/adDetailController');

const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ ad_id: p.linkedin_ad_id, user_id: p.user_id, language: p.language }),
  },
  {
    key: 'advertiserLCSData',
    fn: getAdvertiserLCSData,
    payload: (p) => ({ linkedin_ad_id: p.linkedin_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ linkedin_ad_id: p.linkedin_ad_id, user_id: p.user_id }),
  },
  {
    key: 'lcs',
    fn: getLikeCommentFollowerCount,
    payload: (p) => ({ linkedin_ad_id: p.linkedin_ad_id, user_id: p.user_id }),
  },
  {
    key: 'country',
    fn: getLinkedinAdCountry,
    payload: (p) => ({ linkedin_ad_id: p.linkedin_ad_id, user_id: p.user_id }),
  },
  {
    key: 'outgoingLinks',
    fn: getLinkedinOutgoings,
    payload: (p) => ({ linkedin_ad_id: p.linkedin_ad_id }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.linkedin_ad_id || !p.user_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: linkedin_ad_id and user_id are required' });
  }

  const service = serviceRegistry.getService('linkedin');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'LinkedIn service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

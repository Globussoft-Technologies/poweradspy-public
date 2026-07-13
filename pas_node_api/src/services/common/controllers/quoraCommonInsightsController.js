'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../quora/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getLikeCommentShareDetails,
  getQuoraAdCountry,
  getQuoraOutgoings,
  getQuoraUserData,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
} = require('../../quora/controllers/adInsightsController');
const { getAdDetails } = require('../../quora/controllers/adDetailController');

const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ ad_id: p.quora_ad_id, user_id: p.user_id, language: p.language }),
  },
  {
    key: 'advertiserLCSData',
    fn: getAdvertiserLCSData,
    payload: (p) => ({ quora_ad_id: p.quora_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ quora_ad_id: p.quora_ad_id, user_id: p.user_id }),
  },
  {
    key: 'lcs',
    fn: getLikeCommentShareDetails,
    payload: (p) => ({ quora_ad_id: p.quora_ad_id, user_id: p.user_id }),
  },
  {
    key: 'country',
    fn: getQuoraAdCountry,
    payload: (p) => ({ quora_ad_id: p.quora_ad_id, user_id: p.user_id }),
  },
  {
    key: 'outgoingLinks',
    fn: getQuoraOutgoings,
    payload: (p) => ({ ad_id: p.quora_ad_id, user_id: p.user_id }),
  },
  {
    key: 'userData',
    fn: getQuoraUserData,
    payload: (p) => ({ quora_ad_id: p.quora_ad_id, user_id: p.user_id }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.quora_ad_id || !p.user_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: quora_ad_id and user_id are required' });
  }

  const service = serviceRegistry.getService('quora');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'Quora service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

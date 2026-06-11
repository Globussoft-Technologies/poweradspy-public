'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../tiktok/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getLCS,
  getAnalytics,
  getIndustries,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
} = require('../../tiktok/controllers/adInsightsController');

const INSIGHT_REGISTRY = [
  {
    key: 'analytics',
    fn: getAnalytics,
    payload: (p) => ({ ad_id: p.tiktok_ad_id || p.ad_id, user_id: p.user_id }),
  },
  {
    key: 'lcs',
    fn: getLCS,
    payload: (p) => ({ ad_id: p.tiktok_ad_id || p.ad_id, user_id: p.user_id }),
  },
  {
    key: 'industries',
    fn: getIndustries,
    payload: () => ({}),
  },
  {
    key: 'advertiserLCSData',
    fn: getAdvertiserLCSData,
    payload: (p) => ({ tiktok_ad_id: p.tiktok_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ tiktok_ad_id: p.tiktok_ad_id, user_id: p.user_id }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.tiktok_ad_id && !p.ad_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: tiktok_ad_id (or ad_id) is required' });
  }

  const service = serviceRegistry.getService('tiktok');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'TikTok service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

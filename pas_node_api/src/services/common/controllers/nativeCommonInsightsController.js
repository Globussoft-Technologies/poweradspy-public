'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../native/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getNativeAdCountry,
  getTargetSite,
  getAdNetwork,
  getRedirect,
  getRedirectOutgoingUrls,
  getAdvertiserCountryData,
} = require('../../native/controllers/adInsightsController');
const { getAdDetails } = require('../../native/controllers/adDetailController');

const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ ad_id: p.native_ad_id, user_id: p.user_id, language: p.language }),
  },
  {
    key: 'country',
    fn: getNativeAdCountry,
    payload: (p) => ({ native_ad_id: p.native_ad_id, user_id: p.user_id }),
  },
  {
    key: 'targetSite',
    fn: getTargetSite,
    payload: (p) => ({ ad_id: p.native_ad_id }),
  },
  {
    key: 'adNetwork',
    fn: getAdNetwork,
    payload: (p) => ({ native_ad_id: p.native_ad_id, user_id: p.user_id }),
  },
  {
    key: 'redirect',
    fn: getRedirect,
    payload: (p) => ({ native_ad_id: p.native_ad_id }),
  },
  {
    key: 'redirectOutgoingUrls',
    fn: getRedirectOutgoingUrls,
    payload: (p) => ({ native_ad_id: p.native_ad_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ native_ad_id: p.native_ad_id }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.native_ad_id || !p.user_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: native_ad_id and user_id are required' });
  }

  const service = serviceRegistry.getService('native');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'Native service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

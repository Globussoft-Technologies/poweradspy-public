'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../gdn/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getGdnAdCountry,
  getGdnOutgoings,
  getAdvertiserCountryData,
} = require('../../gdn/controllers/adInsightsController');
const { getAdDetails } = require('../../gdn/controllers/adDetailController');

const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ ad_id: p.gdn_ad_id, user_id: p.user_id, language: p.language }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ gdn_ad_id: p.gdn_ad_id, user_id: p.user_id }),
  },
  {
    key: 'country',
    fn: getGdnAdCountry,
    payload: (p) => ({ gdn_ad_id: p.gdn_ad_id, user_id: p.user_id }),
  },
  {
    key: 'outgoingLinks',
    fn: getGdnOutgoings,
    payload: (p) => ({ gdn_ad_id: p.gdn_ad_id }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.gdn_ad_id || !p.user_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: gdn_ad_id and user_id are required' });
  }

  const service = serviceRegistry.getService('gdn');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'GDN service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getAdDetails,
  getChatgptAdCountry,
  getAdvertiserCountryData,
} = require('../../chatgptads/controllers/adInsightsController');

const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ chatgptads_ad_id: p.chatgptads_ad_id, user_id: p.user_id }),
  },
  {
    key: 'country',
    fn: getChatgptAdCountry,
    payload: (p) => ({ chatgptads_ad_id: p.chatgptads_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ chatgptads_ad_id: p.chatgptads_ad_id, user_id: p.user_id, year: p.year }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  // chatgptads_ad_id is the internal chatgptads_ad.id; `ad_id` accepted as an alias.
  const p = { ...raw, chatgptads_ad_id: raw.chatgptads_ad_id ?? raw.ad_id };

  if (!p.chatgptads_ad_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: chatgptads_ad_id (or ad_id) is required' });
  }

  const service = serviceRegistry.getService('chatgptads');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'ChatGPT Ads service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

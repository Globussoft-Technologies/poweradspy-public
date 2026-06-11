'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { normalizeParams } = require('../../youtube/helpers/paramParser');
const { streamInsights } = require('../helpers/sseHelper');
const {
  getLikeCommentShareDetails,
  getYoutubeAdCountry,
  getYoutubeOutgoings,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
} = require('../../youtube/controllers/adInsightsController');
const { getAdDetails } = require('../../youtube/controllers/adDetailController');

const INSIGHT_REGISTRY = [
  {
    key: 'adDetails',
    fn: getAdDetails,
    payload: (p) => ({ ad_id: p.youtube_ad_id, user_id: p.user_id, language: p.language }),
  },
  {
    key: 'advertiserLCSData',
    fn: getAdvertiserLCSData,
    payload: (p) => ({ youtube_ad_id: p.youtube_ad_id, user_id: p.user_id }),
  },
  {
    key: 'advertiserCountryData',
    fn: getAdvertiserCountryData,
    payload: (p) => ({ youtube_ad_id: p.youtube_ad_id, user_id: p.user_id }),
  },
  {
    key: 'lcs',
    fn: getLikeCommentShareDetails,
    payload: (p) => ({ youtube_ad_id: p.youtube_ad_id, user_id: p.user_id }),
  },
  {
    key: 'country',
    fn: getYoutubeAdCountry,
    payload: (p) => ({ youtube_ad_id: p.youtube_ad_id, user_id: p.user_id }),
  },
  {
    key: 'outgoingLinks',
    fn: getYoutubeOutgoings,
    payload: (p) => ({ ad_id: p.youtube_ad_id }),
  },
];

async function getAdInsights(req, res) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.youtube_ad_id || !p.user_id) {
    return res.status(401).json({ code: 401, message: 'Missing parameters: youtube_ad_id and user_id are required' });
  }

  const service = serviceRegistry.getService('youtube');
  if (!service) {
    return res.status(503).json({ code: 503, message: 'YouTube service not available' });
  }
  const { db, log: logger } = service;

  streamInsights(req, res, INSIGHT_REGISTRY, p, db, logger);
}

module.exports = { getAdInsights };

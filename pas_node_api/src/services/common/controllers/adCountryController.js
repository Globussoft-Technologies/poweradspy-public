'use strict';

const serviceRegistry = require('../../ServiceRegistry');

/**
 * Lightweight ad-level country lookup.
 *
 * The full `getAdInsights` SSE stream runs ~9 fetchers per open; surfacing the
 * country row in the Ad Details popup only needs one of them. This endpoint
 * reuses the SAME per-network fetcher the insight registry runs for its
 * `country` event and returns just that result — one small ES read (+ an ISO
 * name→code SQL lookup for the map), instead of the whole registry.
 *
 * TikTok has no dedicated country fetcher: its countries ride on the analytics
 * document (ISO array), so we reuse `getAnalytics` and normalize its `countries`
 * field into the same `[{ country, iso }]` shape every other network returns.
 */
const NETWORK_COUNTRY = {
  facebook: {
    service: 'facebook',
    normalize: require('../../facebook/helpers/paramParser').normalizeParams,
    fn: require('../../facebook/controllers/adInsightsController').getFacebookAdCountry,
    idKeys: ['facebook_ad_id'],
    payload: (p) => ({ facebook_ad_id: p.facebook_ad_id, user_id: p.user_id }),
  },
  instagram: {
    service: 'instagram',
    normalize: require('../../instagram/helpers/paramParser').normalizeParams,
    fn: require('../../instagram/controllers/adInsightsController').getInstagramAdCountry,
    idKeys: ['instagram_ad_id'],
    payload: (p) => ({ instagram_ad_id: p.instagram_ad_id, user_id: p.user_id }),
  },
  google: {
    service: 'google',
    normalize: require('../../google/helpers/paramParser').normalizeParams,
    fn: require('../../google/controllers/adInsightsController').getGoogleAdCountry,
    idKeys: ['google_text_ad_id'],
    payload: (p) => ({ google_text_ad_id: p.google_text_ad_id, user_id: p.user_id }),
  },
  gdn: {
    service: 'gdn',
    normalize: require('../../gdn/helpers/paramParser').normalizeParams,
    fn: require('../../gdn/controllers/adInsightsController').getGdnAdCountry,
    idKeys: ['gdn_ad_id'],
    payload: (p) => ({ gdn_ad_id: p.gdn_ad_id, user_id: p.user_id }),
  },
  youtube: {
    service: 'youtube',
    normalize: require('../../youtube/helpers/paramParser').normalizeParams,
    fn: require('../../youtube/controllers/adInsightsController').getYoutubeAdCountry,
    idKeys: ['youtube_ad_id'],
    payload: (p) => ({ youtube_ad_id: p.youtube_ad_id, user_id: p.user_id }),
  },
  native: {
    service: 'native',
    normalize: require('../../native/helpers/paramParser').normalizeParams,
    fn: require('../../native/controllers/adInsightsController').getNativeAdCountry,
    idKeys: ['native_ad_id'],
    payload: (p) => ({ native_ad_id: p.native_ad_id, user_id: p.user_id }),
  },
  linkedin: {
    service: 'linkedin',
    normalize: require('../../linkedin/helpers/paramParser').normalizeParams,
    fn: require('../../linkedin/controllers/adInsightsController').getLinkedinAdCountry,
    idKeys: ['linkedin_ad_id'],
    payload: (p) => ({ linkedin_ad_id: p.linkedin_ad_id, user_id: p.user_id }),
  },
  reddit: {
    service: 'reddit',
    normalize: require('../../reddit/helpers/paramParser').normalizeParams,
    fn: require('../../reddit/controllers/adInsightsController').getRedditAdCountry,
    idKeys: ['reddit_ad_id'],
    payload: (p) => ({ reddit_ad_id: p.reddit_ad_id, user_id: p.user_id }),
  },
  quora: {
    service: 'quora',
    normalize: require('../../quora/helpers/paramParser').normalizeParams,
    fn: require('../../quora/controllers/adInsightsController').getQuoraAdCountry,
    idKeys: ['quora_ad_id'],
    payload: (p) => ({ quora_ad_id: p.quora_ad_id, user_id: p.user_id }),
  },
  pinterest: {
    service: 'pinterest',
    normalize: require('../../pinterest/helpers/paramParser').normalizeParams,
    fn: require('../../pinterest/controllers/adInsightsController').getPinterestAdCountry,
    idKeys: ['pinterest_ad_id'],
    payload: (p) => ({ pinterest_ad_id: p.pinterest_ad_id, user_id: p.user_id }),
  },
  tiktok: {
    service: 'tiktok',
    normalize: require('../../tiktok/helpers/paramParser').normalizeParams,
    fn: require('../../tiktok/controllers/adInsightsController').getAnalytics,
    idKeys: ['tiktok_ad_id', 'ad_id'],
    payload: (p) => ({ ad_id: p.tiktok_ad_id || p.ad_id, user_id: p.user_id }),
    // TikTok stores a flat ISO array on the analytics doc — reshape it to match
    // the other networks. Names are resolved client-side from the ISO code.
    extract: (data) => {
      let list = data?.countries;
      if (!list) return [];
      if (!Array.isArray(list)) list = [list];
      const seen = new Set();
      const out = [];
      for (const raw of list) {
        const iso = String(raw || '').toUpperCase();
        if (!iso || seen.has(iso)) continue;
        seen.add(iso);
        out.push({ country: iso, iso });
      }
      return out;
    },
  },
};

/**
 * GET/POST /api/v1/common/ads/ad-country?network=<net>&<net>_ad_id=<id>&user_id=<id>
 * Returns { code: 200, data: [{ country, iso }] }. Missing/absent country data
 * resolves to an empty list (200), not an error — the UI simply omits the row.
 */
async function getAdCountry(req, res) {
  const raw = { ...req.body, ...req.query };
  const network = String(raw.network || 'facebook').toLowerCase().trim();

  const cfg = NETWORK_COUNTRY[network];
  if (!cfg) {
    return res.status(400).json({
      code: 400,
      message: `Unsupported network: ${network}. Available: ${Object.keys(NETWORK_COUNTRY).join(', ')}`,
    });
  }

  const p = cfg.normalize(raw);
  // The underlying fetchers 401 without a user_id; the frontend passes 281 for
  // these read-only, non-user-scoped lookups. Default to it so callers only
  // need to supply the ad id.
  if (p.user_id == null || p.user_id === '') p.user_id = raw.user_id || 281;

  const hasId = cfg.idKeys.some((k) => p[k] != null && p[k] !== '');
  if (!hasId) {
    return res.status(400).json({ code: 400, message: `Missing ad id (${cfg.idKeys.join(' or ')})` });
  }

  const service = serviceRegistry.getService(cfg.service);
  if (!service) {
    return res.status(503).json({ code: 503, message: `${network} service not available` });
  }
  const { db, log: logger } = service;

  const fakeReq = { body: cfg.payload(p), query: {} };
  const result = await cfg.fn(fakeReq, db, logger);

  // Non-200 (e.g. no country stored on the doc) → empty list, not an error, so
  // the popup just skips the Countries row.
  if (!result || result.code !== 200 || result.data == null) {
    return res.json({ code: 200, data: [] });
  }

  const data = cfg.extract ? cfg.extract(result.data) : result.data;
  return res.json({ code: 200, data: Array.isArray(data) ? data : [] });
}

module.exports = { getAdCountry };

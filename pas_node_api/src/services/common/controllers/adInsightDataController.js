'use strict';

const serviceRegistry = require('../../ServiceRegistry');

/**
 * Curated single-ad insight for one ad on one network.
 *
 * Distinct from `getAdInsights` (which SSE-streams ~9 insight fetchers): this
 * endpoint returns ONE flat JSON object with a fixed, competitor-analysis field
 * set, and only for ads that actually carry both a call_to_action AND a
 * destination_url — ads missing either are treated as "does not qualify" (404).
 *
 * The shared fields are sourced by reusing each network's existing
 * `getAdDetails` (the very same fetcher the `getAdInsights` stream runs for its
 * `adDetails` event), so field semantics stay identical to the rest of the app.
 * The URL + landing-page group is added per network; LinkedIn is wired here,
 * other networks return those "if available" fields as null until wired.
 *
 * TikTok has no ad-detail store (no call_to_action / destination_url), so it
 * takes an ES-only branch: it returns what its `tiktok_ads` doc carries (title,
 * advertiser, timeline, language) with the CTA/destination filter relaxed and
 * the URL / landing-page fields null.
 */

const NETWORK = {
  facebook: {
    getAdDetails: require('../../facebook/controllers/adDetailController').getAdDetails,
    normalize:    require('../../facebook/helpers/paramParser').normalizeParams,
  },
  instagram: {
    getAdDetails: require('../../instagram/controllers/adDetailController').getAdDetails,
    normalize:    require('../../instagram/helpers/paramParser').normalizeParams,
  },
  pinterest: {
    getAdDetails: require('../../pinterest/controllers/adDetailController').getAdDetails,
    normalize:    require('../../pinterest/helpers/paramParser').normalizeParams,
  },
  youtube: {
    getAdDetails: require('../../youtube/controllers/adDetailController').getAdDetails,
    normalize:    require('../../youtube/helpers/paramParser').normalizeParams,
  },
  gdn: {
    getAdDetails: require('../../gdn/controllers/adDetailController').getAdDetails,
    normalize:    require('../../gdn/helpers/paramParser').normalizeParams,
  },
  google: {
    getAdDetails: require('../../google/controllers/adDetailController').getAdDetails,
    normalize:    require('../../google/helpers/paramParser').normalizeParams,
  },
  native: {
    getAdDetails: require('../../native/controllers/adDetailController').getAdDetails,
    normalize:    require('../../native/helpers/paramParser').normalizeParams,
  },
  linkedin: {
    getAdDetails: require('../../linkedin/controllers/adDetailController').getAdDetails,
    normalize:    require('../../linkedin/helpers/paramParser').normalizeParams,
    landing:      linkedinLanding,
  },
  reddit: {
    getAdDetails: require('../../reddit/controllers/adDetailController').getAdDetails,
    normalize:    require('../../reddit/helpers/paramParser').normalizeParams,
  },
  quora: {
    getAdDetails: require('../../quora/controllers/adDetailController').getAdDetails,
    normalize:    require('../../quora/helpers/paramParser').normalizeParams,
  },
  tiktok: {
    // ES-only: no getAdDetails. `fetch` returns a getAdDetails-shaped object so
    // the shared assembly below works unchanged; `esOnly` relaxes the filter.
    esOnly:    true,
    normalize: require('../../tiktok/helpers/paramParser').normalizeParams,
    fetch:     tiktokAdInsight,
  },
};

// ── helpers ──────────────────────────────────────────────

// The upstream paramParsers coerce 'NA'/null → '' — treat those, and blanks, as absent.
function present(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s !== '' && s.toUpperCase() !== 'NA';
}

function firstPresent(...vals) {
  for (const v of vals) if (present(v)) return v;
  return null;
}

// Normalize any date representation to a plain YYYY-MM-DD string (no TZ shift).
function toDateStr(v) {
  if (!present(v)) return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    let n = Number(s);
    if (n < 1e12) n *= 1000;           // epoch seconds → ms
    const d = new Date(n);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Fallback ad status when a network's getAdDetails doesn't compute one.
function computeStatus(lastSeen) {
  if (!present(lastSeen)) return null;
  const d = toDateStr(lastSeen);
  if (!d) return null;
  const diffDays = Math.floor((Date.now() - new Date(`${d}T00:00:00Z`).getTime()) / 86400000);
  return diffDays > 15 ? 'Inactive' : 'Active';
}

// redirect_urls may arrive as a string or an array (ES). Flatten to a string.
function flattenRedirect(v) {
  if (Array.isArray(v)) {
    const list = v.filter(present).map((x) => String(x).trim());
    return list.length ? list.join(', ') : null;
  }
  return present(v) ? String(v).trim() : null;
}

// A single-value country out of whatever getAdDetails returns (string/array).
function pickCountry(v) {
  if (Array.isArray(v)) {
    const first = v.find((x) => present(x) || present(x?.country));
    if (!first) return null;
    return present(first?.country) ? first.country : (present(first) ? String(first) : null);
  }
  return present(v) ? String(v).trim() : null;
}

// LinkedIn stores lander HTML as a JSON-stringified array of html strings.
function parseHtmlText(v) {
  if (!present(v)) return null;
  const s = String(v).trim();
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        const first = parsed.find(present);
        return first != null ? String(first) : null;
      }
      return s;
    } catch (_) { return s; }
  }
  return s;
}

// ── LinkedIn landing-page / final-url enrichment ─────────
async function linkedinLanding(db, adId, logger) {
  const out = { redirect_url: null, final_url: null, landing_page_html: null, landing_page_title: null, http_status_code: null };
  if (!db || !db.sql) return out;
  try {
    const rows = await db.sql.query(
      'SELECT redirect_url, final_url FROM linkedin_ad_outgoing_links WHERE linkedin_ad_id = ? LIMIT 1',
      [adId]
    );
    if (rows && rows[0]) {
      out.redirect_url = present(rows[0].redirect_url) ? rows[0].redirect_url : null;
      out.final_url    = present(rows[0].final_url)    ? rows[0].final_url    : null;
    }
  } catch (err) {
    logger?.warn?.('linkedinLanding outgoing lookup failed', { adId, error: err.message });
  }
  try {
    const rows = await db.sql.query(
      'SELECT html_whitehat_lander_text FROM linkedin_ad_html_lander_content WHERE linkedin_ad_id = ? LIMIT 1',
      [adId]
    );
    if (rows && rows[0]) out.landing_page_html = parseHtmlText(rows[0].html_whitehat_lander_text);
  } catch (err) {
    logger?.warn?.('linkedinLanding html lookup failed', { adId, error: err.message });
  }
  // landing_page_title & http_status_code are not stored for LinkedIn → stay null.
  return out;
}

// ── TikTok ES-only ad fetch ──────────────────────────────
// Returns a getAdDetails-shaped object from the `tiktok_ads` ES doc. Fields the
// doc doesn't carry (call_to_action, destination_url, type, country, landing)
// are null; the handler skips the CTA/destination filter for esOnly networks.
async function tiktokAdInsight(db, adId, logger) {
  if (!db || !db.elastic) return null;
  const index = db.elastic.indexName || process.env.TT_ELASTIC_INDEX || 'tiktok_ads';
  try {
    const esResult = await db.elastic.search({
      index,
      body: {
        size: 1,
        _source: ['sql_id', 'ad_title', 'post_owner', 'post_owner_id', 'first_seen', 'last_seen', 'language'],
        // sql_id may be mapped numeric or keyword — match either.
        query: { terms: { sql_id: [Number(adId), String(adId)] } },
        collapse: { field: 'sql_id' },
      },
    });
    const hits = (esResult.hits || esResult.body?.hits)?.hits || [];
    if (!hits.length) return null;
    const src = hits[0]._source || {};
    return {
      id: present(src.sql_id) ? src.sql_id : hits[0]._id,
      ad_id: present(src.sql_id) ? src.sql_id : hits[0]._id,
      ad_title: present(src.ad_title) ? src.ad_title : null,
      ad_text: null,
      news_feed_description: null,
      call_to_action: null,       // not stored for TikTok
      destination_url: null,      // not stored for TikTok
      type: null,
      post_owner: present(src.post_owner) ? src.post_owner : null,
      post_owner_id: present(src.post_owner_id) ? src.post_owner_id : null,
      first_seen: src.first_seen ?? null,
      last_seen: src.last_seen ?? null,
      language: present(src.language) ? src.language : null,
      country: null,
      ad_status: null,
      market_platform_urls: null,
    };
  } catch (err) {
    logger?.error?.('tiktokAdInsight ES lookup failed', { adId, error: err.message });
    return null;
  }
}

/**
 * POST /api/v1/common/ads/getAdInsightData?network=<net>
 * Body/query: { network, ad_id (or <network>_ad_id), user_id?, language? }
 * → { code, message, data: { ...curated fields } }
 * Only returns ads with both call_to_action and destination_url present (else 404).
 */
async function getAdInsightData(req, res) {
  const raw = { ...req.body, ...req.query };
  const network = String(raw.network || 'facebook').toLowerCase().trim();

  const cfg = NETWORK[network];
  if (!cfg) {
    return res.status(400).json({
      code: 400,
      message: `Unsupported network: ${network}. Available: ${Object.keys(NETWORK).join(', ')}`,
    });
  }

  const p = cfg.normalize(raw);
  const adIdRaw = firstPresent(p.ad_id, p[`${network}_ad_id`], raw.ad_id, raw[`${network}_ad_id`]);
  if (!adIdRaw) {
    return res.status(400).json({ code: 400, message: `Missing ad id (ad_id or ${network}_ad_id)` });
  }
  const adId = Number(adIdRaw);
  if (!Number.isInteger(adId) || adId <= 0) {
    return res.status(400).json({ code: 400, message: 'ad_id must be a positive integer' });
  }

  const userId = firstPresent(p.user_id, raw.user_id) || 281;   // read-only lookup; fetchers 401 without one
  const language = firstPresent(p.language, raw.language) || 'en';

  const service = serviceRegistry.getService(network);
  if (!service) {
    return res.status(503).json({ code: 503, message: `${network} service not available` });
  }
  const { db, log: logger } = service;

  try {
    let base;
    if (cfg.esOnly) {
      // ES-only network (TikTok): no getAdDetails, and its docs carry no
      // call_to_action / destination_url, so the qualifying filter is skipped.
      base = await cfg.fetch(db, adId, logger);
      if (!base) return res.status(404).json({ code: 404, message: 'Ad not found' });
    } else {
      const detail = await cfg.getAdDetails({ body: { ad_id: adId, user_id: userId, language }, query: {} }, db, logger);
      if (!detail || detail.code !== 200 || !detail.data || (Array.isArray(detail.data) && detail.data.length === 0)) {
        return res.status(404).json({ code: 404, message: 'Ad not found' });
      }
      base = Array.isArray(detail.data) ? detail.data[0] : detail.data;

      // ── Filter: both call_to_action AND destination_url must be present ──
      if (!present(base.call_to_action) || !present(base.destination_url)) {
        return res.status(404).json({
          code: 404,
          message: 'Ad does not qualify: call_to_action and destination_url are both required',
        });
      }
    }

    // post_owner_id isn't in every getAdDetails SELECT — backfill from the ad table.
    let postOwnerId = present(base.post_owner_id) ? Number(base.post_owner_id) : null;
    if (postOwnerId == null && db.sql && NETWORK_TABLE[network]) {
      try {
        const rows = await db.sql.query(`SELECT post_owner_id FROM ${NETWORK_TABLE[network]} WHERE id = ? LIMIT 1`, [adId]);
        if (rows && rows[0] && present(rows[0].post_owner_id)) postOwnerId = Number(rows[0].post_owner_id);
      } catch (err) {
        logger?.warn?.('post_owner_id backfill failed', { network, adId, error: err.message });
      }
    }

    // URL + landing-page enrichment (LinkedIn wired; others null "if available").
    let enrich = { redirect_url: null, final_url: null, landing_page_html: null, landing_page_title: null, http_status_code: null };
    if (cfg.landing) enrich = { ...enrich, ...(await cfg.landing(db, adId, logger)) };

    const redirectUrl = firstPresent(
      enrich.redirect_url,
      flattenRedirect(base.market_platform_urls && base.market_platform_urls.redirect_urls)
    );

    const data = {
      // Basic Ad Information
      ad_id: present(base.ad_id) ? Number(base.ad_id) : (present(base.id) ? Number(base.id) : adId),
      network,
      post_owner_id: postOwnerId,
      post_owner: present(base.post_owner) ? base.post_owner : null,
      ad_title: present(base.ad_title) ? base.ad_title : null,
      ad_description: firstPresent(base.news_feed_description, base.ad_text),
      call_to_action: base.call_to_action,
      status: present(base.ad_status) ? base.ad_status : computeStatus(base.last_seen),
      ad_type: present(base.type) ? base.type : null,
      language: present(base.language) ? base.language : null,
      country: pickCountry(base.country),
      // Timeline
      first_seen: toDateStr(base.first_seen),
      last_seen: toDateStr(base.last_seen),
      // URL Information
      destination_url: base.destination_url,
      redirect_url: redirectUrl,
      final_url: enrich.final_url,
      // Landing Page Information (if available)
      landing_page_html: enrich.landing_page_html,
      landing_page_title: enrich.landing_page_title,
      http_status_code: enrich.http_status_code,
    };

    return res.json({ code: 200, message: 'Ad insight fetched successfully', data });
  } catch (err) {
    logger?.error?.('Error in getAdInsightData', { network, adId, error: err.message });
    return res.status(500).json({ code: 500, message: 'Error fetching ad insight', error: err.message });
  }
}

// network → SQL ad table, used only to backfill post_owner_id when getAdDetails omits it.
const NETWORK_TABLE = {
  facebook:  'facebook_ad',
  instagram: 'instagram_ad',
  pinterest: 'pinterest_ad',
  youtube:   'youtube_ad',
  gdn:       'gdn_ad',
  google:    'google_text_ad',
  native:    'native_ad',
  linkedin:  'linkedin_ad',
  reddit:    'reddit_ad',
  quora:     'quora_ad',
};

module.exports = { getAdInsightData };

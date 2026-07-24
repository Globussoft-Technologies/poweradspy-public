'use strict';

const serviceRegistry = require('../../ServiceRegistry');

/**
 * Paginated curated ad-insight feed for one network.
 *
 * Input: { network, page, page_size?, post_owner_id?, include_html? } — NO ad_id.
 * Returns a page of ads (default 10 per page, newest-active first), each a flat
 * curated object identical in field shape to the app's ad-detail data. Page is
 * 1-indexed: page 1 → ads 1-10, page 2 → 11-20, …
 *
 * ONLY ads with BOTH call_to_action AND destination_url present are returned.
 * Those two live on `<network>_ad.call_to_action_id` and
 * `<network>_ad_meta_data.destination_url`, so one indexed query selects a page
 * of qualifying ids, each id is hydrated by reusing that network's existing
 * getAdDetails (the same source getAdInsights streams for its `adDetails`
 * event), and a final guard drops anything whose hydrated call_to_action /
 * destination_url turns out absent.
 *
 * Only the six networks that carry both fields are supported: facebook,
 * instagram, linkedin, quora, reddit, youtube. Networks without them — tiktok
 * (ES-only, no call_to_action/destination_url) and pinterest/gdn/google/native
 * (no call_to_action at all) — are skipped: a request for one returns 400.
 *
 * LinkedIn additionally resolves final_url/redirect_url from
 * linkedin_ad_outgoing_links and (opt-in via include_html) landing_page_html
 * from linkedin_ad_html_lander_content.
 */

// The networks whose ads can carry both call_to_action and destination_url.
// Naming is uniform: <table>.call_to_action_id, and <meta>.<fk> = <table>.id
// with <meta>.destination_url.
const NETWORKS = {
  facebook: {
    table: 'facebook_ad', meta: 'facebook_ad_meta_data', fk: 'facebook_ad_id',
    getAdDetails: require('../../facebook/controllers/adDetailController').getAdDetails,
    normalize:    require('../../facebook/helpers/paramParser').normalizeParams,
  },
  instagram: {
    table: 'instagram_ad', meta: 'instagram_ad_meta_data', fk: 'instagram_ad_id',
    getAdDetails: require('../../instagram/controllers/adDetailController').getAdDetails,
    normalize:    require('../../instagram/helpers/paramParser').normalizeParams,
  },
  linkedin: {
    table: 'linkedin_ad', meta: 'linkedin_ad_meta_data', fk: 'linkedin_ad_id',
    getAdDetails: require('../../linkedin/controllers/adDetailController').getAdDetails,
    normalize:    require('../../linkedin/helpers/paramParser').normalizeParams,
  },
  quora: {
    table: 'quora_ad', meta: 'quora_ad_meta_data', fk: 'quora_ad_id',
    getAdDetails: require('../../quora/controllers/adDetailController').getAdDetails,
    normalize:    require('../../quora/helpers/paramParser').normalizeParams,
  },
  reddit: {
    table: 'reddit_ad', meta: 'reddit_ad_meta_data', fk: 'reddit_ad_id',
    getAdDetails: require('../../reddit/controllers/adDetailController').getAdDetails,
    normalize:    require('../../reddit/helpers/paramParser').normalizeParams,
  },
  youtube: {
    table: 'youtube_ad', meta: 'youtube_ad_meta_data', fk: 'youtube_ad_id',
    getAdDetails: require('../../youtube/controllers/adDetailController').getAdDetails,
    normalize:    require('../../youtube/helpers/paramParser').normalizeParams,
  },
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const NULL_ENRICH = { redirect_url: null, final_url: null, landing_page_html: null, landing_page_title: null, http_status_code: null };

// ── helpers ──────────────────────────────────────────────

// Upstream paramParsers coerce 'NA'/null → '' — treat those, and blanks, as absent.
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
    const first = v.find((x) => present(x) || present(x && x.country));
    if (!first) return null;
    return present(first && first.country) ? first.country : (present(first) ? String(first) : null);
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

// LinkedIn URL + (opt-in) landing enrichment. redirect/final are always fetched
// (cheap); the html blob only when includeHtml is true.
async function linkedinLanding(db, adId, logger, includeHtml) {
  const out = { ...NULL_ENRICH };
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
  if (includeHtml) {
    try {
      const rows = await db.sql.query(
        'SELECT html_whitehat_lander_text FROM linkedin_ad_html_lander_content WHERE linkedin_ad_id = ? LIMIT 1',
        [adId]
      );
      if (rows && rows[0]) out.landing_page_html = parseHtmlText(rows[0].html_whitehat_lander_text);
    } catch (err) {
      logger?.warn?.('linkedinLanding html lookup failed', { adId, error: err.message });
    }
  }
  // landing_page_title & http_status_code are not stored for LinkedIn → stay null.
  return out;
}

// Assemble one curated object from a getAdDetails-shaped `base`.
// `adId` is the internal `<table>.id` (the identifier the rest of the app uses,
// e.g. /linkedin/<id> and getAdvertiserAds) — NOT the external `ad_id` column.
function buildCuratedObject(base, network, enrich, postOwnerId, adId) {
  const redirectUrl = firstPresent(
    enrich.redirect_url,
    flattenRedirect(base.market_platform_urls && base.market_platform_urls.redirect_urls)
  );
  return {
    // Basic Ad Information
    ad_id: present(adId) ? Number(adId) : (present(base.id) ? Number(base.id) : null),
    network,
    post_owner_id: postOwnerId != null ? Number(postOwnerId) : (present(base.post_owner_id) ? Number(base.post_owner_id) : null),
    post_owner: present(base.post_owner) ? base.post_owner : null,
    ad_title: present(base.ad_title) ? base.ad_title : null,
    ad_description: firstPresent(base.news_feed_description, base.ad_text),
    call_to_action: present(base.call_to_action) ? base.call_to_action : null,
    status: present(base.ad_status) ? base.ad_status : computeStatus(base.last_seen),
    ad_type: present(base.type) ? base.type : null,
    language: present(base.language) ? base.language : null,
    country: pickCountry(base.country),
    // Timeline
    first_seen: toDateStr(base.first_seen),
    last_seen: toDateStr(base.last_seen),
    // URL Information
    destination_url: present(base.destination_url) ? base.destination_url : null,
    redirect_url: redirectUrl,
    final_url: enrich.final_url,
    // Landing Page Information (if available)
    landing_page_html: enrich.landing_page_html,
    landing_page_title: enrich.landing_page_title,
    http_status_code: enrich.http_status_code,
  };
}

// SQL that picks one page of qualifying ad ids (+ their advertiser). Identifiers
// come only from the hard-coded NETWORKS map, never user input. LIMIT/OFFSET are
// inlined as validated integers because mysql2's prepared `execute()` rejects
// bound LIMIT/OFFSET params ("Incorrect arguments to mysqld_stmt_execute");
// post_owner_id stays a bound parameter.
function buildIdPageSql(m, hasOwner, limit, offset) {
  const lim = Math.max(1, Math.trunc(limit));
  const off = Math.max(0, Math.trunc(offset));
  return `
    SELECT t.id AS id, t.post_owner_id AS post_owner_id
    FROM ${m.table} t
    WHERE t.call_to_action_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM ${m.meta} md
        WHERE md.${m.fk} = t.id AND md.destination_url IS NOT NULL AND md.destination_url <> ''
      )
      ${hasOwner ? 'AND t.post_owner_id = ?' : ''}
    ORDER BY t.last_seen DESC, t.id DESC
    LIMIT ${lim} OFFSET ${off}`.trim();
}

/**
 * POST /api/v1/common/ads/getAdInsightData?network=<net>
 * Body/query: { network, page=1, page_size=10, post_owner_id?, include_html? }
 * → { code, message, network, page, page_size, count, has_more, data: [ {curated} ] }
 * Only ads with both call_to_action and destination_url are returned; networks
 * that don't carry those fields are unsupported (400).
 */
async function getAdInsightData(req, res) {
  const raw = { ...req.body, ...req.query };
  const network = String(raw.network || 'facebook').toLowerCase().trim();

  const cfg = NETWORKS[network];
  if (!cfg) {
    return res.status(400).json({
      code: 400,
      message: `Unsupported network: ${network}. This endpoint returns only ads that have both call_to_action and destination_url — available on: ${Object.keys(NETWORKS).join(', ')}`,
    });
  }

  // Pagination + options.
  const page = Math.max(1, parseInt(raw.page, 10) || 1);
  const psRaw = parseInt(raw.page_size, 10);
  const pageSize = Number.isFinite(psRaw) && psRaw > 0 ? Math.min(psRaw, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;
  const includeHtml = raw.include_html === true || String(raw.include_html).toLowerCase() === 'true';
  const ownerRaw = firstPresent(raw.post_owner_id, raw.competitor_id);
  const postOwnerId = ownerRaw != null && Number.isInteger(Number(ownerRaw)) && Number(ownerRaw) > 0 ? Number(ownerRaw) : null;

  const userId = firstPresent(cfg.normalize(raw).user_id, raw.user_id) || 281;
  const language = firstPresent(raw.language) || 'en';

  const service = serviceRegistry.getService(network);
  if (!service) {
    return res.status(503).json({ code: 503, message: `${network} service not available` });
  }
  const { db, log: logger } = service;
  if (!db.sql) {
    return res.status(503).json({ code: 503, message: 'SQL database connection not available' });
  }

  try {
    const params = [];
    if (postOwnerId != null) params.push(postOwnerId);
    // pageSize + 1 to probe has_more.
    const idRows = await db.sql.query(buildIdPageSql(cfg, postOwnerId != null, pageSize + 1, offset), params);

    const hasMore = (idRows || []).length > pageSize;
    const pageRows = (idRows || []).slice(0, pageSize);

    const data = (await Promise.all(pageRows.map(async (row) => {
      const adId = row.id;
      try {
        const detail = await cfg.getAdDetails({ body: { ad_id: adId, user_id: userId, language }, query: {} }, db, logger);
        if (!detail || detail.code !== 200 || !detail.data || (Array.isArray(detail.data) && detail.data.length === 0)) return null;
        const base = Array.isArray(detail.data) ? detail.data[0] : detail.data;
        const enrich = network === 'linkedin' ? await linkedinLanding(db, adId, logger, includeHtml) : NULL_ENRICH;
        const obj = buildCuratedObject(base, network, enrich, row.post_owner_id, row.id);
        // Final guard: strictly only ads with BOTH call_to_action and destination_url.
        if (!present(obj.call_to_action) || !present(obj.destination_url)) return null;
        return obj;
      } catch (err) {
        logger?.warn?.('getAdInsightData hydrate failed', { network, adId, error: err.message });
        return null;
      }
    }))).filter(Boolean);

    return res.json({
      code: 200,
      network,
      page,
      page_size: pageSize,
      count: data.length,
      has_more: hasMore,
      data,
      message: 'Ad insights fetched successfully',
    });
  } catch (err) {
    logger?.error?.('Error in getAdInsightData', { network, page, error: err.message });
    return res.status(500).json({ code: 500, message: 'Error fetching ad insights', error: err.message });
  }
}

module.exports = { getAdInsightData };

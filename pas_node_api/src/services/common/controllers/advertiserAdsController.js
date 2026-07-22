'use strict';

const serviceRegistry = require('../../ServiceRegistry');

/**
 * List every ad belonging to one advertiser (a.k.a. competitor / post_owner)
 * together with each ad's first_seen date.
 *
 * Input : { network, post_owner_id }  — `competitor_id` is accepted as an alias
 *         for `post_owner_id`.
 * Output: { data: [{ ad_id, first_seen }] } ordered oldest-first.
 *
 * Ten of the eleven networks keep their ads in a per-network SQL table
 * `<network>_ad` (Google's is `google_text_ad`) whose PK `id` is the ad id the
 * rest of the app uses, and which carries both `post_owner_id` (FK to
 * `<network>_ad_post_owners`) and a `first_seen` datetime column. So a single
 * indexed WHERE on post_owner_id enumerates the advertiser's whole ad set — no
 * advertiser-name matching, no ES pagination. TikTok has no SQL ad table; its
 * ads live only in Elasticsearch, so it takes a separate ES branch keyed on the
 * same post_owner_id.
 */

// network → SQL ad table. In every one, `id` is the ad id, `post_owner_id` the
// advertiser FK, and `first_seen` the datetime we DATE_FORMAT to YYYY-MM-DD.
const NETWORK_SQL_TABLE = {
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

const SUPPORTED = [...Object.keys(NETWORK_SQL_TABLE), 'tiktok'];

// The table name is chosen only from the hard-coded map above (never from user
// input), so interpolating it is not an injection vector; post_owner_id is
// always passed as a bound parameter.
function buildSql(table, hasLimit) {
  return `
    SELECT ${table}.id AS ad_id,
           DATE_FORMAT(${table}.first_seen, '%Y-%m-%d') AS first_seen,
           DATE_FORMAT(${table}.last_seen, '%Y-%m-%d') AS last_seen
    FROM ${table}
    WHERE ${table}.post_owner_id = ?
    ORDER BY ${table}.first_seen ASC, ${table}.id ASC
    ${hasLimit ? 'LIMIT ?' : ''}`.trim();
}

// Normalize any first_seen representation (epoch seconds/ms, ISO, or
// 'YYYY-MM-DD HH:MM:SS') down to a plain YYYY-MM-DD string. Only the ES/TikTok
// path needs this; the SQL path already emits this shape via DATE_FORMAT.
function toDateStr(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    let n = Number(s);
    if (n < 1e12) n *= 1000;            // epoch seconds → ms
    const d = new Date(n);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const m = s.match(/\d{4}-\d{2}-\d{2}/);  // pull the date part without a TZ shift
  if (m) return m[0];
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchFromSql(table, service, postOwnerId, limit) {
  const { db } = service;
  if (!db || !db.sql) return { code: 503, message: 'SQL database connection not available' };

  const params = [postOwnerId];
  if (limit) params.push(limit);
  const rows = await db.sql.query(buildSql(table, !!limit), params);

  const data = (rows || []).map((r) => ({ ad_id: r.ad_id, first_seen: r.first_seen, last_seen: r.last_seen }));
  return { code: 200, data };
}

async function fetchFromTiktokEs(service, postOwnerId, limit) {
  const { db } = service;
  if (!db || !db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const index = db.elastic.indexName || process.env.TT_ELASTIC_INDEX || 'tiktok_ads';
  const size = limit || 10000;   // ES needs an explicit cap; advertisers rarely exceed this
  const esResult = await db.elastic.search({
    index,
    body: {
      size,
      _source: ['sql_id', 'first_seen', 'last_seen'],
      // post_owner_id may be mapped as a numeric or keyword field — match either.
      query: { terms: { post_owner_id: [Number(postOwnerId), String(postOwnerId)] } },
      sort: [{ first_seen: { order: 'asc' } }],
    },
  });

  const hits = (esResult.hits || esResult.body?.hits)?.hits || [];
  const data = hits.map((h) => {
    const src = h._source || {};
    return {
      ad_id: src.sql_id != null ? src.sql_id : h._id,
      first_seen: toDateStr(src.first_seen),
      last_seen: toDateStr(src.last_seen),
    };
  });
  return { code: 200, data };
}

/**
 * POST /api/v1/common/ads/getAdvertiserAds?network=<net>
 * Body/query: { network, post_owner_id | competitor_id, limit? }
 * → { code, network, post_owner_id, total, data: [{ ad_id, first_seen }] }
 */
async function getAdvertiserAds(req, res) {
  const raw = { ...req.body, ...req.query };
  const network = String(raw.network || 'facebook').toLowerCase().trim();

  const rawPid = (raw.post_owner_id != null && raw.post_owner_id !== '')
    ? raw.post_owner_id
    : raw.competitor_id;

  if (rawPid == null || rawPid === '') {
    return res.status(400).json({ code: 400, message: 'Missing parameter: post_owner_id (competitor_id) is required' });
  }

  const postOwnerId = Number(rawPid);
  if (!Number.isInteger(postOwnerId) || postOwnerId <= 0) {
    return res.status(400).json({ code: 400, message: 'post_owner_id (competitor_id) must be a positive integer' });
  }

  if (!SUPPORTED.includes(network)) {
    return res.status(400).json({ code: 400, message: `Unsupported network: ${network}. Available: ${SUPPORTED.join(', ')}` });
  }

  const service = serviceRegistry.getService(network);
  if (!service) {
    return res.status(503).json({ code: 503, message: `${network} service not available` });
  }

  // Optional safety cap; omit to return the advertiser's entire ad set.
  const limitRaw = parseInt(raw.limit, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null;

  try {
    const result = network === 'tiktok'
      ? await fetchFromTiktokEs(service, postOwnerId, limit)
      : await fetchFromSql(NETWORK_SQL_TABLE[network], service, postOwnerId, limit);

    if (result.code !== 200) {
      return res.status(result.code).json({ code: result.code, message: result.message });
    }

    return res.json({
      code: 200,
      message: 'Advertiser ads fetched successfully',
      network,
      post_owner_id: postOwnerId,
      total: result.data.length,
      data: result.data,
    });
  } catch (err) {
    service.log?.error?.('Error in getAdvertiserAds', { network, post_owner_id: postOwnerId, error: err.message });
    return res.status(500).json({ code: 500, message: 'Error fetching advertiser ads', error: err.message });
  }
}

module.exports = { getAdvertiserAds };

'use strict';

/**
 * ChatGPT Ads — search / listing controller.
 *
 * Flow (same shape as the other networks' adSearchController: ES finds + orders the ids,
 * SQL hydrates the display fields):
 *   1. ChatgptSearchQueryBuilder → chatgpt_search_mix (filters, keyword, sort, paging)
 *   2. hydrate the matched ids from the chatgptads_* tables (pasdev_chat_ads)
 *   3. overlay ES-only media (new_nas_image_url / Thumbnail / nas_video_url / othermedia)
 *      and resolve every NAS path to a browser URL
 *
 * Called directly by commonSearchController (the endpoint the frontend uses) and by
 * POST /api/v1/chatgptads/ads/search.
 */

const ChatgptSearchQueryBuilder = require('../builders/ChatgptSearchQueryBuilder');
const { parseSearchParams, mediaUrl, parseJsonArray } = require('../helpers/paramParser');
const { getUserAdLists } = require('./hideAdsController');

const PLATFORM_ID = 21;
const NETWORK = 'chatgptads';

const AD_DETAIL_SELECT = `
    chatgptads_ad.id                                           AS id,
    chatgptads_ad.ad_id                                        AS ad_id,
    chatgptads_ad.type                                         AS type,
    chatgptads_ad.platform                                     AS platform,
    chatgptads_ad.ad_position                                  AS ad_position,
    chatgptads_ad.post_date                                    AS post_date,
    chatgptads_ad.first_seen                                   AS first_seen,
    chatgptads_ad.last_seen                                    AS last_seen,
    chatgptads_ad.days_running                                 AS days_running,
    chatgptads_ad.hits                                         AS hits,
    chatgptads_ad.status                                       AS status,
    chatgptads_ad.destination_url                              AS destination_url,
    chatgptads_ad.post_owner_id                                AS post_owner_id,
    ANY_VALUE(chatgptads_ad_post_owners.post_owner_name)       AS post_owner,
    ANY_VALUE(chatgptads_ad_post_owners.post_owner_image)      AS post_owner_image,
    ANY_VALUE(chatgptads_ad_domains.domain)                    AS domain,
    ANY_VALUE(chatgptads_ad_variants.title)                    AS ad_title,
    ANY_VALUE(chatgptads_ad_variants.text)                     AS ad_text,
    ANY_VALUE(chatgptads_ad_variants.newsfeed_description)     AS newsfeed_description,
    ANY_VALUE(chatgptads_ad_variants.image_url)                AS image_url,
    ANY_VALUE(chatgptads_ad_variants.image_url_original)       AS image_url_original,
    ANY_VALUE(chatgptads_ad_image_video.ad_image_video)        AS ad_image_video,
    ANY_VALUE(chatgptads_translation.language_name)            AS language,
    GROUP_CONCAT(DISTINCT all_countries.country SEPARATOR '||') AS countries
`;

const AD_DETAIL_JOINS = `
FROM chatgptads_ad
LEFT JOIN chatgptads_ad_post_owners ON chatgptads_ad.post_owner_id = chatgptads_ad_post_owners.id
LEFT JOIN chatgptads_ad_domains     ON chatgptads_ad.domain_id = chatgptads_ad_domains.id
LEFT JOIN chatgptads_ad_variants    ON chatgptads_ad.id = chatgptads_ad_variants.chatgptads_ad_id
LEFT JOIN chatgptads_ad_image_video ON chatgptads_ad.id = chatgptads_ad_image_video.chatgptads_ad_id
LEFT JOIN chatgptads_translation    ON chatgptads_ad.id = chatgptads_translation.chatgptads_ad_id
LEFT JOIN chatgptads_ad_countries   ON chatgptads_ad.id = chatgptads_ad_countries.chatgptads_ad_id
LEFT JOIN chatgptads_country_only AS all_countries ON chatgptads_ad_countries.country_only_id = all_countries.id
`;

function totalHits(hits) {
  const raw = typeof hits?.total === 'object' && hits.total !== null ? hits.total.value : hits?.total;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function asArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string' && val) return val.split('||').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * One card row. SQL is the source of truth for copy/advertiser; ES supplies the finished NAS
 * media paths (only ES carries nas_video_url / othermedia). Falls back to the ES doc alone
 * when SQL is unavailable or the row is missing.
 */
function toCardRow(src, row) {
  const r = row || {};
  const type = String(r.type || src.type || '').toUpperCase();
  const imagePath = src.new_nas_image_url || r.image_url || '';
  const thumbPath = src.Thumbnail || r.image_url || '';
  const image = mediaUrl(type === 'VIDEO' ? thumbPath : imagePath);
  const carousel = parseJsonArray(r.ad_image_video ?? src.othermedia).map(mediaUrl).filter(Boolean);
  const countries = asArray(r.countries).length ? asArray(r.countries) : asArray(src.country);
  const description = r.newsfeed_description ?? src.newsfeed_description ?? '';

  return {
    id: Number(r.id ?? src.id),
    ad_id: r.ad_id ?? src.ad_id,
    type,
    platform: PLATFORM_ID,
    network: NETWORK,
    ad_position: r.ad_position ?? src.ad_position ?? null,
    post_date: r.post_date ?? src.post_date ?? null,
    first_seen: r.first_seen ?? src.first_seen ?? null,
    last_seen: r.last_seen ?? src.last_seen ?? null,
    days_running: Number(r.days_running ?? src.days_running ?? 0) || null,
    hits: Number(r.hits ?? src.hits ?? 0),
    post_owner_id: r.post_owner_id ?? null,
    post_owner: r.post_owner ?? src.post_owner_name ?? null,
    post_owner_image: mediaUrl(r.post_owner_image ?? src.post_owner_image) || null,
    ad_title: r.ad_title ?? src.ad_title ?? '',
    ad_text: r.ad_text ?? src.ad_text ?? '',
    // Both spellings: the frontend card mapper reads news_feed_description, other
    // consumers read the canonical newsfeed_description stored for this network.
    newsfeed_description: description,
    news_feed_description: description,
    destination_url: r.destination_url ?? src.destination_url ?? null,
    domain: r.domain ?? src.domain ?? null,
    country: countries,
    language: r.language ?? src.lang_detect ?? null,
    image_video_url: image,
    image_url_original: r.image_url_original ?? src.image_url_original ?? null,
    nas_video_url: type === 'VIDEO' ? (src.nas_video_url || null) : null,
    ad_image_video: carousel,
    // Same contract other networks use: keep the ad (count == rendered cards) but tell the
    // card to show a placeholder until the NAS upload lands.
    preview_unavailable: type === 'IMAGE' && !image,
  };
}

async function hydrateFromSql(sql, ids, logger) {
  if (!sql || ids.length === 0) return new Map();
  try {
    const placeholders = ids.map(() => '?').join(',');
    const rows = await sql.query(
      `SELECT ${AD_DETAIL_SELECT}
${AD_DETAIL_JOINS}
WHERE chatgptads_ad.id IN (${placeholders})
GROUP BY chatgptads_ad.id`,
      ids
    );
    return new Map((rows || []).map((row) => [String(row.id), row]));
  } catch (err) {
    logger.warn('ChatGPT Ads SQL hydration failed — falling back to ES documents', { error: err.message });
    return new Map();
  }
}

/**
 * @param {Object} req    - Express request (body/query carry the shared search payload)
 * @param {Object} db     - { sql, elastic } injected by ServiceRegistry for 'chatgptads'
 * @param {Object} logger - service logger
 * @returns {Promise<{code:number, data:Array, total:number, message:string}>}
 */
async function searchAds(req, db, logger) {
  if (!db?.elastic) {
    return { code: 503, message: 'ChatGPT Ads Elasticsearch connection is unavailable.', data: [], total: 0 };
  }

  const p = parseSearchParams({ ...(req.query || {}), ...(req.body || {}) });

  // Saved / Hidden pages: scope the search to this user's chatgptads_hidden_ads rows.
  let userLists = null;
  if (p.favorite || p.hidden) {
    if (!db.sql) return { code: 503, message: 'SQL connection not available', data: [], total: 0 };
    if (!p.userId) return { code: 400, message: 'Missing param: user_id', data: [], total: 0 };
    userLists = await getUserAdLists(db, p.userId);
    const empty = p.favorite
      ? userLists.savedAdIds.length === 0
      : userLists.hiddenAdIds.length === 0 && userLists.hiddenOwners.length === 0;
    if (empty) {
      return { code: 200, data: [], total: 0, message: p.favorite ? 'No favorite ads found' : 'No hidden ads found' };
    }
  }

  const builder = new ChatgptSearchQueryBuilder(db.elastic.indexName)
    .setFrom(p.from)
    .setSize(p.size)
    .setSort(p.sort.key, p.sort.order)
    .setKeyword(p.keyword)
    .setPostOwnerName(p.advertiser, p.exactSearch)
    .setDomain(p.domain)
    .setAdvertisers(p.advertisers)
    .setCountry(p.countries)
    .setAdType(p.types)
    .setLanguage(p.languages)
    .setAdPosition(p.adPositions)
    .setMarketPlatform(p.marketPlatforms)
    .setFirstSeen(p.firstSeen)
    .setLastSeen(p.lastSeen);
  if (p.favorite) builder.setAdIds(userLists.savedAdIds);
  else if (p.hidden) builder.setHiddenScope({ adIds: userLists.hiddenAdIds, ownerLowers: userLists.hiddenOwners });

  const esParams = builder.build();

  try {
    const result = await db.elastic.search(esParams);
    const hits = (result.body || result).hits || {};
    const esHits = hits.hits || [];
    const total = totalHits(hits);

    if (esHits.length === 0) {
      return { code: 200, data: [], total, message: 'No ads found' };
    }

    const ids = esHits.map((hit) => Number(hit._source?.id ?? hit._id)).filter(Number.isFinite);
    const sqlRows = await hydrateFromSql(db.sql, ids, logger);

    // Keep ES order (it carries the sort); SQL only fills in fields.
    let data = esHits.map((hit) => {
      const src = hit._source || {};
      return toCardRow(src, sqlRows.get(String(src.id ?? hit._id)));
    });

    // Hidden page: tell the card what was hidden (ad vs advertiser) so Unhide sends the
    // right type — same hideType / ad_type / hiddenPostOwnerId fields other networks attach.
    if (p.hidden) {
      data = data.map((ad) => {
        const ownerKey = `owner:${String(ad.post_owner || '').toLowerCase()}`;
        const meta = userLists.hideMeta.get(String(ad.ad_id)) || userLists.hideMeta.get(ownerKey);
        if (!meta) return ad;
        return { ...ad, hideType: meta.hideType, ad_type: meta.hideType, hiddenPostOwnerId: meta.postOwnerId };
      });
    }

    return { code: 200, data, total, message: 'Ads fetched successfully' };
  } catch (err) {
    logger.error('ChatGPT Ads search failed', { error: err.message });
    return { code: 500, message: 'ChatGPT Ads could not be fetched.', error: err.message, data: [], total: 0 };
  }
}

/**
 * One ad by its external ad_id — used by the shared-link endpoint
 * (common/shareAdController: copy-link button + public /share/:token page).
 * Same contract as other networks' share handlers: req.body.ad_id → {code, data:[ad]}.
 */
async function getAdByAdId(req, db, logger) {
  const adId = String(req?.body?.ad_id ?? '').trim();
  if (!adId) return { code: 400, message: 'Missing param: ad_id', data: [] };
  if (!db?.elastic) return { code: 503, message: 'ChatGPT Ads Elasticsearch connection is unavailable.', data: [] };

  try {
    const esParams = new ChatgptSearchQueryBuilder(db.elastic.indexName).setSize(1).setAdIds([adId]).build();
    const result = await db.elastic.search(esParams);
    const hit = ((result.body || result).hits?.hits || [])[0];
    if (!hit) return { code: 404, message: 'Ad not found', data: [] };

    const src = hit._source || {};
    const id = Number(src.id ?? hit._id);
    const sqlRows = await hydrateFromSql(db.sql, Number.isFinite(id) ? [id] : [], logger);
    return { code: 200, data: [toCardRow(src, sqlRows.get(String(src.id ?? hit._id)))], message: 'Ad fetched successfully' };
  } catch (err) {
    logger.error('ChatGPT Ads fetch by ad_id failed', { error: err.message, adId });
    return { code: 500, message: 'ChatGPT ad could not be fetched.', data: [] };
  }
}

module.exports = { searchAds, getAdByAdId, toCardRow, AD_DETAIL_SELECT, AD_DETAIL_JOINS };

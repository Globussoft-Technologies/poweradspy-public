'use strict';

/**
 * Resolves {network, ad_id} -> the ad's real creative image URL, looked up
 * server-side from our own ES index — the Recreate request never trusts a raw
 * client-supplied image URL (a malicious/incorrect URL could otherwise be sent
 * straight to the paid Ad Studio API).
 *
 * Covers facebook, instagram, chatgptads this round (the networks with a
 * confirmed ES field shape from this session's work). Adding another network is
 * one more case in RESOLVERS below — same shape, different index/field names.
 */

const databaseManager = require('../../../database/DatabaseManager');
const { resolveMediaUrl } = require('../../../insertion/helpers/nasClient');

function firstHit(results) {
  return results?.hits?.hits?.[0] || results?.body?.hits?.hits?.[0] || null;
}

function field(source, path) {
  if (!source || !path) return undefined;
  if (source[path] !== undefined) return source[path];
  return path.split('.').reduce((value, part) => value?.[part], source);
}

function firstText(source, paths) {
  for (const path of paths) {
    const value = field(source, path);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

/** Parses a carousel ad's multi-image field into a flat URL list — same shape the
 * frontend derives independently in services/api.js (raw.ad_image_video ||
 * raw.carousel_media): either a JSON-array string, a real array, or a
 * '||'/'||,'-delimited string. Kept in sync with that parsing so "the slide the
 * user was looking at" and "the slide this resolver can find" agree on indices
 * — though the actual selection below matches by URL, not index, so a small
 * drift here wouldn't mis-wire the two. DefaultImage placeholders are dropped. */
function parseCarouselUrls(rawField) {
  let val = rawField;
  if (typeof val === 'string' && val.trim().startsWith('[') && val.trim().endsWith(']')) {
    try { val = JSON.parse(val); } catch { /* not actually JSON — fall through as a plain string */ }
  }
  const notDefault = (u) => typeof u === 'string' && !!u && !u.includes('DefaultImage');
  if (Array.isArray(val)) return val.filter(notDefault);
  if (typeof val !== 'string' || !val) return [];
  const sep = val.includes('||,') ? '||,' : (val.includes('||') ? '||' : null);
  if (!sep) return [val].filter(notDefault);
  return val.split(sep).map((s) => s.trim()).filter(notDefault);
}

function runningDays(source, prefix) {
  const stored = Number(field(source, `${prefix}.days_running`) ?? source.days_running);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const first = new Date(field(source, `${prefix}.first_seen`) ?? source.first_seen);
  const last = new Date(field(source, `${prefix}.last_seen`) ?? source.last_seen);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || last < first) return null;
  return Math.floor((last - first) / 86400000) + 1;
}

async function resolveFacebookLike(networkSlug, idField, typePrefix, variantsPrefix, adId) {
  const es = databaseManager.getElastic(networkSlug);
  if (!es || !es.client) return { ok: false, reason: `${networkSlug} Elasticsearch is not configured` };

  const hit = firstHit(await es.search({
    index: es.indexName,
    body: { query: { bool: { filter: { terms: { [idField]: [String(adId)] } } } } },
  }));
  if (!hit) return { ok: false, reason: 'ad not found' };

  const src = hit._source || {};
  const isImage = (src[typePrefix] || '').toUpperCase() === 'IMAGE';
  const imageUrl = isImage ? src.new_nas_image_url : src.thumbnail_url;
  if (!imageUrl) return { ok: false, reason: 'ad has no usable image' };

  // Carousel ads carry their other slides in ad_image_video (or carousel_media) —
  // same raw field the frontend's carouselMedia already reads. Collected here so
  // a client-selected slide (see resolveAdCreative's preferredImageUrl) can be
  // validated against the ad's OWN creative set instead of trusting it blind.
  const carouselUrls = parseCarouselUrls(src.ad_image_video || src.carousel_media);

  return {
    ok: true,
    imageUrl,
    allImageUrls: [imageUrl, ...carouselUrls],
    title: src[`${variantsPrefix}.title`] || '',
    text: src[`${variantsPrefix}.text`] || '',
    advertiser: firstText(src, [
      `${networkSlug}_ad_post_owners.post_owner_name`,
      `${networkSlug}_ad_post_owners.post_owner_name_exactly`,
      'post_owner_name',
      'post_owner',
    ]),
    runningDays: runningDays(src, `${networkSlug}_ad`),
  };
}

async function resolveChatgptads(adId) {
  const esChat = databaseManager.getElastic('chatgptads');
  if (!esChat || !esChat.client) return { ok: false, reason: 'chatgptads Elasticsearch is not configured' };

  const hit = firstHit(await esChat.search({
    index: 'chatgpt_search_mix',
    type: 'doc',
    body: { query: { term: { ad_id: String(adId) } } },
  }));
  if (!hit) return { ok: false, reason: 'ad not found' };

  const src = hit._source || {};
  const imageUrl = src.type === 'VIDEO' ? src.Thumbnail : src.new_nas_image_url;
  if (!imageUrl) return { ok: false, reason: 'ad has no usable image' };

  return {
    ok: true,
    imageUrl,
    title: src.ad_title || '',
    text: src.ad_text || '',
    advertiser: firstText(src, ['post_owner_name', 'post_owner', 'advertiser']),
    runningDays: runningDays(src, 'chatgpt_ad'),
  };
}

const RESOLVERS = {
  facebook: (adId) => resolveFacebookLike('facebook', 'facebook_ad.id', 'facebook_ad.type', 'facebook_ad_variants', adId),
  instagram: (adId) => resolveFacebookLike('instagram', 'instagram_ad.id', 'instagram_ad.type', 'instagram_ad_variants', adId),
  chatgptads: (adId) => resolveChatgptads(adId),
};

/**
 * @param {Object} [opts]
 * @param {string} [opts.preferredImageUrl] - a specific carousel slide the client
 *   wants recreated (e.g. "the slide the user was viewing in the masonry card").
 *   Only honored if it exactly matches one of THIS ad's own resolved creative
 *   URLs — never trusted blind, since this ends up in a paid Ad Studio call.
 *   Falls back to the ad's default/cover image otherwise (not provided, or
 *   didn't match).
 * @returns {Promise<{ok:true, imageUrl:string, allImageUrls:string[], title?:string, text?:string} | {ok:false, reason:string}>}
 * imageUrl/allImageUrls are always resolved to ABSOLUTE, publicly-fetchable URLs
 * (resolveMediaUrl, the same helper every network's NAS-stored relative path
 * already goes through elsewhere) — Ad Studio downloads image_urls itself and
 * needs a real reachable link, not our internal `/pas-dev/stream/...` relative
 * path. Found live: the raw ES field value is relative.
 */
async function resolveAdCreative(network, adId, opts = {}) {
  const resolver = RESOLVERS[String(network || '').toLowerCase()];
  if (!resolver) return { ok: false, reason: `network "${network}" is not yet supported by AI Recreate` };
  try {
    const result = await resolver(adId);
    if (!result.ok) return result;
    const allImageUrls = [...new Set((result.allImageUrls || [result.imageUrl]).map(resolveMediaUrl))];
    let imageUrl = resolveMediaUrl(result.imageUrl);
    if (opts.preferredImageUrl && allImageUrls.includes(opts.preferredImageUrl)) {
      imageUrl = opts.preferredImageUrl;
    }
    return { ...result, imageUrl, allImageUrls };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { resolveAdCreative, SUPPORTED_NETWORKS: Object.keys(RESOLVERS) };

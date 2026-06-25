'use strict';

const config = require('../../../config');

// CDN base URL — prepended to relative image paths (e.g. /PowerAdspy/n2/fb/...)
const CDN_BASE = (config.cdn && config.cdn.baseUrl) ? config.cdn.baseUrl.replace(/\/$/, '') : '';

/**
 * Normalize request params — replaces PHP‑style "NA" sentinel values with
 * empty strings and trims whitespace.  Works for both objects and individual values.
 *
 * PHP sends "NA" as a default for missing/unset filter params.
 * The Node.js code uses empty‑string to mean "not set".
 */

/**
 * Normalize a single value — "NA", null, undefined → ''
 */
function normalizeValue(val) {
  if (val === 'NA' || val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  return val;
}

/**
 * Normalize all top-level keys of an object.
 * @param {Object} body - raw request body / query
 * @returns {Object}    - normalized copy (original is not mutated)
 */
function normalizeParams(body) {
  if (!body || typeof body !== 'object') return {};
  const result = {};
  for (const [key, val] of Object.entries(body)) {
    result[key] = normalizeValue(val);
  }
  return result;
}

/**
 * Ensure a value is always an array (wraps scalars).
 */
function ensureArray(val) {
  if (Array.isArray(val)) return val;
  if (val === '' || val === null || val === undefined) return [];
  return [val];
}

/**
 * Parse pagination params.
 * Supports both legacy PHP params (take/skip) and new React params (page_size/page).
 */
function parsePagination(params) {
  const take = parseInt(params.take, 10) || parseInt(params.page_size, 10) || 20;
  const page = parseInt(params.skip, 10) || parseInt(params.page, 10) || 0;
  return { size: take, from: take * page };
}

/**
 * Parse sort params from the request.
 * PHP sends multiple sort flags; only the first non-empty one wins.
 */
function parseSort(params) {
  const sortMap = {
    newest_sort:          'facebook_ad.last_seen',
    running_longest_sort: 'facebook_ad.days_running',
    last_seen_sort:       'facebook_ad.last_seen',
    likes_sort:           'facebook_ad.likes',
    impression_sort:      'facebook_ad.impression',
    popularity_sort:      'facebook_ad.popularity.current',
    adBudget_sort:        'facebook.averagebudget',
    comments_sort:        'facebook_ad.comments',
    shares_sort:          'facebook_ad.shares',
    domain_sort:          'facebook_ad_domains.domain_registered_date',
  };

  for (const [key, esField] of Object.entries(sortMap)) {
    const val = normalizeValue(params[key]);
    if (val && typeof val === 'string' && val !== '') {
      return { field: esField, order: val.toLowerCase() === 'asc' ? 'asc' : 'desc' };
    }
  }

  // order_column / order_by fallback
  const orderColumn = normalizeValue(params.order_column);
  const orderBy     = normalizeValue(params.order_by);
  if (orderColumn) {
    const columnMap = {
      post_date:  'facebook_ad.post_date',
      last_seen:  'facebook_ad.last_seen',
      likes:      'facebook_ad.likes',
      comments:   'facebook_ad.comments',
      shares:     'facebook_ad.shares',
      impression: 'facebook_ad.impression',
      popularity: 'facebook_ad.popularity.current',
    };
    const esField = columnMap[orderColumn];
    if (esField) return { field: esField, order: orderBy === 'asc' ? 'asc' : 'desc' };
  }

  // Default sort
  return { field: 'facebook_ad.last_seen', order: 'desc' };
}


/**
 * Prepend CDN base URL to a relative image path.
 * Skips if already absolute (starts with http) or CDN_BASE is empty.
 */
function withCdn(url) {
  if (!url || !CDN_BASE) return url;
  if (typeof url !== 'string') return url;
  let trimmed = url.trim();
  // Some upstream rows pack a primary + fallback URL into the same field
  // separated by "||". Without splitting first, the early http-prefix check
  // below treats the whole concatenation as resolved and the second segment
  // keeps its PowerAdspy/n2 prefix — the frontend ends up with an unreachable
  // `<img src="https://...||/PowerAdspy/...">`. Split, clean each, return
  // the first reachable URL.
  if (trimmed.includes('||')) {
    const cleaned = trimmed
      .split('||')
      .map(s => withCdn(s.trim()))
      .filter(Boolean);
    return cleaned[0] || '';
  }
  if (trimmed.startsWith('http')) return trimmed;
  trimmed = trimmed.replace(/^\/?(PowerAdspy\/n2|PowerAdspy-Dev|PowerAdspy|pas-dev\/stream|pas-prod\/stream)\//i, '/');
  return CDN_BASE + (trimmed.startsWith('/') ? trimmed : '/' + trimmed);
}

function cleanAdsData(ads = []) {
  return ads
    .filter(ad => ad && ad.id != null && ad.ad_id != null)
    .map(ad => {
      const cleaned = {};

      for (const key in ad) {
        let value = ad[key];

        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
          ) {
            try { value = JSON.parse(trimmed); } catch (_) { /* keep original */ }
          }
        }

        cleaned[key] = value;
      }

      // Prepend CDN domain to image URL fields
      if (cleaned.post_owner_image) cleaned.post_owner_image = withCdn(cleaned.post_owner_image);
      if (cleaned.image_video_url)   cleaned.image_video_url  = withCdn(cleaned.image_video_url);
      if (cleaned.image_url)         cleaned.image_url        = withCdn(cleaned.image_url);
      if (Array.isArray(cleaned.ad_image_video)) {
        cleaned.ad_image_video = cleaned.ad_image_video.map(withCdn);
      } else if (typeof cleaned.ad_image_video === 'string' && cleaned.ad_image_video) {
        // ad_image_video is a "||"-joined list of carousel slide URLs. Clean
        // each slide independently (so any PowerAdspy/n2 prefix gets stripped)
        // and rejoin — the frontend splits on "||" to render the carousel. We
        // cannot use withCdn directly here because withCdn collapses "||" to a
        // single URL for safety of single-URL fields.
        cleaned.ad_image_video = cleaned.ad_image_video
          .split('||')
          .map(s => withCdn(s.trim()))
          .filter(Boolean)
          .join('||');
      }

      return cleaned;
    });
}

module.exports = {
  normalizeValue,
  normalizeParams,
  ensureArray,
  parsePagination,
  parseSort,
  cleanAdsData
};

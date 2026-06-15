'use strict';

const config = require('../../../config');

const CDN_BASE = (config.cdn && config.cdn.baseUrl) ? config.cdn.baseUrl.replace(/\/$/, '') : '';

function normalizeValue(val) {
  if (val === 'NA' || val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  return val;
}

function normalizeParams(body) {
  if (!body || typeof body !== 'object') return {};
  const result = {};
  for (const [key, val] of Object.entries(body)) {
    result[key] = normalizeValue(val);
  }
  return result;
}

function ensureArray(val) {
  if (Array.isArray(val)) return val;
  if (val === '' || val === null || val === undefined) return [];
  return [val];
}

function parsePagination(params) {
  const take = parseInt(params.take, 10) || parseInt(params.page_size, 10) || 20;
  const page = parseInt(params.skip, 10) || parseInt(params.page, 10) || 0;
  return { size: take, from: take * page };
}

/**
 * GDN-specific sort field mapping.
 * ES index uses prefixed field names (gdn_ad.*, gdn_ad_domains.*, etc.)
 */
function parseSort(params) {
  const sortMap = {
    newest_sort:          'gdn_ad.id',
    running_longest_sort: 'gdn_ad.days_running',
    likes_sort:           'gdn_ad.likes',
    comments_sort:        'gdn_ad.comments',
    hits_sort:            'gdn_ad.hits',
    domain_sort:          'gdn_ad_domains.domain_registered_date',
  };

  for (const [key, esField] of Object.entries(sortMap)) {
    const val = normalizeValue(params[key]);
    if (val && typeof val === 'string' && val !== '') {
      return { field: esField, order: val.toLowerCase() === 'asc' ? 'asc' : 'desc' };
    }
  }

  const orderColumn = normalizeValue(params.order_column);
  const orderBy     = normalizeValue(params.order_by);
  if (orderColumn) {
    const columnMap = {
      last_seen:    'gdn_ad.last_seen',
      post_date:    'gdn_ad.post_date',
      likes:        'gdn_ad.likes',
      comments:     'gdn_ad.comments',
      hits:         'gdn_ad.hits',
      days_running: 'gdn_ad.days_running',
    };
    const esField = columnMap[orderColumn];
    if (esField) return { field: esField, order: orderBy === 'asc' ? 'asc' : 'desc' };
  }

  return { field: 'gdn_ad.last_seen', order: 'desc' };
}

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
  trimmed = trimmed.replace(/^\/?(PowerAdspy\/n2|PowerAdspy-Dev|pas-dev\/stream|pas-prod\/stream)\//i, '/');
  return CDN_BASE + (trimmed.startsWith('/') ? trimmed : '/' + trimmed);
}

function cleanAdsData(ads = []) {
  return ads
    .filter(ad => ad && ad.id != null)
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

      if (cleaned.post_owner_image) cleaned.post_owner_image = withCdn(cleaned.post_owner_image);
      if (cleaned.image_video_url)   cleaned.image_video_url  = withCdn(cleaned.image_video_url);
      if (cleaned.image_url)         cleaned.image_url        = withCdn(cleaned.image_url);

      return cleaned;
    });
}

module.exports = {
  normalizeValue,
  normalizeParams,
  ensureArray,
  parsePagination,
  parseSort,
  cleanAdsData,
};

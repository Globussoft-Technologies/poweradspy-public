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

function parseSort(params) {
  const sortMap = {
    // "Newest" sorts by last_seen (a real, reliably-populated date) — NOT quora_ad.id.
    // quora_ad.id is insertion order, which is decorrelated from the ad's date (re-crawls,
    // batch/dual-pipeline ingestion, frequently-null post_date), so id-desc made the grid
    // look unsorted-by-date. last_seen matches the date the card displays and the field the
    // frontend re-sorts by, so backend order, pagination, and the visible date now agree.
    // quora_ad.id remains the sort tiebreak (see QuoraSearchQueryBuilder baseSort).
    newest_sort:          'quora_ad.last_seen',
    running_longest_sort: 'quora_ad.days_running',
    last_seen_sort:       'quora_ad.last_seen',
    hits_sort:            'quora_ad.hits',
    domain_sort:          'quora_ad_domain.domain_registered_date',
  };
  for (const [key, esField] of Object.entries(sortMap)) {
    const val = normalizeValue(params[key]);
    if (val && typeof val === 'string' && val !== '') return { field: esField, order: val.toLowerCase() === 'asc' ? 'asc' : 'desc' };
  }
  if (params.seen_btn_sort && Array.isArray(params.seen_btn_sort)) return { field: 'quora_ad.last_seen', order: 'desc' };
  const oc = normalizeValue(params.order_column); const ob = normalizeValue(params.order_by);
  if (oc) { const m = { post_date: 'quora_ad.post_date', last_seen: 'quora_ad.last_seen', hits: 'quora_ad.hits', domain_date: 'quora_ad_domain.domain_registered_date' }; if (m[oc]) return { field: m[oc], order: ob === 'asc' ? 'asc' : 'desc' }; }
  return { field: 'quora_ad.last_seen', order: 'desc' };
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
  return ads.filter(ad => ad && ad.id != null && ad.ad_id != null).map(ad => {
    const cleaned = {};
    for (const key in ad) {
      let value = ad[key];
      if (typeof value === 'string') { const t = value.trim(); if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) { try { value = JSON.parse(t); } catch (_) {} } }
      cleaned[key] = value;
    }
    if (cleaned.post_owner_image) cleaned.post_owner_image = withCdn(cleaned.post_owner_image);
    if (cleaned.image_video_url) cleaned.image_video_url = withCdn(cleaned.image_video_url);
    if (cleaned.image_url) cleaned.image_url = withCdn(cleaned.image_url);
    if (Array.isArray(cleaned.ad_image_video)) cleaned.ad_image_video = cleaned.ad_image_video.map(withCdn);
    // ad_image_video is a "||"-joined carousel string — split, clean each slide
    // via withCdn, rejoin. We can't use withCdn on the joined value directly
    // because it now collapses "||" to a single URL for single-URL fields.
    else if (typeof cleaned.ad_image_video === 'string' && cleaned.ad_image_video) cleaned.ad_image_video = cleaned.ad_image_video.split('||').map(s => withCdn(s.trim())).filter(Boolean).join('||');
    return cleaned;
  });
}

module.exports = { normalizeValue, normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData, CDN_BASE };

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
    newest_sort:          'pinterest_ad.last_seen',
    running_longest_sort: 'pinterest_ad.days_running',
    last_seen_sort:       'pinterest_ad.last_seen',
    domain_sort:          'pinterest_ad_domains.domain_registered_date',
  };
  for (const [key, esField] of Object.entries(sortMap)) {
    const val = normalizeValue(params[key]);
    if (val && typeof val === 'string' && val !== '') return { field: esField, order: val.toLowerCase() === 'asc' ? 'asc' : 'desc' };
  }
  if (params.seen_btn_sort && Array.isArray(params.seen_btn_sort)) return { field: 'pinterest_ad.last_seen', order: 'desc' };
  const oc = normalizeValue(params.order_column); const ob = normalizeValue(params.order_by);
  if (oc) { const m = { post_date: 'pinterest_ad.post_date', last_seen: 'pinterest_ad.last_seen', domain_date: 'pinterest_ad_domains.domain_registered_date' }; if (m[oc]) return { field: m[oc], order: ob === 'asc' ? 'asc' : 'desc' }; }
  return { field: 'pinterest_ad.last_seen', order: 'desc' };
}

function withCdn(url) {
  if (!url || !CDN_BASE) return url;
  if (typeof url !== 'string') return url;
  let trimmed = url.trim();
  // Some upstream rows pack a primary + fallback URL into the same field
  // separated by "||" (e.g. "https://cdn/a.jpg||/PowerAdspy/n2/a.jpg"). The
  // early `startsWith('http')` check below would otherwise see the whole
  // concatenation as already-resolved and return it untouched, leaving the
  // PowerAdspy/n2 prefix in the second segment and producing an unreachable
  // `<img src="https://...||/PowerAdspy/...">` on the frontend. Split first,
  // clean each segment, and return the first reachable URL — downstream
  // consumers of single-URL fields expect a single URL string.
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
    return cleaned;
  });
}

module.exports = { normalizeValue, normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData, CDN_BASE };

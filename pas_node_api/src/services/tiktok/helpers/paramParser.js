'use strict';

const config = require('../../../config');

const CDN_BASE = (config.cdn && config.cdn.baseUrl) ? config.cdn.baseUrl.replace(/\/$/, '') : '';
// TikTok creatives are split across two buckets on the SAME media host — pas-prod
// for the 2025 `/PowerAdspy/tiktok/...` era, pas-dev for the newer `PowerAdspy/n2`,
// `PowerAdspy-Dev` and `pas-*/stream` eras (verified against the live CDN). Derive
// the bucket-less host from CDN_BASE so withCdn() can target whichever bucket
// actually holds each file. Assumes both buckets live under the same host and
// differ only in the `/<bucket>/stream` segment (true for media.globussoft.com).
const CDN_HOST = CDN_BASE.replace(/\/[^/]+\/stream$/i, '');
const CDN_PROD = CDN_HOST ? `${CDN_HOST}/pas-prod/stream` : '';
const CDN_DEV  = CDN_HOST ? `${CDN_HOST}/pas-dev/stream`  : '';

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
  const take = parseInt(params.limit, 10) || parseInt(params.take, 10) || parseInt(params.page_size, 10) || 20;
  const page = parseInt(params.skip, 10) || parseInt(params.page, 10) || 0;
  return { size: take, from: page * take };
}

function parseSort(params) {
  const { sortBy } = params;

  // Standard flags sent by the common multi-network controller
  if (params.popularity_sort      === 'popularity_sort')      return { field: 'popularity',              order: 'desc' };
  if (params.newest_sort          === 'newest_sort')          return { field: 'createdAt',               order: 'desc' };
  if (params.last_seen_sort       === 'LastSeen_sort')        return { field: 'updatedAt',               order: 'desc' };
  if (params.running_longest_sort === 'running_longest_sort') return { field: 'days_running',            order: 'desc' };
  if (params.likes_sort           === 'likes_sort')           return { field: 'likes',                   order: 'desc' };
  if (params.comments_sort        === 'comments_sort')        return { field: 'comments',                order: 'desc' };
  if (params.shares_sort          === 'shares_sort')          return { field: 'shares',                  order: 'desc' };
  if (params.impression_sort      === 'impression_sort')      return { field: 'impression',              order: 'desc' };
  if (params.adBudget_sort        === 'adBudget_sort')        return { field: 'budget',                  order: 'desc' };

  // Metric-based sort: active when a range filter is set for that metric.
  // Supports both object { min, max } and array [min, max] formats.
  // Unified payload sort: order_column takes priority — frontend already computes
  // the correct sort field based on which filter was applied last.
  const ORDER_COLUMN_MAP = {
    likes: 'likes', comments: 'comments', shares: 'shares',
    impression: 'impression', impressions: 'impression',
    popularity: 'popularity', ctr: 'ctr', budget: 'budget',
    newest: 'createdAt', last_seen: 'updatedAt', days_running: 'days_running',
  };
  if (params.order_column && params.order_column !== 'NA' && params.order_column !== 'post_date' && params.order_column !== '') {
    const esField = ORDER_COLUMN_MAP[params.order_column] || params.order_column;
    const order = params.order_by === 'asc' ? 'asc' : 'desc';
    return { field: esField, order };
  }

  // TikTok-native sortBy values (from the TikTok-specific frontend)
  if (sortBy === 'Newest')       return { field: 'createdAt',             order: 'desc' };
  if (sortBy === 'LastSeen')     return { field: 'updatedAt',             order: 'desc' };
  if (sortBy === 'domain_date')  return { field: 'domain_registered_date', order: 'desc' };
  if (sortBy === 'days_running') return { field: 'days_running',          order: 'desc' };
  if (sortBy === 'Impression')   return { field: 'impression',            order: 'desc' };
  if (sortBy === 'Popularity')   return { field: 'popularity',            order: 'desc' };

  // Fallback: metric-based sort when order_column is post_date (default/newest)
  const metrics = ['ctr', 'likes', 'shares', 'comments', 'impression', 'popularity'];
  for (const key of metrics) {
    const v = params[key];
    if (!v) continue;
    if (Array.isArray(v) && v.length === 2) return { field: key, order: 'desc' };
    if (typeof v === 'object' && !Array.isArray(v)) {
      const hasMin = v.min !== '' && v.min !== null && v.min !== undefined;
      const hasMax = v.max !== '' && v.max !== null && v.max !== undefined;
      if (hasMin || hasMax) return { field: key, order: 'desc' };
    }
  }

  return { field: 'updatedAt', order: 'desc' };
}

// Resolve a stored TikTok media path (video_cover / image_url) to a reachable CDN
// URL. Paths were written by several pipeline eras whose files landed in DIFFERENT
// buckets, so a single static base can't serve them all. Route each known format
// to the bucket that actually holds its file (all verified against the live CDN):
//   /pas-dev/stream/... , /pas-prod/stream/...  -> bucket already embedded; host + path
//   /PowerAdspy/n2/... , /PowerAdspy-Dev/...     -> pas-dev; strip the logical tag
//   /PowerAdspy/tiktok/... (2025 era)            -> pas-prod; keep the path
//   pasvideos/*.jpg (old)                        -> gone from CDN (unresolvable)
//   http(s)://...                                -> already absolute
// This is a read-side compatibility shim; the durable fix is normalizing
// video_cover at ingestion so every ad stores one canonical, resolvable path.
function withCdn(url) {
  if (!url || !CDN_BASE) return url;
  if (typeof url !== 'string') return url;
  const trimmed = url.trim();
  // Some upstream rows pack a primary + fallback URL into the same field
  // separated by "||". Split, clean each, return the first reachable URL.
  if (trimmed.includes('||')) {
    const cleaned = trimmed
      .split('||')
      .map(s => withCdn(s.trim()))
      .filter(Boolean);
    return cleaned[0] || '';
  }
  if (trimmed.startsWith('http')) return trimmed;

  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  // Bucket already in the path (newest era) — keep it, just prepend the host.
  if (/^\/(pas-dev|pas-prod)\/stream\//i.test(path)) {
    return CDN_HOST + path;
  }
  // Dev-pipeline tags — strip the logical prefix to the real path, serve from pas-dev.
  const devPath = path.replace(/^\/(PowerAdspy\/n2|PowerAdspy-Dev)\//i, '/');
  if (devPath !== path) {
    return CDN_DEV + devPath;
  }
  // Prod 2025 format (keeps the PowerAdspy folder) — serve from pas-prod.
  if (/^\/PowerAdspy\/tiktok\//i.test(path)) {
    return CDN_PROD + path;
  }
  // Legacy / unknown (e.g. pasvideos) — best effort on the configured base.
  return CDN_BASE + path;
}

function cleanAdsData(ads = []) {
  return ads.filter(ad => ad && (ad.sql_id != null || ad.id != null)).map(ad => {
    const cleaned = {};
    for (const key in ad) {
      let value = ad[key];
      if (typeof value === 'string') {
        const t = value.trim();
        if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
          try { value = JSON.parse(t); } catch (_) {}
        }
      }
      cleaned[key] = value;
    }
    if (cleaned.video_cover) cleaned.video_cover = withCdn(cleaned.video_cover);
    if (cleaned.image_url) cleaned.image_url = withCdn(cleaned.image_url);
    // Convert CTR from ratio (0.0–1.0) to percentage (0–100) for frontend display
    if (cleaned.ctr != null && typeof cleaned.ctr === 'number') {
      cleaned.ctr = Math.round(cleaned.ctr * 100 * 100) / 100;
    }
    return cleaned;
  });
}

module.exports = { normalizeValue, normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData, CDN_BASE, withCdn };

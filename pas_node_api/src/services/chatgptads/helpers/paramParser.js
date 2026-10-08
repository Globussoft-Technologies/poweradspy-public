'use strict';

/**
 * ChatGPT Ads — request param parsing for the search/listing endpoint.
 *
 * Reads the same transport payload the frontend sends to /api/v1/common/ads/search
 * (PHP-era "NA" sentinels, take/skip paging, *_sort flags, [upper, lower] epoch-second
 * date pairs) and turns it into a plain, ChatGPT-only search spec. ChatGPT reuses the
 * dashboard's existing search bar (keyword / advertiser / domain), Country filter, date
 * picker and sort dropdown; only the value translation (ISO → country name, sort flags →
 * ChatGPT sort keys) lives here.
 */

const { resolveMediaUrl } = require('../../../insertion/helpers/nasClient');

// ISO-3166 alpha-2 → English country name ("IN" → "India"); same lookup utils/geoip.js uses
// internally (not exported there, so kept local to this network).
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function getCountryName(code) {
  try { return regionNames.of(code); } catch { return null; }
}

// ISO-639 code → English language name ("en" → "English"), which is what insertion stores
// in the ChatGPT index's `lang_detect`.
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

// Legacy codes Intl canonicalises to a DIFFERENT language than the Language filter's label
// ("mo" → Romanian, "sh" → Serbian (Latin), "tl" → Filipino). Search them by their own name
// so picking Moldavian doesn't return Romanian ads.
const LANGUAGE_NAME_OVERRIDES = { mo: 'Moldavian', sh: 'Serbo-Croatian', tl: 'Tagalog' };

/**
 * Languages from the shared Language filter. The frontend always sends a default `language`
 * ('en') even when the user never touched the filter, so it only applies when
 * `language_explicit` is true — the same rule the common search uses for narrowing.
 */
function parseLanguages(raw) {
  if (!flag(raw.language_explicit)) return [];
  // Not list(): its sentinel check is case-insensitive, and "na" is a real ISO-639 code
  // (Nauru). Only the exact transport sentinel "NA" means "not set" here.
  const langList = (val) => (Array.isArray(val) ? val : (val == null ? [] : String(val).split(',')))
    .map((v) => String(v ?? '').trim())
    .filter((v) => v && v !== 'NA');
  const out = new Set();
  for (const value of [...langList(raw.lang), ...langList(raw.language)]) {
    if (value.toLowerCase() === 'un') continue; // legacy "unknown" companion value
    out.add(value);
    if (/^[a-z]{2,3}(-[a-z]{2})?$/i.test(value)) {
      let name = LANGUAGE_NAME_OVERRIDES[value.toLowerCase()] || null;
      if (!name) {
        try { name = languageNames.of(value); } catch { name = null; }
      }
      if (name && name.toLowerCase() !== value.toLowerCase()) out.add(name);
    }
  }
  return [...out];
}

/**
 * Countries for the ChatGPT index, which stores resolved country NAMES ("India").
 * Accepts the dashboard's shared Country filter (`country`, ISO codes like "IN") and an
 * optional ChatGPT-specific `chatgpt_country` (names). ISO codes are expanded to their
 * English name; the raw value is kept too, so a name-valued input still matches.
 */
function parseCountries(raw) {
  const out = new Set();
  for (const value of [...list(raw.country), ...list(raw.chatgpt_country)]) {
    out.add(value);
    if (/^[a-z]{2}$/i.test(value)) {
      const name = getCountryName(value.toUpperCase());
      if (name && name.toUpperCase() !== value.toUpperCase()) out.add(name);
    }
  }
  return [...out];
}

function isSet(val) {
  if (val === undefined || val === null || val === '' || val === false) return false;
  if (typeof val === 'string' && val.trim().toUpperCase() === 'NA') return false;
  if (Array.isArray(val)) return val.some(isSet);
  return true;
}

function text(val) {
  return isSet(val) && typeof val !== 'object' ? String(val).trim() : '';
}

/** Scalar / array / comma-separated string → clean string array. */
function list(val) {
  if (!isSet(val)) return [];
  const arr = Array.isArray(val) ? val : String(val).split(',');
  return arr.map((v) => String(v ?? '').trim()).filter((v) => v && v.toUpperCase() !== 'NA');
}

function flag(val) {
  return val === true || val === 1 || val === '1' || val === 'true';
}

/** Legacy pair shape used by every network: [upper(end), lower(start)] epoch SECONDS. */
function parseDatePair(val) {
  if (!Array.isArray(val) || val.length !== 2) return null;
  const upper = Number(val[0]);
  const lower = Number(val[1]);
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) return null;
  return { gte: Math.min(lower, upper), lte: Math.max(lower, upper) };
}

function parsePagination(p) {
  const size = Math.min(Math.max(parseInt(p.take, 10) || parseInt(p.page_size, 10) || 20, 1), 100);
  const page = Math.max(parseInt(p.skip, 10) || parseInt(p.page, 10) || 0, 0);
  return { size, from: size * page };
}

/**
 * Sort: newest (default) | most seen | longest running.
 * Accepts the shared *_sort flags and order_column values buildSearchPayload sends.
 */
function parseSort(p) {
  const order = String(p.order_by || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const column = String(p.order_column || '').trim().toLowerCase();
  const running = String(p.running_longest_sort || '').toLowerCase();

  if (p.hits_sort === 'hits_sort' || column === 'hits' || column === 'most_seen') {
    return { key: 'most_seen', order };
  }
  if (running === 'running_longest_sort' || running === 'asc' || column === 'days_running') {
    return { key: 'longest_running', order: running === 'asc' ? 'asc' : order };
  }
  if (p.last_seen_sort === 'LastSeen_sort' || column === 'lastseen' || column === 'last_seen') {
    return { key: 'last_seen', order };
  }
  return { key: 'newest', order };
}

/** Normalised ChatGPT search spec from a raw request body/query. */
function parseSearchParams(raw = {}) {
  return {
    keyword: text(raw.keyword),
    advertiser: text(raw.advertiser),
    domain: text(raw.domain),
    exactSearch: flag(raw.exact_search),
    advertisers: list(raw.chatgpt_advertiser),
    countries: parseCountries(raw),
    types: list(raw.type),
    languages: parseLanguages(raw),
    adPositions: list(raw.ad_position ?? raw.ad_position_filter),
    marketPlatforms: list(raw.market_platform ?? raw.marketing_platform_filter ?? raw.marketingPlatform),
    // Saved / Hidden pages (SavedAdsPage sends favorite / hidden = 'true')
    favorite: flag(raw.favorite),
    hidden: flag(raw.hidden),
    userId: raw.user_id != null && String(raw.user_id).trim() !== '' ? String(raw.user_id).trim() : null,
    firstSeen: parseDatePair(raw.first_seen_btn_sort),
    lastSeen: parseDatePair(raw.seen_btn_sort),
    sort: parseSort(raw),
    ...parsePagination(raw),
  };
}

/** NAS path → browser URL via the shared NAS resolver; DefaultImage placeholders → ''. */
function mediaUrl(path) {
  if (!path || typeof path !== 'string') return '';
  if (path.includes('DefaultImage')) return '';
  return resolveMediaUrl(path.trim()) || '';
}

function parseJsonArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim().startsWith('[')) {
    try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

module.exports = {
  isSet,
  list,
  parseDatePair,
  parsePagination,
  parseSort,
  parseSearchParams,
  mediaUrl,
  parseJsonArray,
};

'use strict';

/** Shared tiny utilities for the insertion pipelines (date/number formatting). */

/** 'YYYY-MM-DD HH:MM:SS' in UTC (MySQL datetime). */
function nowDateTime() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** 'YYYY-MM-DD' in UTC (MySQL date). */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Epoch (seconds; tolerates ms) -> 'YYYY-MM-DD HH:MM:SS'. */
function epochToDateTime(epoch) {
  let n = parseInt(epoch, 10);
  if (!Number.isFinite(n)) return nowDateTime();
  if (String(Math.trunc(n)).length > 10) n = Math.trunc(n / 1000);
  return new Date(n * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function ensureUtf8mb3Compatible(str) {
  if (!str || typeof str !== 'string') return str;
  return [...str].filter(char => char.codePointAt(0) <= 0xFFFF).join('');
}

/**
 * Multibyte-safe truncation to at most `max` characters (not bytes). Uses code-point
 * iteration so astral/emoji chars are not split, matching ensureUtf8mb3Compatible.
 * Non-string / nullish values pass through unchanged so the caller's `?? null` still applies.
 */
function truncateChars(value, max) {
  if (typeof value !== 'string') return value;
  const chars = [...value];
  return chars.length > max ? chars.slice(0, max).join('') : value;
}

/**
 * Strip code points outside latin1 (> U+00FF) so a value can bind to a latin1 column
 * (the URL/image-path columns, e.g. *_ad_variants.image_url_original) without mysql2 throwing
 * 'Conversion from collation utf8mb4_unicode_ci into latin1_swedish_ci impossible for parameter'.
 * URLs/paths are ASCII anyway, so the only casualties are rare malformed 4-byte chars. Non-string
 * / nullish values pass through unchanged.
 */
function latin1Safe(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[^\x00-\xFF]/g, '');
}

/**
 * latin1-bind a URL while PRESERVING it. The `*_ad_meta_data.destination_url` /
 * `initial_url` columns are latin1, but they carry real destination URLs whose query
 * params can legitimately contain CJK/emoji (e.g. `utm_term=现货`). After normalize()
 * urldecodes the field, those code points become a utf8mb4 JS string that mysql2 can't
 * bind to the latin1 column → 'Conversion from collation utf8mb4_unicode_ci into
 * latin1_swedish_ci impossible for parameter', which rolls the whole insert back and
 * silently drops the ad.
 *
 * Unlike latin1Safe (which STRIPS — fine for image-path columns), this percent-encodes
 * only the out-of-latin1 code points, so the stored value is pure ASCII (binds cleanly)
 * AND remains a valid, fully-recoverable URL. ASCII URLs pass through untouched.
 * Non-string / nullish values pass through unchanged.
 */
function latin1SafeUrl(value) {
  if (typeof value !== 'string') return value;
  let out = '';
  for (const ch of value) { // iterate by code point so astral chars (emoji) aren't split
    if (ch.codePointAt(0) <= 0xFF) out += ch;
    else { try { out += encodeURIComponent(ch); } catch { /* drop unencodable surrogate */ } }
  }
  return out;
}

/** The latin1 URL columns on the `*_ad_meta_data` tables (and instagram_ad_analytics).
 *  ad_url / meta_ad_url are the ad landing/library URLs — same CJK/emoji-in-query-param risk as
 *  destination_url; insertMetaData writes them raw, so omitting them threw the collation-500 that
 *  was the #1 facebook insert-reject (2026-07-01). */
const LATIN1_URL_COLS = ['destination_url', 'initial_url', 'ad_url', 'meta_ad_url'];

/**
 * In-place latin1SafeUrl the known latin1 URL columns of an insert/update payload, so
 * the meta-data INSERT (inside the txn → would lose the ad) can't throw the collation
 * error on a CJK/emoji destination URL. Returns the same object for chaining.
 */
function latin1SafeUrlCols(obj, cols = LATIN1_URL_COLS) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const k of cols) {
    if (typeof obj[k] === 'string') obj[k] = latin1SafeUrl(obj[k]);
  }
  return obj;
}

/**
 * The latin1-charset columns on every network's `*_ad_variants` table. These are all
 * image / URL / path / size columns — binding a utf8mb4 param (emoji/CJK/accented char)
 * into one of them makes mysql2 throw the collation error and the whole insert rolls back,
 * silently dropping the ad. The text columns (title/text/newsfeed_description) are utf8mb4
 * and are intentionally NOT in this list so real emoji/CJK ad copy is preserved.
 */
const LATIN1_VARIANT_COLS = [
  'image_url_original', 'image_url', 'old_image_url',
  'image_object', 'image_celebrity', 'image_brand_logo', 'ad_image_size',
];

/**
 * In-place latin1-sanitize the known latin1 `*_ad_variants` columns of an insert/update
 * payload object, so neither the INSERT (inside the txn → would lose the ad) nor the
 * post-commit UPDATE (would silently drop the image URL) can throw the collation error.
 * Only the columns in LATIN1_VARIANT_COLS are touched. Returns the same object for chaining.
 */
function latin1SafeCols(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const k of LATIN1_VARIANT_COLS) {
    if (typeof obj[k] === 'string') obj[k] = latin1Safe(obj[k]);
  }
  return obj;
}

/** Treat string "null"/"NULL" and empty string as actual null. */
function isNullLike(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' || t.toLowerCase() === 'null';
  }
  return false;
}

/** Convert null-like scalars to null; pass everything else through. */
function normalizeNullLike(v) {
  return isNullLike(v) ? null : v;
}

/**
 * Recursively sanitize an insertion payload:
 *  - scalar "null" / "" → null
 *  - arrays have null-like entries removed (but the array key stays)
 *  - objects are traversed recursively.
 */
function sanitizePayload(v) {
  if (Array.isArray(v)) {
    return v.map(sanitizePayload).filter((x) => !isNullLike(x));
  }
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = sanitizePayload(val);
    }
    return out;
  }
  return normalizeNullLike(v);
}

module.exports = {
  nowDateTime, today, epochToDateTime, toInt, ensureUtf8mb3Compatible, truncateChars,
  latin1Safe, latin1SafeCols, latin1SafeUrl, latin1SafeUrlCols, isNullLike, normalizeNullLike, sanitizePayload,
};

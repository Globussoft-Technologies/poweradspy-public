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

module.exports = { nowDateTime, today, epochToDateTime, toInt, ensureUtf8mb3Compatible, truncateChars, latin1Safe };

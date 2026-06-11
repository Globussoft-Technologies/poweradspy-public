'use strict';

/**
 * GTEXT (Google Text) — Elasticsearch document builder (FLAT keys, index google_ads_data).
 *
 * Faithful port of GoogleTextAdController::setParamsO() for the "O" path:
 *   - flat keys (no `<net>_ad.` prefix, no |langs fan-out),
 *   - `target_keyword` → array (split on `|`, lower-cased),
 *   - date sentinel 0000-00-00 → 0001-01-01,
 *   - searchID = ES `match { id: <internal id> }`.
 */

const { ES_INDEX } = require('./esColumns');

const DATE_SENTINEL_IN = '0000-00-00 00:00:00';
const DATE_SENTINEL_OUT = '0001-01-01 01:01:01';

function formatDateTime(d) {
  if (Number.isNaN(d.getTime())) return DATE_SENTINEL_OUT;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function sentinel(v) {
  if (v === DATE_SENTINEL_IN) return DATE_SENTINEL_OUT;
  if (v instanceof Date) return formatDateTime(v);
  return v;
}

// google_ads_data date fields → coerced to yyyy-MM-dd HH:mm:ss; domain_registered_date = yyyy-MM-dd.
const ES_DATE_FIELDS = {
  post_date: 'datetime', last_seen: 'datetime', first_seen: 'datetime',
  firstSeenOnDesktop: 'datetime', firstSeenOnAndroid: 'datetime', firstSeenOnIos: 'datetime',
  domain_registered_date: 'date',
};
function coerceEsDate(v, kind) {
  if (v === null || v === undefined || v === '') return null;
  let s = v instanceof Date ? (Number.isNaN(v.getTime()) ? null : formatDateTime(v)) : String(v);
  if (s === null) return null;
  s = s.replace('T', ' ');
  if (s.startsWith('0000-00-00')) return kind === 'date' ? '0001-01-01' : '0001-01-01 01:01:01';
  if (/^\d+$/.test(s)) return null;
  return kind === 'date' ? s.slice(0, 10) : s.slice(0, 19);
}

/** PHP: target_keyword → explode('|', mb_strtolower(val)) → array. */
function keywordArray(v) {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return v;
  return String(v).toLowerCase().split('|').map((x) => x.trim()).filter((x) => x.length);
}

/**
 * Build the flat google_ads_data doc from an in-memory data object.
 * @param {string[]} columns - META_INSERT_COLUMNS
 * @param {Object} data      - flat field map (the $gtss equivalent)
 * @param {Object} [opts.extra] - extras merged last (image_url_original, post_owner_image, new_nas_image_url, image_video_url)
 * @returns {{index, type, body}}
 */
function buildDoc(columns, data, opts = {}) {
  const body = {};
  for (const col of columns) {
    let val = data[col];
    if (col === 'target_keyword') val = keywordArray(val);
    body[col] = ES_DATE_FIELDS[col] ? coerceEsDate(val, ES_DATE_FIELDS[col]) : sentinel(val);
  }
  if (opts.extra) Object.assign(body, opts.extra);
  return { index: ES_INDEX, type: 'doc', body };
}

/** ES query to find a doc's _id by the flat `id` field (PHP match { id }). */
function searchIdQuery(index, internalId) {
  return { index, type: 'doc', body: { query: { match: { id: internalId } } } };
}

function firstHitId(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._id : null;
}
function firstHitSource(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._source : null;
}

module.exports = { buildDoc, searchIdQuery, firstHitId, firstHitSource, keywordArray, sentinel, ES_INDEX };

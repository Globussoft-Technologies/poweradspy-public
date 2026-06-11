'use strict';

/**
 * Instagram insertion — Elasticsearch document builder (instagram_search_mix).
 * Same logic as the Facebook builder; only the date-field map, synthetic
 * user-countries token, searchID term, and carry-over keys use `instagram_*`.
 */

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

// ES `date` fields in instagram_search_mix and their mapped formats (verified via mapping).
// 'datetime' = yyyy-MM-dd HH:mm:ss, 'date' = yyyy-MM-dd, 'iso' = yyyy-MM-ddTHH:mm:ss
// (the ES "default"/strict_date_optional_time format, e.g. instagram_ad.created_date).
const ES_DATE_FIELDS = {
  'instagram_ad.post_date': 'datetime',
  'instagram_ad.last_seen': 'datetime',
  'instagram_ad.created_date': 'iso',
  'instagram_ad_meta_data.firstSeenOnDesktop': 'datetime',
  'instagram_ad_meta_data.firstSeenOnAndroid': 'datetime',
  'instagram_ad_meta_data.firstSeenOnIos': 'datetime',
  'instagram_ad_domain.domain_registered_date': 'date',
};

function coerceEsDate(v, kind) {
  if (v === null || v === undefined || v === '') return null;
  let s = v instanceof Date ? (Number.isNaN(v.getTime()) ? null : formatDateTime(v)) : String(v);
  if (s === null) return null;
  s = s.replace('T', ' ');
  if (s.startsWith('0000-00-00')) return kind === 'date' ? '0001-01-01' : (kind === 'iso' ? '0001-01-01T01:01:01' : '0001-01-01 01:01:01');
  if (/^\d+$/.test(s)) return null;
  if (kind === 'date') return s.slice(0, 10);
  if (kind === 'iso') return s.slice(0, 19).replace(' ', 'T');
  return s.slice(0, 19);
}

/**
 * Build the instagram_search_mix document from a denormalized join row.
 * @param {string[]} columns
 * @param {Object} row
 * @param {Object} [opts] - { index, userCountries, adCountries, extra }
 */
function buildSearchMixDoc(columns, row, opts = {}) {
  const index = (opts.index || 'instagram_search_mix').toLowerCase();
  const userCountries = opts.userCountries || [];
  const adCountries = opts.adCountries || [];
  const body = {};

  for (const rawCol of columns) {
    let key = rawCol;
    let val;

    const dot = rawCol.indexOf('.');
    if (dot === -1) {
      if (rawCol === 'html') {
        val = `${str(row.title)} ${str(row.text)} ${str(row.newsfeed_description)}`;
      } else if (rawCol === 'mixdata') {
        val = `${str(row.title)} ${str(row.text)} ${str(row.newsfeed_description)} ${str(row.comment_data)}`;
      } else if (rawCol === 'comment_data') {
        val = safeJson(row.comment_data);
      } else if (rawCol === 'lang_detect') {
        val = (row.iso || '').toLowerCase();
      } else if (rawCol === 'instagram_user_countries') {
        val = userCountries;
      } else {
        val = row[rawCol];
      }
    } else {
      const table = rawCol.slice(0, dot);
      const fieldSpec = rawCol.slice(dot + 1);
      const pipe = fieldSpec.indexOf('|');

      if (pipe === -1) {
        const field = fieldSpec;
        val = field === 'country' ? adCountries : row[field];
        key = rawCol;
      } else {
        const field = fieldSpec.slice(0, pipe);
        const langs = fieldSpec.slice(pipe + 1).split(',');
        val = field === 'country' ? adCountries : row[field];
        key = `${table}.${field}`;
        for (const lang of langs) body[`${key}_${lang}`] = sentinel(val);
      }
    }

    body[key] = ES_DATE_FIELDS[key] ? coerceEsDate(val, ES_DATE_FIELDS[key]) : sentinel(val);
  }

  if (opts.extra) Object.assign(body, opts.extra);
  return { index, type: 'doc', body };
}

/** ES query to find a doc's _id by instagram_ad.id. */
function searchIdQuery(index, adInternalId) {
  return { index, type: 'doc', body: { query: { term: { 'instagram_ad.id': adInternalId } } } };
}

function firstHitId(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._id : null;
}

// ES-only fields populated by other processes — carried over on UPDATE re-index.
const CARRY_OVER_KEYS = [
  'instagram_ad_outgoing_links.source_url',
  'instagram_ad_outgoing_links.redirect_url',
  'instagram_ad_outgoing_links.final_url',
  'instagram_ad_url.url_redirects',
  'instagram_ad_url.url_destination',
  'instagram_ad_url.country_code',
  'nas_video_url',
  'new_nas_image_url',
];

function extractCarryOver(esResponse, translationField) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  const src = hits && hits[0] ? hits[0]._source : null;
  if (!src) return {};
  const out = {};
  for (const k of CARRY_OVER_KEYS) if (src[k] != null) out[k] = src[k];
  if (translationField) {
    for (const lang of ['ar', 'pt', 'fr']) {
      const k = `${translationField}.${lang}`;
      if (src[k] != null) out[k] = src[k];
    }
  }
  return out;
}

function str(v) { return v === undefined || v === null ? '' : String(v); }
function safeJson(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return v ?? null; }
}

module.exports = { buildSearchMixDoc, searchIdQuery, firstHitId, extractCarryOver, sentinel };

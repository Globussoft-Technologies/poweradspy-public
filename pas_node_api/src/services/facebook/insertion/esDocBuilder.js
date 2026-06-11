'use strict';

/**
 * Facebook insertion — Elasticsearch document builder.
 *
 * Faithful port of PHP setParams() / setNewParams() / searchID()
 * (see docs/insertion/PHP-SPEC-internals.md §D). Pure: SQL-derived synthetic
 * arrays (facebook_user_countries, .country override) are fetched by the caller
 * (queries module) and injected via `opts`.
 *
 * The `columns` template uses entries like:
 *   "facebook_ad.id"                              → body["facebook_ad.id"]   = row.id
 *   "facebook_ad_variants.title|ru,fr,sp,ge"      → body["...title_ru"]=…+ body["...title"]=row.title
 *   "html" | "mixdata" | "comment_data" | "lang_detect" | "facebook_user_countries"  → synthetic
 */

const DATE_SENTINEL_IN = '0000-00-00 00:00:00';
const DATE_SENTINEL_OUT = '0001-01-01 01:01:01';

// The ES `search_mix` date fields use the explicit format `yyyy-MM-dd HH:mm:ss`
// (space, no 'T', no millis). mysql2 returns DATETIME columns as JS Date objects,
// which JSON-serialize to ISO8601 and would FAIL that mapping — so we format any
// Date back to the exact `yyyy-MM-dd HH:mm:ss` literal. Strings already in that
// form pass through unchanged.
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

// The exact ES `date` fields in search_mix and their mapped formats (verified
// against the live mapping). Each value is coerced to its field's format so the
// `date` mapper never rejects it. 'datetime' = yyyy-MM-dd HH:mm:ss, 'date' = yyyy-MM-dd.
const ES_DATE_FIELDS = {
  'facebook_ad.post_date': 'datetime',
  'facebook_ad.last_seen': 'datetime',
  'facebook_ad_meta_data.firstSeenOnDesktop': 'datetime',
  'facebook_ad_meta_data.firstSeenOnAndroid': 'datetime',
  'facebook_ad_meta_data.firstSeenOnIos': 'datetime',
  'facebook_ad_post_owners.page_created_date': 'datetime',
  'facebook_ad_domains.domain_registered_date': 'date',
};

/**
 * Coerce a value to the exact format an ES date field expects, or null when it is
 * empty/zero/invalid (ES safely ignores null instead of throwing a parse error).
 */
function coerceEsDate(v, kind) {
  if (v === null || v === undefined || v === '') return null;
  let s = v instanceof Date ? (Number.isNaN(v.getTime()) ? null : formatDateTime(v)) : String(v);
  if (s === null) return null;
  s = s.replace('T', ' ');                       // normalize any ISO form
  if (s.startsWith('0000-00-00')) return kind === 'date' ? '0001-01-01' : '0001-01-01 01:01:01';
  if (/^\d+$/.test(s)) return null;              // bare epoch can't match an explicit format → skip
  return kind === 'date' ? s.slice(0, 10) : s.slice(0, 19);
}

/**
 * Build the primary `search_mix` document from a denormalized join row.
 *
 * @param {string[]} columns  - currentTableColumns template (ordered).
 * @param {Object}   row      - flat join row (props named by FIELD only).
 * @param {Object}   [opts]
 * @param {string}   [opts.index='search_mix']
 * @param {string[]} [opts.userCountries=[]] - GROUP_CONCAT(country_only.country) for facebook_user_countries.
 * @param {string[]} [opts.adCountries=[]]   - country list for the `.country` override.
 * @param {Object}   [opts.extra={}]         - extra body fields merged last (Thumbnail, lang_detect, s3_path, etc.).
 * @returns {{index:string, type:string, body:Object}}
 */
function buildSearchMixDoc(columns, row, opts = {}) {
  const index = (opts.index || 'search_mix').toLowerCase();
  const userCountries = opts.userCountries || [];
  const adCountries = opts.adCountries || [];
  const body = {};

  for (const rawCol of columns) {
    let key = rawCol;
    let val;

    const dot = rawCol.indexOf('.');
    if (dot === -1) {
      // synthetic / single-token
      if (rawCol === 'html') {
        val = `${str(row.title)} ${str(row.text)} ${str(row.newsfeed_description)}`;
      } else if (rawCol === 'mixdata') {
        val = `${str(row.title)} ${str(row.text)} ${str(row.newsfeed_description)} ${str(row.comment_data)}`;
      } else if (rawCol === 'comment_data') {
        val = safeJson(row.comment_data);
      } else if (rawCol === 'lang_detect') {
        val = (row.iso || '').toLowerCase();
      } else if (rawCol === 'facebook_user_countries') {
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
        // language fan-out: same value copied to each suffix (no real translation)
        for (const lang of langs) body[`${key}_${lang}`] = sentinel(val);
      }
    }

    body[key] = ES_DATE_FIELDS[key] ? coerceEsDate(val, ES_DATE_FIELDS[key]) : sentinel(val);
  }

  // Caller-supplied extra fields (Thumbnail, impression, s3_path, etc.) win.
  if (opts.extra) Object.assign(body, opts.extra);

  return { index, type: 'doc', body };
}

/**
 * Build the secondary `facebook_ad` document — plain copy of an attributes object
 * with the date sentinel applied (PHP setNewParams active path).
 */
function buildFacebookAdDoc(attrs, index = 'facebook_ad') {
  const body = {};
  for (const [k, v] of Object.entries(attrs || {})) body[k] = sentinel(v);
  return { index: index.toLowerCase(), type: 'doc', body };
}

/**
 * ES query body to find a doc's _id by facebook_ad.id (PHP searchID).
 * Returns the query params; the caller runs db.elastic.search and reads hits.
 */
function searchIdQuery(index, adInternalId) {
  return {
    index,
    type: 'doc',
    body: { query: { term: { 'facebook_ad.id': adInternalId } } },
  };
}

/** Extract _id from an ES search response (guarded). */
function firstHitId(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._id : null;
}

// Fields populated by OTHER processes (outgoing-link resolver, translation cron) that
// live only in ES — must be carried over from the old doc on UPDATE re-index (PHP behaviour).
const CARRY_OVER_KEYS = [
  'facebook_ad_outgoing_links.source_url',
  'facebook_ad_outgoing_links.redirect_url',
  'facebook_ad_outgoing_links.final_url',
  'facebook_ad_url.url_redirects',
  'facebook_ad_url.url_destination',
  'facebook_ad_url.country_code',
  'nas_video_url',
];

/**
 * Pull the carry-over fields (+ <translationField>.ar/.pt/.fr) from an existing ES
 * search response so they survive the UPDATE delete+reindex.
 */
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

module.exports = { buildSearchMixDoc, buildFacebookAdDoc, searchIdQuery, firstHitId, extractCarryOver, sentinel };

'use strict';

/**
 * Quora insertion — Elasticsearch document builder.
 * Mirrors the Facebook/Instagram pattern with quora_* prefixes.
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

const ES_DATE_FIELDS = {
  'quora_ad.post_date': 'datetime',
  'quora_ad.last_seen': 'datetime',
  'quora_ad_post_owners.page_created_date': 'datetime',
  'quora_ad_domains.domain_registered_date': 'date',
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

function str(v) {
  return v ? String(v).trim() : '';
}

function safeJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function buildSearchMixDoc(columns, row, opts = {}) {
  const index = (opts.index || 'quora_search_mix').toLowerCase();
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
        val = `${str(row.title)} ${str(row.text)} ${str(row.newsfeed_description)}`;
      } else if (rawCol === 'quora_user_countries') {
        val = userCountries;
      } else {
        val = row[rawCol];
      }
    } else {
      // dotted: table.field
      const [table, field] = rawCol.split('.', 2);
      const fieldName = field.toLowerCase();

      // Extract from row by field name (should be aliased)
      val = row[fieldName];

      // Apply ES coercion for date fields
      if (ES_DATE_FIELDS[rawCol]) {
        val = coerceEsDate(val, ES_DATE_FIELDS[rawCol]);
      }

      // Build the ES key: table.field (e.g., quora_ad_variants.title)
      // Rename fields for frontend compatibility
      if (rawCol === 'quora_ad_variants.image_url') {
        key = 'new_nas_image_url';
      } else if (rawCol === 'quora_ad_image_video.ad_image_video') {
        key = 'thumbnail';
      } else {
        key = rawCol;
      }
    }

    // Assign the value (sentinel for sentinel dates)
    if (val instanceof Date) {
      body[key] = sentinel(val);
    } else {
      body[key] = val;
    }
  }

  // Add adCountries override
  if (adCountries && adCountries.length) {
    body.country = adCountries;
  }

  // Caller-supplied extra fields (lang_detect, call_to_action, destination_url, country/city/state,
  // platform, category, ages, firstSeenOn*, …) merged LAST so they win over the SQL-derived columns.
  // Mirrors the PHP pipeline, which set several fields directly on the ES body rather than via the join.
  if (opts.extra && typeof opts.extra === 'object') {
    Object.assign(body, opts.extra);
  }

  return {
    index,
    type: '_doc',
    body,
  };
}

function searchIdQuery(adId) {
  return { term: { 'quora_ad.id': adId } };
}

function firstHitId(hits) {
  return hits && hits.length ? hits[0]._source?.['quora_ad.id'] : null;
}

function extractCarryOver(source) {
  const CARRY_OVER_KEYS = [
    'quora_ad_id',
    'quora_ad_status',
    'quora_ad_hits',
    'quora_ad_discovered_user_id',
    'quora_ad_post_date',
    'quora_ad_last_seen',
    'quora_ad_lower_age',
    'quora_ad_days_running',
    'quora_ad_likes',
    'quora_ad_comments',
    'quora_ad_shares',
    'quora_ad_created_date',
    'quora_ad_platform',
    'quora_ad_type',
    'quora_user_countries',
  ];
  const carry = {};
  for (const key of CARRY_OVER_KEYS) {
    if (key in source) carry[key] = source[key];
  }
  return carry;
}

module.exports = {
  buildSearchMixDoc,
  searchIdQuery,
  firstHitId,
  extractCarryOver,
  coerceEsDate,
  ES_DATE_FIELDS,
};

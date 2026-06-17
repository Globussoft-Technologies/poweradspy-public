'use strict';

/**
 * GDN insertion — Elasticsearch document builder.
 *
 * Faithful port of PHP GdnAdController::setParams() / searchID() for gdn_search_mix
 * (see ../../../../PHP-SPEC-gdn.md §3.1). Mirrors Facebook's esDocBuilder but with
 * GDN specifics:
 *   - searchId by `gdn_ad.id`
 *   - synthetic `height` / `width` from gdn_ad_variants.ad_image_size ("width*height")
 *   - no html/mixdata/facebook_user_countries synthetics
 *   - gdn_search_mix date-field formats
 *
 * The `columns` template (esColumns.META_INSERT_COLUMNS) drives the body; entries
 * like "gdn_ad_variants.title|ru,fr,sp,ge,exactly" fan the value out to _ru/_fr/…
 * suffixes (no real translation — same as PHP).
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

// ES `date` fields in gdn_search_mix and their mapped formats (MANIFEST §9.6).
const ES_DATE_FIELDS = {
  'gdn_ad.post_date': 'datetime',
  'gdn_ad.last_seen': 'datetime',
  'gdn_ad_meta_data.firstSeenOnDesktop': 'datetime',
  'gdn_ad_domains.domain_registered_date': 'date',
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

/** Split "width*height" → {width, height} ints (PHP setParams height/width). */
function sizeToWH(adImageSize) {
  if (!adImageSize) return { width: 0, height: 0 };
  const parts = String(adImageSize).split('*');
  return { width: parseInt(parts[0], 10) || 0, height: parseInt(parts[1], 10) || 0 };
}

/**
 * Build the gdn_search_mix document from a denormalized join row.
 *
 * @param {string[]} columns  - META_INSERT_COLUMNS (ordered).
 * @param {Object}   row      - flat join row (props named by FIELD only — see repository.getJoinedAd).
 * @param {Object}   [opts]
 * @param {string}   [opts.index='gdn_search_mix']
 * @param {Object}   [opts.extra={}] - extra body fields merged last (lang_detect, states, city, image_url, new_nas_image_url, platform, image_url_original).
 * @returns {{index:string, type:string, body:Object}}
 */
function buildSearchMixDoc(columns, row, opts = {}) {
  const index = (opts.index || 'gdn_search_mix_v2').toLowerCase();
  const body = {};
  const wh = sizeToWH(row.ad_image_size);

  for (const rawCol of columns) {
    let key = rawCol;
    let val;

    const dot = rawCol.indexOf('.');
    if (dot === -1) {
      // synthetic / single-token
      if (rawCol === 'height') val = wh.height;
      else if (rawCol === 'width') val = wh.width;
      else val = row[rawCol];
    } else {
      const table = rawCol.slice(0, dot);
      const fieldSpec = rawCol.slice(dot + 1);
      const pipe = fieldSpec.indexOf('|');

      if (pipe === -1) {
        val = row[fieldSpec];
        key = rawCol;
      } else {
        const field = fieldSpec.slice(0, pipe);
        const langs = fieldSpec.slice(pipe + 1).split(',');
        val = row[field];
        key = `${table}.${field}`;
        for (const lang of langs) body[`${key}_${lang}`] = sentinel(val);
      }
    }

    body[key] = ES_DATE_FIELDS[key] ? coerceEsDate(val, ES_DATE_FIELDS[key]) : sentinel(val);
  }

  // Caller-supplied extras (lang_detect, states, city, image_url, new_nas_image_url, platform, …) win.
  if (opts.extra) Object.assign(body, opts.extra);

  return { index, type: 'doc', body };
}

/** ES query body to find a doc's _id by gdn_ad.id (PHP searchID). */
function searchIdQuery(index, adInternalId) {
  return {
    index,
    type: 'doc',
    body: { query: { term: { 'gdn_ad.id': adInternalId } } },
  };
}

/** Extract _id from an ES search response (guarded). */
function firstHitId(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._id : null;
}

/** Extract _source from an ES search response (guarded). */
function firstHitSource(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._source : null;
}

module.exports = { buildSearchMixDoc, searchIdQuery, firstHitId, firstHitSource, sizeToWH, sentinel };

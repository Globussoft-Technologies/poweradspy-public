'use strict';

/**
 * Native insertion — Elasticsearch document builder.
 * Adapted from the Facebook esDocBuilder pattern for the native_search_mix index.
 * Handles the column template (with |langs fan-out), sentinel replacement, and date coercion.
 */

const DATE_SENTINEL_IN  = '0000-00-00 00:00:00';
const DATE_SENTINEL_OUT = '0001-01-01 01:01:01';

function formatDateTime(d) {
  if (Number.isNaN(d.getTime())) return DATE_SENTINEL_OUT;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sentinel(v) {
  if (v === DATE_SENTINEL_IN) return DATE_SENTINEL_OUT;
  if (v instanceof Date)       return formatDateTime(v);
  return v;
}

const ES_DATE_FIELDS = {
  'native_ad.post_date':                    'datetime',
  'native_ad.last_seen':                    'datetime',
  'native_ad_meta_data.firstSeenOnDesktop': 'datetime',
  'native_ad_domains.domain_registered_date': 'date',
};

function coerceEsDate(v, kind) {
  if (v === null || v === undefined || v === '') return null;
  let s = v instanceof Date ? (Number.isNaN(v.getTime()) ? null : formatDateTime(v)) : String(v);
  if (s === null) return null;
  s = s.replace('T', ' ');
  if (s.startsWith('0000-00-00')) return kind === 'date' ? '0001-01-01' : DATE_SENTINEL_OUT;
  if (/^\d+$/.test(s)) return null;
  return kind === 'date' ? s.slice(0, 10) : s.slice(0, 19);
}

/**
 * Build the native_search_mix document from a denormalized join row.
 * Follows the PHP setParams() logic faithfully.
 *
 * @param {string[]} columns  - NATIVE_INSERT_COLUMNS template
 * @param {Object}   row      - flat join row from getJoinedAd()
 * @param {Object}   [opts]
 * @param {string}   [opts.index='native_search_mix_v2']
 * @param {Object}   [opts.extra={}]  - extra body fields merged last (nas_url, platform, lang_detect, etc.)
 * @returns {{index:string, type:string, body:Object}}
 */
function buildNativeSearchMixDoc(columns, row, opts = {}) {
  const index = (opts.index || 'native_search_mix_v2').toLowerCase();
  const body  = {};

  for (const rawCol of columns) {
    let key = rawCol;
    let val;

    const dot = rawCol.indexOf('.');
    if (dot === -1) {
      val = row[rawCol];
    } else {
      const table     = rawCol.slice(0, dot);
      const fieldSpec = rawCol.slice(dot + 1);
      const pipe      = fieldSpec.indexOf('|');

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

  if (opts.extra) Object.assign(body, opts.extra);

  return { index, type: 'doc', body };
}

function searchIdQuery(index, adInternalId) {
  return {
    index,
    type: 'doc',
    body: { query: { term: { 'native_ad.id': adInternalId } } },
  };
}

function firstHitId(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._id : null;
}

module.exports = { buildNativeSearchMixDoc, searchIdQuery, firstHitId, sentinel };

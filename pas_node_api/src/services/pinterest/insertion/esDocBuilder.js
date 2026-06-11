'use strict';

/**
 * Pinterest insertion — Elasticsearch document builder for pinterest_search_mix.
 * Mirrors the native esDocBuilder pattern.
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
  'pinterest_ad.post_date':                    'datetime',
  'pinterest_ad.last_seen':                    'datetime',
  'pinterest_ad.first_seen':                   'datetime',
  'pinterest_ad_meta_data.firstSeenOnDesktop': 'datetime',
  'pinterest_ad_domains.domain_registered_date': 'date',
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
 * Build the pinterest_search_mix document from a denormalized join row.
 * target_keyword is split by '|' and lowercased (PHP: explode("|", mb_strtolower($val))).
 */
function buildPinterestSearchMixDoc(columns, row, opts = {}) {
  const index = (opts.index || 'pinterest_search_mix').toLowerCase();
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

        // target_keyword: split by '|' and lowercase (PHP behaviour)
        if (fieldSpec === 'target_keyword' && val != null) {
          val = String(val).toLowerCase().split('|').map((s) => s.trim()).filter(Boolean);
        }
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
    body: { query: { term: { 'pinterest_ad.id': adInternalId } } },
  };
}

function firstHitId(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._id : null;
}

module.exports = { buildPinterestSearchMixDoc, searchIdQuery, firstHitId, sentinel };

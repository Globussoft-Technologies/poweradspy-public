'use strict';

/**
 * ChatGPT Ads — Elasticsearch document builder.
 *
 * Simpler than facebook's esDocBuilder.js on purpose: this network's ES mapping uses FLAT
 * field names (see esColumns.js's header), so there is no "table.field" dotted-key parsing
 * to do — the getJoinedAd row's properties already ARE the final ES field names. What's
 * still needed, and copied from facebook's esDocBuilder.js because it's genuinely
 * network-agnostic logic: date-format coercion (ES `date` fields reject anything not in
 * their mapped format) and the `html` synthetic full-text field.
 */

const DATE_SENTINEL_OUT = '0001-01-01 01:01:01';

function formatDateTime(d) {
  if (Number.isNaN(d.getTime())) return DATE_SENTINEL_OUT;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Matches chatgpt_search_mix.mapping.json's date fields (all 'yyyy-MM-dd HH:mm:ss', same
// convention as every other network's search_mix).
const ES_DATE_FIELDS = { post_date: 'datetime', first_seen: 'datetime', last_seen: 'datetime' };

function coerceEsDate(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = v instanceof Date ? (Number.isNaN(v.getTime()) ? null : formatDateTime(v)) : String(v);
  if (s === null) return null;
  s = s.replace('T', ' ');
  if (s.startsWith('0000-00-00')) return '0001-01-01 01:01:01';
  if (/^\d+$/.test(s)) return null; // bare epoch can't match the explicit format → skip
  return s.slice(0, 19);
}

function str(v) { return v === undefined || v === null ? '' : String(v); }

/**
 * @param {string[]} columns - CHATGPTADS_COLUMNS
 * @param {Object} row - flat getJoinedAd row
 * @param {Object} [opts]
 * @param {string} [opts.index='chatgpt_search_mix']
 * @param {Object} [opts.extra={}] - extra body fields merged last (Thumbnail,
 *   new_nas_image_url, nas_video_url, othermedia, image_url_original, post_owner_image).
 */
function buildChatgptSearchMixDoc(columns, row, opts = {}) {
  const index = (opts.index || 'chatgpt_search_mix').toLowerCase();
  const body = {};

  for (const col of columns) {
    if (col === 'html') {
      body.html = `${str(row.ad_title)} ${str(row.ad_text)} ${str(row.newsfeed_description)}`;
      continue;
    }
    const val = row[col];
    body[col] = ES_DATE_FIELDS[col] ? coerceEsDate(val) : val;
  }

  if (opts.extra) Object.assign(body, opts.extra);
  return { index, type: 'doc', body };
}

// Queries by the INTERNAL numeric id (ES field `id`, mapped `long`, = chatgptads_ad.id) —
// NOT the external `ad_id` string field. Matches facebook's searchIdQuery, which queries
// `facebook_ad.id` (its own internal-id ES field), not `facebook_ad.ad_id`.
function searchIdQuery(index, adInternalId) {
  return { index, type: 'doc', body: { query: { term: { id: Number(adInternalId) } } } };
}

function firstHitId(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._id : null;
}

// Nothing (yet) populates ES-only fields from another process (no outgoing-link resolver /
// translation cron for this network) — kept as an explicit empty list + function (not
// omitted) so a future addition has an obvious place to go, matching facebook's
// CARRY_OVER_KEYS/extractCarryOver shape.
// ecommerce_platform / funnel / affiliate_data are written by the built-with worker
// (controllers/built-withController.js), not by insertion — carried so a re-index keeps them.
// The lander keys below are written by landers/insertHtmlService.js — same reason.
const CARRY_OVER_KEYS = [
  'nas_video_url', 'ecommerce_platform', 'funnel', 'affiliate_data',
  'domain_registered_date', 'outgoing_source_url', 'outgoing_redirect_url', 'outgoing_final_url', 'redirect_url',
];
function extractCarryOver(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  const src = hits && hits[0] ? hits[0]._source : null;
  if (!src) return {};
  const out = {};
  for (const k of CARRY_OVER_KEYS) if (src[k] != null) out[k] = src[k];
  return out;
}

module.exports = { buildChatgptSearchMixDoc, searchIdQuery, firstHitId, extractCarryOver };

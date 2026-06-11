'use strict';

/**
 * LinkedIn — Elasticsearch document builder (FLAT keys, index linkedin_ads_data).
 *
 * Faithful port of adsDataController::setInsertParamsForES (api_linkedin 2809-2911):
 *   - flat keys (no `linkedin_ad.` prefix),
 *   - date fields → UNIX EPOCH INTEGERS (PHP strtotime); domain_registration_date
 *     falls back to '0000000000' when null,
 *   - `reactions` is an object { likes: <n> },
 *   - `||`-delimited fields (image_object/image_celebrity/source) → arrays,
 *   - `countries` → array (split on ','),
 *   - ES _id = internal linkedin_ad.id (addressed directly — no search needed).
 */

const { ES_INDEX } = require('./esColumns');

const EPOCH_FIELDS = new Set(['first_seen', 'last_seen', 'post_date']);

/** value → UNIX epoch seconds (PHP strtotime). Date | 'YYYY-MM-DD HH:MM:SS' | epoch. */
function toEpoch(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 0 : Math.floor(v.getTime() / 1000);
  if (typeof v === 'number') return v > 1e11 ? Math.floor(v / 1000) : Math.floor(v);
  const s = String(v).trim();
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n > 1e11 ? Math.floor(n / 1000) : n; }
  if (s.startsWith('0000-00-00')) return 0;
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** PHP: explode('||', val) when non-empty, else leave as-is/null. */
function splitPipes(v) {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return v;
  const s = String(v);
  return s.includes('||') ? s.split('||').map((x) => x.trim()).filter((x) => x.length) : s;
}

/** Comma-explode into a trimmed, non-empty array (PHP explode(',', ...)). */
function splitCsv(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v;
  return String(v).split(',').map((x) => x.trim()).filter((x) => x.length);
}

/**
 * Build the flat linkedin_ads_data doc from an in-memory data object.
 * @param {string[]} columns - META_INSERT_COLUMNS
 * @param {Object} data      - flat field map
 * @param {Object} [opts.extra] - extras merged last (state, city, duration, Thumbnail,
 *                               new_nas_image_url, ad_image_or_video, impression_low/high…)
 * @returns {{index, type, body}}
 */
function buildDoc(columns, data, opts = {}) {
  const body = {};
  for (const col of columns) {
    let val = data[col];
    if (EPOCH_FIELDS.has(col)) {
      body[col] = toEpoch(val);
    } else if (col === 'domain_registration_date') {
      const e = toEpoch(val);
      body[col] = e || '0000000000';
    } else if (col === 'reactions') {
      body[col] = (val && typeof val === 'object') ? val : { likes: Number(val) || 0 };
    } else if (col === 'countries') {
      body[col] = splitCsv(val);
    } else if (col === 'image_object' || col === 'image_celebrity' || col === 'source') {
      body[col] = splitPipes(val);
    } else {
      body[col] = val === undefined ? null : val;
    }
  }
  if (opts.extra) Object.assign(body, opts.extra);
  return { index: ES_INDEX, type: 'doc', body };
}

module.exports = { buildDoc, toEpoch, splitPipes, splitCsv, ES_INDEX };

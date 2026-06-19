'use strict';

/**
 * YouTube — Elasticsearch document builder (FLAT keys, index youtube_ads_data).
 *
 * Faithful port of YoutubeAdController::setInsertParamsForES (api_youtube ~4258-4344):
 *   - flat keys (no `youtube_ad.` prefix),
 *   - date fields → UNIX EPOCH INTEGERS (PHP strtotime); post_date zero-date → '0000000000',
 *   - `reactions` is an object { likes: <n> },
 *   - countries/states/city/source/image_object/image_celebrity → arrays,
 *   - ES _id = internal youtube_ad.id (addressed directly — no search needed),
 *   - VIDEO/DISCOVERY budget fields are the ONLY DOTTED keys (youtube.lowerBudget …).
 */

const { ES_INDEX } = require('./esColumns');

const EPOCH_FIELDS = new Set(['first_seen', 'last_seen']);
const ZERO_DATE = '0000-00-00 00:00:00';

/** value → UNIX epoch seconds (PHP strtotime). Date | 'YYYY-MM-DD HH:MM:SS' | epoch. */
function toEpoch(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 0 : Math.floor(v.getTime() / 1000);
  if (typeof v === 'number') return v > 1e11 ? Math.floor(v / 1000) : Math.floor(v);
  const s = String(v).trim();
  if (s === ZERO_DATE || s.startsWith('0000-00-00')) return 0;
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n > 1e11 ? Math.floor(n / 1000) : n; }
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** PHP: explode('||', val) when non-empty, else as-is/null. */
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
 * Build the flat youtube_ads_data doc from an in-memory data object.
 * @param {string[]} columns - META_INSERT_COLUMNS
 * @param {Object} data      - flat field map
 * @param {Object} [opts.extra] - extras merged last (new_nas_image_url, budget dotted keys,
 *                               landing_urls, skippable, localization_*)
 * @returns {{index, type, body}}
 */
function buildDoc(columns, data, opts = {}) {
  const body = {};
  for (const col of columns) {
    let val = data[col];
    if (EPOCH_FIELDS.has(col)) {
      body[col] = toEpoch(val);
    } else if (col === 'post_date' || col === 'domain_registration_date') {
      // PHP: strtotime(...) unless the zero-date → literal '0000000000'
      const e = toEpoch(val);
      body[col] = e || '0000000000';
    } else if (col === 'reactions') {
      body[col] = (val && typeof val === 'object') ? val : { likes: Number(val) || 0 };
    } else if (col === 'countries' || col === 'states' || col === 'city') {
      body[col] = splitCsv(val);
    } else if (col === 'source' || col === 'image_object' || col === 'image_celebrity' || col === 'redirect_urls') {
      // redirect_urls: crawler sends the resolved chain as an array (aclk -> hops -> final);
      // splitPipes keeps arrays as-is and splits a legacy "||" string into an array.
      body[col] = splitPipes(val);
    } else {
      body[col] = val === undefined ? null : val;
    }
  }
  if (opts.extra) Object.assign(body, opts.extra);
  return { index: ES_INDEX, type: 'doc', body };
}

module.exports = { buildDoc, toEpoch, splitPipes, splitCsv, ES_INDEX };

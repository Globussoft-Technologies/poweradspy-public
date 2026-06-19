'use strict';

/**
 * Facebook insertion — payload validation.
 *
 * Faithful port of the Laravel Validator::make rules in adsdata() and
 * adsLibraryInsert() (see docs/insertion/PHP-SPEC-*.md §2).
 *
 * A tiny Laravel-style rule engine keeps the rules declarative and easy to edit
 * (one line per field), instead of hand-written if-chains. Returns
 * { code:200 } on success or { code:400, message:[...] } listing every failure
 * (mirrors PHP returning all validator errors).
 */

// ── Rule sets (declarative — edit here, not in code) ──────────────────────────

// adsdata() — POST metaAdsData. Skipped entirely when socionator == 1 (caller decides).
const META_ADS_RULES = {
  type: 'required|in:IMAGE,VIDEO',
  category: 'required|string',
  call_to_action: 'present|string|nullable',
  image_video_url: 'required|url|string',
  ad_position: 'required|string',
  likes: 'required|integer',
  comment: 'required|integer',
  share: 'required|integer',
  other_multimedia: 'present|nullable',
  destination_url: 'present|nullable',
  initial_url: 'nullable',
  ad_title: 'present|string|nullable',
  news_feed_description: 'present|string|nullable',
  ad_text: 'present|string|nullable',
  ad_url: 'present|string|nullable',
  post_owner: 'present|string|nullable',
  post_owner_image: 'present|nullable',
  ad_id: 'required',
  platform: 'required',
  version: 'required',
  post_date: 'present|string|nullable',
  first_seen: 'required|string|nullable',
  last_seen: 'required|string|nullable',
  city: 'present|string|nullable',
  state: 'present|string|nullable',
  country: 'present|array',
};

// adsLibraryInsert() — POST adsLibrary.
const ADS_LIBRARY_RULES = {
  type: 'required|in:IMAGE,VIDEO',
  ad_position: 'required|string',
  other_multimedia: 'present|nullable',
  destination_url: 'present|nullable',
  initial_url: 'nullable',
  ad_title: 'present|string|nullable',
  news_feed_description: 'present|string|nullable',
  ad_text: 'present|string|nullable',
  meta_ad_url: 'present|string|nullable',
  post_owner: 'present|string|nullable',
  post_owner_image: 'present|nullable',
  ad_id: 'required',
  platform: 'required',
  verified: 'required',
  call_to_action: 'present|nullable',
  first_seen: 'required|nullable',
  last_seen: 'required|nullable',
  est_audience_size_low: 'present|nullable',
  est_audience_size_high: 'present|nullable',
  EUT: 'present',
  ad_run_platforms: 'present',
  currency: 'present|nullable',
  impressions_low: 'present|nullable',
  impressions_high: 'present',
  country: 'present|array',
};

// ── Rule engine ───────────────────────────────────────────────────────────────

const { validationError } = require('../../../insertion/helpers/responses');

const isMissing = (v) => v === undefined;
const isEmpty = (v) => v === null || v === '' || (Array.isArray(v) && v.length === 0);

const CHECKS = {
  required: (v, _a, f) =>
    isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null,
  present: (v, _a, f) => (isMissing(v) ? `The ${f} field must be present.` : null),
  array: (v, _a, f) => (!isMissing(v) && v !== null && !Array.isArray(v) ? `The ${f} must be an array.` : null),
  string: (v, _a, f) =>
    !isMissing(v) && v !== null && typeof v !== 'string' ? `The ${f} must be a string.` : null,
  integer: (v, _a, f) =>
    isMissing(v) || !Number.isInteger(Number(v)) || String(v).trim() === '' ? `The ${f} must be an integer.` : null,
  url: (v, _a, f) => (!isMissing(v) && v !== null && !isUrl(v) ? `The ${f} format is invalid.` : null),
  in: (v, arg, f) =>
    !isMissing(v) && v !== null && !arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null,
};

function isUrl(v) {
  try { new URL(String(v)); return true; } catch { return false; }
}

/**
 * Validate `data` against a rule set.
 * @returns {{code:200} | {code:400, message:string[]}}
 */
function validate(data, rules) {
  const errors = [];

  for (const [field, ruleStr] of Object.entries(rules)) {
    const tokens = ruleStr.split('|');
    const value = data[field];

    // `nullable`: if the value is explicitly null, skip type/format checks.
    const nullable = tokens.includes('nullable');
    if (nullable && value === null) continue;

    for (const token of tokens) {
      if (token === 'nullable') continue;
      const [name, arg] = token.split(':');
      const check = CHECKS[name];
      if (!check) continue;
      const err = check(value, arg, field);
      if (err) { errors.push(err); break; } // one error per field (like Laravel default bail-per-field off → but keep concise)
    }
  }

  return errors.length ? validationError(errors) : { code: 200 };
}

const validateMetaAds = (data) => validate(data, META_ADS_RULES);
const validateAdsLibrary = (data) => validate(data, ADS_LIBRARY_RULES);

module.exports = { validate, validateMetaAds, validateAdsLibrary, META_ADS_RULES, ADS_LIBRARY_RULES };

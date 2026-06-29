'use strict';

/**
 * GTEXT (Google Text) insertion — payload validation.
 *
 * Faithful port of the Validator::make rules in GoogleTextAdController::insertAdsFromPluginO()
 * (see ../../../../KT-GTEXT-MIGRATION.md §5). Same tiny rule engine as GDN/Facebook, plus
 * `ip`, and `required_if:type,==,IMAGE` (ad_image is required only for IMAGE ads).
 *
 * Returns { code:200 } on success, or { code:400, errors:[...] } listing every failure.
 */

// ── Rule set (GoogleTextAdController::insertAdsFromPluginO) ────────────────────
const META_ADS_RULES = {
  network: 'required|in:GoogleText',
  type: 'required|in:IMAGE,TEXT,ORGANIC SEARCH',
  post_owner: 'required|string',
  post_owner_image: 'present|string|nullable',
  ad_title: 'present|string|nullable',
  ad_image: 'required_if:type,IMAGE',
  newsfeed_description: 'present|string|nullable',
  platform: 'required|integer',
  destination_url: 'required',
  g_temp_url: 'present|nullable',
  ad_id: 'required|string',
  post_date: 'required|string',
  first_seen: 'required|string',
  last_seen: 'required|string',
  city: 'present|string|nullable',
  state: 'present|string|nullable',
  country: 'required|string',
  ad_position: 'required|string',
  ad_sub_position: 'present|string|nullable',
  ad_number_position: 'present|integer|nullable',
  ad_text: 'present|string|nullable',
  version: 'required|string',
  ip_address: 'present|ip|nullable',
  target_keyword: 'present|string',
  target_page: 'present|integer|nullable',
  source: 'required|string|in:desktop,android,ios',
  ad_ranking: 'present',
};

// ── Rule engine (copied from GDN validate.js + required_if) ───────────────────
const { validationError } = require('../../../insertion/helpers/responses');
const { isNullLike, normalizeNullLike } = require('../../../insertion/helpers/util');

const isMissing = (v) => v === undefined;
const isEmpty = (v) =>
  isNullLike(v) || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '');
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/;

const CHECKS = {
  required: (v, _a, f) => (isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null),
  present: (v, _a, f) => (isMissing(v) ? `The ${f} field must be present.` : null),
  string: (v, _a, f) => (!isMissing(v) && v !== null && typeof v !== 'string' ? `The ${f} must be a string.` : null),
  integer: (v, _a, f) =>
    isMissing(v) || v === null || v === '' ? null : (!Number.isInteger(Number(v)) ? `The ${f} must be an integer.` : null),
  ip: (v, _a, f) => (!isMissing(v) && v !== null && v !== '' && !IP_RE.test(String(v)) ? `The ${f} must be a valid IP address.` : null),
  in: (v, arg, f) => (!isMissing(v) && v !== null && v !== '' && !arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null),
  // required_if:otherField,value — required only when data[otherField] === value
  required_if: (v, arg, f, data) => {
    const [other, val] = String(arg).split(',');
    if (String(data[other]) === val && (isMissing(v) || isEmpty(v))) return `The ${f} field is required when ${other} is ${val}.`;
    return null;
  },
};

function validate(data, rules) {
  const errors = [];
  for (const [field, ruleStr] of Object.entries(rules)) {
    const tokens = ruleStr.split('|');
    let value = data[field];

    // Treat stringified null / empty string as actual null before validation.
    if (Array.isArray(value)) {
      value = value.map(normalizeNullLike).filter((v) => !isNullLike(v));
    } else if (typeof value === 'string') {
      value = normalizeNullLike(value);
    }

    const nullable = tokens.includes('nullable');
    if (nullable && value === null) continue;

    for (const token of tokens) {
      if (token === 'nullable') continue;
      const idx = token.indexOf(':');
      const name = idx === -1 ? token : token.slice(0, idx);
      const arg = idx === -1 ? undefined : token.slice(idx + 1);
      const check = CHECKS[name];
      if (!check) continue;
      const err = check(value, arg, field, data);
      if (err) { errors.push(err); break; }
    }
  }
  return errors.length ? validationError(errors) : { code: 200 };
}

const validateMetaAds = (data) => validate(data, META_ADS_RULES);

module.exports = { validate, validateMetaAds, META_ADS_RULES };

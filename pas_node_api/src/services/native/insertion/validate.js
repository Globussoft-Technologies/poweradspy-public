'use strict';

/**
 * Native insertion — payload validation.
 * Exact port of the Laravel Validator::make rules in NativeAdController::insertAds().
 */

// ── Rule set (matches PHP exactly) ────────────────────────────────────────────
const NATIVE_ADS_RULES = {
  network:              'required|filled|not_in:N/A,NA',
  type:                 'required|in:IMAGE,TEXT',
  post_owner:           'required|not_in:N/A,NA,None',
  post_owner_image:     'present|url|nullable',
  ad_title:             'present|string|nullable',
  newsfeed_description: 'present|string|nullable',
  platform:             'required|integer',
  destination_url:      'required|present',
  ad_id:                'required|string',
  city:                 'present|string|nullable|not_in:N/A,NA',
  state:                'present|string|nullable|not_in:N/A,NA',
  country:              'present|string|not_in:N/A,NA',   // NOT nullable — cannot be empty
  ad_position:          'required|string',
  ad_number_position:   'present|integer|nullable',
  ad_text:              'present|string|nullable',
  version:              'required|string',
  ip_address:           'present|ip',
  source:               'required|string|in:desktop,android,ios',
  target_site:          'required|string',
  image_url_original:   'present|string|nullable',
  placement_url:        'required|string',
  system_id:            'required|string',
};

// ── Rule engine ────────────────────────────────────────────────────────────────

const { validationError } = require('../../../insertion/helpers/responses');
const { isNullLike, normalizeNullLike } = require('../../../insertion/helpers/util');

const isMissing = (v) => v === undefined;
const isEmpty   = (v) =>
  isNullLike(v) || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '');

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
function isValidIp(v) {
  if (typeof v !== 'string') return false;
  return IPV4_RE.test(v) || IPV6_RE.test(v);
}

function isValidUrl(v) {
  try { new URL(String(v)); return true; } catch { return false; }
}

const CHECKS = {
  // field must be present and not empty/null
  required: (v, _a, f) =>
    isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null,

  // field must be present (key must exist in payload)
  present: (v, _a, f) =>
    isMissing(v) ? `The ${f} field must be present.` : null,

  // field must not be empty (non-null, non-empty string) — Laravel `filled`
  filled: (v, _a, f) =>
    !isMissing(v) && isEmpty(v) ? `The ${f} field must not be empty.` : null,

  // field value must not be in the comma-separated blacklist
  not_in: (v, arg, f) => {
    if (isMissing(v) || v === null) return null;
    const blacklist = arg.split(',').map((s) => s.trim());
    return blacklist.includes(String(v).trim())
      ? `The selected ${f} is invalid.`
      : null;
  },

  // field must be one of the allowed values
  in: (v, arg, f) =>
    !isMissing(v) && v !== null && !arg.split(',').includes(String(v))
      ? `The selected ${f} is invalid.`
      : null,

  string: (v, _a, f) =>
    !isMissing(v) && v !== null && typeof v !== 'string'
      ? `The ${f} must be a string.`
      : null,

  integer: (v, _a, f) =>
    !isMissing(v) && v !== null && !Number.isInteger(Number(v))
      ? `The ${f} must be an integer.`
      : null,

  // valid URL
  url: (v, _a, f) =>
    !isMissing(v) && v !== null && !isValidUrl(v)
      ? `The ${f} format is invalid (must be a valid URL).`
      : null,

  // valid IP address (v4 or v6)
  ip: (v, _a, f) =>
    !isMissing(v) && v !== null && v !== '' && !isValidIp(v)
      ? `The ${f} must be a valid IP address.`
      : null,
};

function validate(data, rules) {
  const errors = [];

  for (const [field, ruleStr] of Object.entries(rules)) {
    const tokens  = ruleStr.split('|');
    let value   = data[field];

    // Treat stringified null / empty string as actual null before validation.
    if (Array.isArray(value)) {
      value = value.map(normalizeNullLike).filter((v) => !isNullLike(v));
    } else if (typeof value === 'string') {
      value = normalizeNullLike(value);
    }

    const nullable = tokens.includes('nullable');

    // nullable: skip type/format checks when value is null or empty string (mirrors Laravel behaviour)
    if (nullable && (value === null || value === '')) continue;

    for (const token of tokens) {
      if (token === 'nullable') continue;
      const [name, arg] = token.split(':');
      const check = CHECKS[name];
      if (!check) continue;
      const err = check(value, arg, field);
      if (err) { errors.push(err); break; } // one error per field, like Laravel
    }
  }

  return errors.length ? validationError(errors) : { code: 200 };
}

const validateNativeAds = (data) => validate(data, NATIVE_ADS_RULES);

module.exports = { validate, validateNativeAds, NATIVE_ADS_RULES };

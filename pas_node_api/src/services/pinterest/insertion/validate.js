'use strict';

/**
 * Pinterest insertion — payload validation.
 * Exact port of Validator::make rules in adsController::insertAds().
 */

const PINTEREST_ADS_RULES = {
  post_owner:       'required|string',
  network:          'required|in:Pinterest',
  type:             'required|in:Image,Video,IMAGE,VIDEO,image,video',
  post_owner_image: 'present|nullable',
  ad_title:         'present|string|nullable',
  ad_image:         'present|nullable',
  platform:         'required|integer',
  destination_url:  'required',
  ad_id:            'required|string',
  city:             'present|string|nullable',
  state:            'present|string|nullable',
  country:          'required|string',
  ad_position:      'required|string',
  ad_sub_position:  'string|nullable',
  ad_text:          'present|string|nullable',
  version:          'required|string',
  ip_address:       'present|ip|nullable',
  target_keyword:   'present|string|nullable',
  source:           'required|in:desktop,android,ios',
};

const { validationError } = require('../../../insertion/helpers/responses');
const { isNullLike, normalizeNullLike } = require('../../../insertion/helpers/util');

const isMissing = (v) => v === undefined;
const isEmpty   = (v) =>
  isNullLike(v) || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '');

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
function isValidIp(v) { return typeof v === 'string' && (IPV4_RE.test(v) || IPV6_RE.test(v)); }

const CHECKS = {
  required: (v, _a, f) => (isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null),
  present:  (v, _a, f) => (isMissing(v) ? `The ${f} field must be present.` : null),
  string:   (v, _a, f) => (!isMissing(v) && v !== null && typeof v !== 'string' ? `The ${f} must be a string.` : null),
  integer:  (v, _a, f) => (!isMissing(v) && v !== null && !Number.isInteger(Number(v)) ? `The ${f} must be an integer.` : null),
  in:       (v, arg, f) => (!isMissing(v) && v !== null && !arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null),
  ip:       (v, _a, f) => (!isMissing(v) && v !== null && v !== '' && !isValidIp(v) ? `The ${f} must be a valid IP address.` : null),
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
    if (nullable && (value === null || value === '')) continue;
    for (const token of tokens) {
      if (token === 'nullable') continue;
      const [name, arg] = token.split(':');
      const check = CHECKS[name];
      if (!check) continue;
      const err = check(value, arg, field);
      if (err) { errors.push(err); break; }
    }
  }
  return errors.length ? validationError(errors) : { code: 200 };
}

const validatePinterestAds = (data) => validate(data, PINTEREST_ADS_RULES);

module.exports = { validate, validatePinterestAds, PINTEREST_ADS_RULES };

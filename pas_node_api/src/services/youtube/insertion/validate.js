'use strict';

/**
 * YouTube (ytAdsData) insertion — payload validation.
 *
 * Faithful port of the Validator::make rules in YoutubeAdController::insertNewYoutubeAds()
 * (api_youtube lines 210-247; see ../../../../KT-YOUTUBE-MIGRATION.md §2b). Adds the
 * `required_unless` + `sometimes` rules YouTube uses on top of the GDN/LinkedIn engine.
 *
 * Returns { code:200 } on success, or { code:400, errors:[...] } listing every failure.
 */

// ── Rule set (insertNewYoutubeAds Validator::make) ────────────────────────────
const META_ADS_RULES = {
  network: 'required|in:YouTube',
  type: 'required|in:IMAGE,VIDEO,TEXT,RESPONSIVE,DISPLAY,DISCOVERY,TEXT_IMAGE',
  category: 'required_unless:type,IMAGE,DISPLAY,DISCOVERY,VIDEO,TEXT_IMAGE|integer|nullable',
  post_owner: 'present|string',
  ad_title: 'present|string|nullable',
  likes: 'required_unless:type,DISPLAY,TEXT_IMAGE|integer|nullable',
  dislike: 'required_unless:type,DISPLAY,TEXT_IMAGE|integer|nullable',
  views: 'required_unless:type,DISPLAY,TEXT_IMAGE|integer|nullable',
  comment: 'required_unless:type,DISPLAY,TEXT_IMAGE|integer|nullable',
  platform: 'required|integer',
  destination_url: 'present|nullable',
  ad_id: 'required|string',
  post_date: 'required_unless:ad_position,SEARCHFEED_DISCOVERY,HOMEFEED_DISCOVERY,COMPANION|string|nullable',
  city: 'present|string|nullable',
  state: 'present|string|nullable',
  country: 'present|string|nullable',
  lower_age: 'present|integer|nullable',
  upper_age: 'present|integer|nullable',
  post_owner_image: 'required_unless:type,DISPLAY,VIDEO,IMAGE,TEXT_IMAGE|url|nullable',
  ad_position: 'required|string',
  ad_text: 'present|string|nullable',
  newsfeed_description: 'present|string|nullable',
  ad_url: 'required_unless:type,TEXT,RESPONSIVE,DISPLAY,IMAGE,TEXT_IMAGE|url|nullable',
  ad_image: 'required_unless:type,TEXT,RESPONSIVE,VIDEO,TEXT_IMAGE|url|nullable',
  version: 'required|string',
  ip_address: 'present|ip|nullable',
  tags: 'sometimes|string|nullable',
  thumbnail: 'required_unless:type,IMAGE,DISPLAY,VIDEO,TEXT_IMAGE|url|nullable',
  source: 'required|string|in:desktop,Desktop,android,ios',
  othermedia: 'sometimes|string|nullable',
  call_to_action: 'present|string|nullable',
};

// ── Rule engine (LinkedIn engine + required_unless + sometimes) ───────────────
const { validationError } = require('../../../insertion/helpers/responses');

const isMissing = (v) => v === undefined;
const isEmpty = (v) => v === null || v === '' || (Array.isArray(v) && v.length === 0);
const URL_RE = /^https?:\/\/[^\s]+$/i;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/;

const CHECKS = {
  required: (v, _a, f) => (isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null),
  present: (v, _a, f) => (isMissing(v) ? `The ${f} field must be present.` : null),
  string: (v, _a, f) => (!isMissing(v) && v !== null && typeof v !== 'string' ? `The ${f} must be a string.` : null),
  integer: (v, _a, f) =>
    isMissing(v) || v === null || v === '' ? null : !Number.isInteger(Number(v)) ? `The ${f} must be an integer.` : null,
  url: (v, _a, f) => (!isMissing(v) && v !== null && v !== '' && !URL_RE.test(String(v)) ? `The ${f} format is invalid.` : null),
  ip: (v, _a, f) => (!isMissing(v) && v !== null && v !== '' && !IP_RE.test(String(v)) ? `The ${f} must be a valid IP address.` : null),
  in: (v, arg, f) => (!isMissing(v) && v !== null && v !== '' && !arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null),
  // required_if:otherField,value — required only when data[otherField] === value
  required_if: (v, arg, f, data) => {
    const [other, val] = String(arg).split(',');
    if (String(data[other]) === val && (isMissing(v) || isEmpty(v))) return `The ${f} field is required when ${other} is ${val}.`;
    return null;
  },
  // required_unless:otherField,v1,v2,... — required UNLESS data[otherField] is one of the values.
  // (PHP's stray "==" value is harmless — type never equals "==".)
  required_unless: (v, arg, f, data) => {
    const parts = String(arg).split(',');
    const other = parts[0];
    const allowed = parts.slice(1);
    const exempt = allowed.includes(String(data[other]));
    if (!exempt && (isMissing(v) || isEmpty(v))) return `The ${f} field is required.`;
    return null;
  },
};

function validate(data, rules) {
  const errors = [];
  for (const [field, ruleStr] of Object.entries(rules)) {
    const tokens = ruleStr.split('|');
    const value = data[field];

    // `sometimes` → only validate when the key is present
    if (tokens.includes('sometimes') && isMissing(value)) continue;
    const nullable = tokens.includes('nullable');
    if (nullable && value === null) continue;

    for (const token of tokens) {
      if (token === 'nullable' || token === 'sometimes') continue;
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

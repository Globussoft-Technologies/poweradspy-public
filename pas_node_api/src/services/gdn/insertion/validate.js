'use strict';

/**
 * GDN insertion — payload validation.
 *
 * Faithful port of the Laravel Validator::make rules in GdnAdController::insertAds()
 * (see ../../../../PHP-SPEC-gdn.md §2.1). Same tiny rule engine as Facebook's
 * validate.js (copied per MANIFEST §7 — networks own their rule set), extended with
 * `ip` and `not_in` checks that GDN uses.
 *
 * Returns { code:200 } on success, or { code:400, errors:[...] } listing every
 * failure (mirrors PHP returning all validator errors at once).
 */

// ── Rule set (GdnAdController::insertAds) ─────────────────────────────────────
const META_ADS_RULES = {
  network: 'required',
  type: 'required|in:IMAGE,TEXT',
  post_owner: 'present|required|string',
  post_owner_image: 'present|url|nullable',
  ad_title: 'present|string|nullable',
  ad_image: 'present|string',
  ad_image_size: 'present|string',
  newsfeed_description: 'present|string|nullable',
  platform: 'required|integer',
  destination_url: 'present',
  ad_id: 'required|string',
  city: 'present|string|nullable|not_in:NA,N/A',
  state: 'present|string|nullable|not_in:NA,N/A',
  country: 'present|string|not_in:N/A,NA',
  ad_position: 'required|string',
  ad_sub_position: 'present|string|nullable',
  ad_number_position: 'present|integer|nullable',
  ad_text: 'present|string|nullable',
  version: 'required|string',
  ip_address: 'present|ip',
  source: 'required|string|in:desktop,android,ios',
  target_site: 'required|string',
  placement_url: 'required|string',
  system_id: 'required|string',
};

// ── Rule engine (copied from Facebook validate.js + ip/not_in) ────────────────
const { validationError } = require('../../../insertion/helpers/responses');

const isMissing = (v) => v === undefined;
const isEmpty = (v) => v === null || v === '' || (Array.isArray(v) && v.length === 0);

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/;

const CHECKS = {
  required: (v, _a, f) => (isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null),
  present: (v, _a, f) => (isMissing(v) ? `The ${f} field must be present.` : null),
  string: (v, _a, f) => (!isMissing(v) && v !== null && typeof v !== 'string' ? `The ${f} must be a string.` : null),
  integer: (v, _a, f) =>
    isMissing(v) || v === null || v === '' ? null /* present|integer|nullable tolerates empty */
      : !Number.isInteger(Number(v)) ? `The ${f} must be an integer.` : null,
  url: (v, _a, f) => (!isMissing(v) && v !== null && v !== '' && !isUrl(v) ? `The ${f} format is invalid.` : null),
  ip: (v, _a, f) => (!isMissing(v) && v !== null && v !== '' && !IP_RE.test(String(v)) ? `The ${f} must be a valid IP address.` : null),
  in: (v, arg, f) => (!isMissing(v) && v !== null && v !== '' && !arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null),
  not_in: (v, arg, f) => (!isMissing(v) && v !== null && arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null),
};

function isUrl(v) { try { new URL(String(v)); return true; } catch { return false; } }

function validate(data, rules) {
  const errors = [];
  for (const [field, ruleStr] of Object.entries(rules)) {
    const tokens = ruleStr.split('|');
    const value = data[field];

    const nullable = tokens.includes('nullable');
    if (nullable && value === null) continue;

    for (const token of tokens) {
      if (token === 'nullable') continue;
      const idx = token.indexOf(':');
      const name = idx === -1 ? token : token.slice(0, idx);
      const arg = idx === -1 ? undefined : token.slice(idx + 1);
      const check = CHECKS[name];
      if (!check) continue;
      const err = check(value, arg, field);
      if (err) { errors.push(err); break; } // one error per field
    }
  }
  return errors.length ? validationError(errors) : { code: 200 };
}

const validateMetaAds = (data) => validate(data, META_ADS_RULES);

module.exports = { validate, validateMetaAds, META_ADS_RULES };

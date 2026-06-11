'use strict';

/**
 * LinkedIn (lnAdsData) insertion — payload validation.
 *
 * Faithful port of the Validator::make rules in adsDataController::adsdata()
 * (api_linkedin, lines 124-154; see ../../../../KT-LINKEDIN-MIGRATION.md §5).
 * Same tiny rule engine as GDN/gtext, plus a `url` check (image_video_url).
 *
 * Returns { code:200 } on success, or { code:400, errors:[...] } listing every failure.
 */

// ── Rule set (adsDataController::adsdata Validator::make) ──────────────────────
const META_ADS_RULES = {
  type: 'required|in:Image,Video,IMAGE,VIDEO',
  call_to_action: 'present|string|nullable',
  image_video_url: 'required|url|string',
  ad_position: 'required|string',
  likes: 'required',
  comment: 'required',
  other_multimedia: 'present|nullable',
  destination_url: 'present|nullable',
  ad_title: 'present|string|nullable',
  news_feed_description: 'present|string|nullable',
  ad_text: 'present|string|nullable',
  ad_url: 'present|string|nullable',
  post_owner: 'present|string|nullable',
  post_owner_image: 'present|nullable',
  ad_id: 'required',
  profile_link: 'present',
  platform: 'required',
  version: 'required',
  post_date: 'required|string|nullable',
  first_seen: 'required|string|nullable',
  last_seen: 'required|string|nullable',
  city: 'present|string|nullable',
  state: 'present|string|nullable',
  country: 'present|string',
  source: 'required|string|in:desktop,android,ios',
};

// ── Rule engine (copied from gtext validate.js + a `url` check) ────────────────
const { validationError } = require('../../../insertion/helpers/responses');

const isMissing = (v) => v === undefined;
const isEmpty = (v) => v === null || v === '' || (Array.isArray(v) && v.length === 0);
// Laravel `url`: must be a well-formed http(s) URL. Lenient — only checked when present & non-empty.
const URL_RE = /^https?:\/\/[^\s]+$/i;

const CHECKS = {
  required: (v, _a, f) => (isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null),
  present: (v, _a, f) => (isMissing(v) ? `The ${f} field must be present.` : null),
  string: (v, _a, f) => (!isMissing(v) && v !== null && typeof v !== 'string' ? `The ${f} must be a string.` : null),
  url: (v, _a, f) => (!isMissing(v) && v !== null && v !== '' && !URL_RE.test(String(v)) ? `The ${f} format is invalid.` : null),
  in: (v, arg, f) => (!isMissing(v) && v !== null && v !== '' && !arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null),
};

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
      const err = check(value, arg, field, data);
      if (err) { errors.push(err); break; }
    }
  }
  return errors.length ? validationError(errors) : { code: 200 };
}

const validateMetaAds = (data) => validate(data, META_ADS_RULES);

module.exports = { validate, validateMetaAds, META_ADS_RULES };

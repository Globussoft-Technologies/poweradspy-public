'use strict';

/**
 * Instagram insertion — payload validation.
 * VERBATIM from PHP Validator::make rules: instaAdsData (lines 135-162),
 * adsLibraryInsert (lines 6564-6591). Same tiny rule engine as Facebook.
 */

const { validationError } = require('../../../insertion/helpers/responses');

// instaAdsData (POST gramAdsData)
const INSTA_RULES = {
  ad_id: 'required',
  ad_position: 'required|string',
  type: 'required|in:IMAGE,VIDEO,STORIES',
  ad_text: 'present|string|nullable',
  ad_url: 'required|nullable',
  post_owner: 'required|string',
  post_owner_image: 'present|url|nullable',
  ad_title: 'present|string|nullable',
  news_feed_description: 'present|string|nullable',
  platform: 'required',
  destination_url: 'present|nullable',
  initial_url: 'nullable',
  likes: 'present|integer',
  comment: 'present|integer',
  share: 'present|integer',
  call_to_action: 'present|nullable',
  image_video_url: 'required|url',
  post_date: 'required|string|nullable',
  first_seen: 'required|string|nullable',
  last_seen: 'required|string|nullable',
  country: 'present|string|nullable',
  state: 'present|string|nullable',
  city: 'present|string|nullable',
  lower_age: 'present|integer|nullable',
  upper_age: 'present|integer|nullable',
};

// adsLibraryInsert
const LIBRARY_RULES = {
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
  impressions_high: 'present|nullable',
  country: 'present|array',
};

const isMissing = (v) => v === undefined;
const isEmpty = (v) => v === null || v === '' || (Array.isArray(v) && v.length === 0);

const CHECKS = {
  required: (v, _a, f) => (isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null),
  present: (v, _a, f) => (isMissing(v) ? `The ${f} field must be present.` : null),
  array: (v, _a, f) => (!isMissing(v) && v !== null && !Array.isArray(v) ? `The ${f} must be an array.` : null),
  string: (v, _a, f) => (!isMissing(v) && v !== null && typeof v !== 'string' ? `The ${f} must be a string.` : null),
  integer: (v, _a, f) => (isMissing(v) || v === null ? null : (!Number.isInteger(Number(v)) || String(v).trim() === '' ? `The ${f} must be an integer.` : null)),
  url: (v, _a, f) => (!isMissing(v) && v !== null && v !== '' && !isUrl(v) ? `The ${f} format is invalid.` : null),
  in: (v, arg, f) => (!isMissing(v) && v !== null && !arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null),
};

function isUrl(v) { try { new URL(String(v)); return true; } catch { return false; } }

function validate(data, rules) {
  const errors = [];
  for (const [field, ruleStr] of Object.entries(rules)) {
    const tokens = ruleStr.split('|');
    const value = data[field];
    if (tokens.includes('nullable') && value === null) continue;
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

const validateInsta = (data) => validate(data, INSTA_RULES);
const validateAdsLibrary = (data) => validate(data, LIBRARY_RULES);

module.exports = { validate, validateInsta, validateAdsLibrary, INSTA_RULES, LIBRARY_RULES };

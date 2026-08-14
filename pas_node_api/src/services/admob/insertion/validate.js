'use strict';

const { isIP } = require('node:net');

const AD_TYPES = new Set([
  'BANNER', 'WEBVIEW_BANNER', 'INTERSTITIAL_OR_NATIVE', 'INTERSTITIAL_WEBVIEW',
  'NATIVE_OR_UNKNOWN', 'REWARDED_OR_VIDEO', 'PLAY_STORE_AD', 'VISUAL_BANNER',
  'VISUAL_NATIVE_AD', 'UNKNOWN',
]);

const ADMOB_ADS_RULES = {
  ad_id: 'required|string',
  ad_image_size: 'string|nullable',
  ad_number_position: 'integer|nullable',
  ad_position: 'string|nullable',
  ad_sub_position: 'string|nullable',
  ad_text: 'string|nullable',
  ad_title: 'string|nullable',
  ad_url: 'url|nullable',
  city: 'string|nullable',
  country: 'required|array',
  destination_url: 'url|nullable',
  first_seen: 'epoch|nullable',
  image_url_original: 'url|nullable',
  ip_address: 'ip|nullable',
  last_seen: 'required|epoch',
  network: 'required|string|in:mob-network',
  sub_network: 'string|nullable',
  newsfeed_description: 'string|nullable',
  placement_url: 'url|nullable',
  platform: 'required|integer|in:19',
  post_date: 'epoch|nullable',
  post_owner: 'string|nullable',
  post_owner_image: 'url|nullable',
  redirect_url: 'url|nullable',
  source: 'required|string|in:Desktop,Android,Ios',
  session_id: 'required|string',
  state: 'string|nullable',
  system_id: 'required|string',
  target_site: 'url|nullable',
  type: 'required|string|in:BANNER,WEBVIEW_BANNER,INTERSTITIAL_OR_NATIVE,INTERSTITIAL_WEBVIEW,NATIVE_OR_UNKNOWN,REWARDED_OR_VIDEO,PLAY_STORE_AD,VISUAL_BANNER,VISUAL_NATIVE_AD,UNKNOWN',
  version: 'string|nullable',
  source_app: 'required|string',
  source_app_pkg: 'string|nullable',
};

const ALLOWED_FIELDS = new Set(Object.keys(ADMOB_ADS_RULES));

function empty(value) {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

function httpUrl(value) {
  if (value === null || value === '') return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function add(errors, field, reason, message) {
  errors.push({ field, reason, message });
}

function validateRule(errors, field, value, ruleText) {
  const rules = ruleText.split('|');
  const required = rules.includes('required');
  const nullable = rules.includes('nullable');

  if (empty(value)) {
    if (required) add(errors, field, 'MISSING_REQUIRED_FIELD', `${field} is required and cannot be empty.`);
    return;
  }
  if (value === null && nullable) return;

  for (const rule of rules) {
    if (rule === 'required' || rule === 'nullable') continue;

    if (rule === 'string' && typeof value !== 'string') {
      add(errors, field, 'INVALID_TYPE', `${field} must be a string.`);
    } else if (rule === 'array' && !Array.isArray(value)) {
      add(errors, field, 'INVALID_TYPE', `${field} must be an array.`);
    } else if (rule === 'integer' && !Number.isInteger(Number(value))) {
      add(errors, field, 'INVALID_TYPE', `${field} must be an integer.`);
    } else if (rule === 'url' && !httpUrl(value)) {
      add(errors, field, 'INVALID_FORMAT', `${field} must be null, empty, or an absolute HTTP(S) URL.`);
    } else if (rule === 'epoch' && !(Number.isInteger(Number(value)) && Number(value) >= 0)) {
      add(errors, field, 'INVALID_FORMAT', `${field} must be a non-negative Unix timestamp in seconds or milliseconds.`);
    } else if (rule === 'ip' && isIP(String(value)) === 0) {
      add(errors, field, 'INVALID_FORMAT', `${field} must be a valid IPv4 or IPv6 address.`);
    } else if (rule.startsWith('in:')) {
      const allowed = rule.slice(3).split(',');
      if (!allowed.includes(String(value))) {
        add(errors, field, 'INVALID_VALUE', `${field} must be one of: ${allowed.join(', ')}.`);
      }
    }
  }
}

function validateAdmobPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid([{ field: '$', reason: 'INVALID_PAYLOAD', message: 'Each AdMob ad must be a JSON object.' }]);
  }

  for (const field of Object.keys(payload)) {
    if (!ALLOWED_FIELDS.has(field)) add(errors, field, 'UNKNOWN_FIELD', `${field} is not part of the AdMob contract.`);
  }

  for (const [field, rules] of Object.entries(ADMOB_ADS_RULES)) {
    validateRule(errors, field, payload[field], rules);
  }

  if (!Array.isArray(payload.country) || payload.country.length === 0) {
    if (Array.isArray(payload.country)) {
      add(errors, 'country', 'INVALID_VALUE', 'country must contain at least one country name.');
    }
  } else if (Array.isArray(payload.country)) {
    const values = payload.country.map((value) => typeof value === 'string' ? value.trim() : '');
    if (values.some((value) => !value)) add(errors, 'country', 'INVALID_VALUE', 'Every country must be a non-empty string.');
    if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
      add(errors, 'country', 'DUPLICATE_VALUE', 'country cannot contain duplicate values, including case-only duplicates.');
    }
  }

  return errors.length ? invalid(errors) : { code: 200, status: 'ok' };
}

function invalid(errors) {
  return {
    code: 422,
    status: 'rejected',
    message: 'AdMob payload validation failed.',
    errors,
    hint: 'Fix every field listed in errors and resend. No MySQL, NAS, or Elasticsearch write was attempted.',
  };
}

module.exports = { ADMOB_ADS_RULES, AD_TYPES, validateAdmobPayload };

'use strict';

/**
 * Platform-18 validation switches.
 *
 * Change only the first presence token when the producer contract changes:
 *   required  -> key and a non-empty value are required
 *   present   -> key is required, but `nullable` permits null
 *   optional  -> key may be omitted; a supplied value is still validated
 *   disabled  -> key is allowed but all validation for it is skipped
 *
 * Example: make post_date omittable:
 *   post_date: 'optional|nullable|rfc3339'
 */
const TRANSPARENCY_RULES = {
  ad_id: 'required|creative_id',
  advertiser_id: 'required|advertiser_id',
  ad_url: 'required|transparency_url',
  post_owner: 'present|nullable|string',
  post_owner_image: 'present|nullable|url',
  ad_title: 'present|nullable|string',
  ad_text: 'present|nullable|string',
  image_url_original: 'present|nullable|url',
  video_url_original: 'present|nullable|url',
  othermultimedia: 'present|array|url_items',
  destination_url: 'present|nullable|url',
  redirect_url: 'present|nullable|url',
  country: 'present|array|unique',
  country_details: 'present|array',
  region_code: 'required|country_code',
  type: 'required|in:IMAGE,TEXT,VIDEO',
  first_seen: 'present|nullable|rfc3339',
  last_seen: 'present|nullable|rfc3339',
  impressions: 'present|nullable|impressions',
  post_date: 'optional|nullable|rfc3339',
  network: 'required|in:google',
  subnetwork: 'present|nullable|in:MAPS,PLAY,SHOPPING,SEARCH,YOUTUBE',
  source: 'required|in:desktop',
  platform: 'required|integer|in:18',
  system_id: 'required|string',
  version: 'required|string|in:3.2.0',
};

const REQUIRED_FIELDS = Object.entries(TRANSPARENCY_RULES)
  .filter(([, rules]) => /(^|\|)(required|present)(\||$)/.test(rules))
  .map(([field]) => field);
const TYPES = new Set(['IMAGE', 'TEXT', 'VIDEO']);
const SUBNETWORKS = new Set(['MAPS', 'PLAY', 'SHOPPING', 'SEARCH', 'YOUTUBE']);
const IMPRESSION_OPERATORS = new Set(['range', 'over', 'under']);
const ID_RE = /^CR\d+$/;
const ADVERTISER_RE = /^AR\d+$/;
const CODE_RE = /^[A-Z]{2}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function issue(errors, field, message) {
  errors.push({ field, message });
}

const owns = (data, field) => Object.prototype.hasOwnProperty.call(data, field);
const tokensFor = (rules, field) => String(rules[field] || '').split('|');
const disabled = (rules, field) => tokensFor(rules, field).includes('disabled');
const checkable = (data, rules, field) =>
  !disabled(rules, field) && owns(data, field) && data[field] !== null && data[field] !== undefined;

function isHttpUrl(value, host) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (!host || parsed.hostname.toLowerCase() === host);
  } catch {
    return false;
  }
}

function validateImpressions(value, field, errors, nullable = true) {
  if (value === null && nullable) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(errors, field, 'must be null or an object');
    return;
  }
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'max,min,operator') {
    issue(errors, field, 'must contain exactly min, max, and operator');
    return;
  }
  const { min, max, operator } = value;
  if (!IMPRESSION_OPERATORS.has(operator)) issue(errors, `${field}.operator`, 'must be range, over, or under');
  for (const [name, bound] of [['min', min], ['max', max]]) {
    if (bound !== null && (!Number.isSafeInteger(bound) || bound < 0)) {
      issue(errors, `${field}.${name}`, 'must be a non-negative safe integer or null');
    }
  }
  if (operator === 'range' && (min === null || max === null)) issue(errors, field, 'range requires both min and max');
  if (operator === 'over' && (min === null || max !== null)) issue(errors, field, 'over requires min and requires max to be null');
  if (operator === 'under' && (max === null || min !== null)) issue(errors, field, 'under requires max and requires min to be null');
  if (min !== null && max !== null && min > max) issue(errors, field, 'min cannot exceed max');
}

function validateTransparencyPayload(data, rules = TRANSPARENCY_RULES) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return invalid([{ field: '$', message: 'payload must be a JSON object' }]);
  }

  for (const [field, ruleString] of Object.entries(rules)) {
    const tokens = String(ruleString).split('|');
    if (tokens.includes('disabled') || tokens.includes('optional')) continue;
    if (tokens.includes('present') && !owns(data, field)) {
      issue(errors, field, 'must be present');
    }
    if (tokens.includes('required') &&
        (!owns(data, field) || data[field] === null ||
         (typeof data[field] === 'string' && data[field].trim() === ''))) {
      issue(errors, field, 'is required and must not be empty');
    }
  }
  const allowedFields = new Set(Object.keys(rules));
  for (const field of Object.keys(data)) {
    if (!allowedFields.has(field)) issue(errors, field, 'is not allowed by contract 3.2.0');
    const tokens = tokensFor(rules, field);
    if (data[field] === null && !tokens.includes('nullable') && !tokens.includes('disabled')) {
      issue(errors, field, 'must not be null');
    }
    if (data[field] === undefined && !tokens.includes('optional') && !tokens.includes('disabled')) {
      issue(errors, field, 'must be explicit null, not undefined');
    }
  }
  if (errors.length) return invalid(errors);

  if (checkable(data, rules, 'ad_id') && (typeof data.ad_id !== 'string' || !ID_RE.test(data.ad_id))) issue(errors, 'ad_id', 'must match CR<digits>');
  if (checkable(data, rules, 'advertiser_id') && (typeof data.advertiser_id !== 'string' || !ADVERTISER_RE.test(data.advertiser_id))) issue(errors, 'advertiser_id', 'must match AR<digits>');
  if (checkable(data, rules, 'ad_url') && !isHttpUrl(data.ad_url, 'adstransparency.google.com')) issue(errors, 'ad_url', 'must be an absolute Google Ads Transparency URL');
  if (checkable(data, rules, 'ad_url') && isHttpUrl(data.ad_url)) {
    const path = new URL(data.ad_url).pathname.split('/').filter(Boolean);
    const advertiserPos = path.indexOf('advertiser');
    const creativePos = path.indexOf('creative');
    const advertiserFromUrl = advertiserPos >= 0 ? path[advertiserPos + 1] || null : null;
    const creativeFromUrl = creativePos >= 0 ? path[creativePos + 1] || null : null;
    if (!advertiserFromUrl) {
      issue(errors, 'ad_url', 'path must contain /advertiser/<advertiser_id>');
    } else if (checkable(data, rules, 'advertiser_id') && advertiserFromUrl !== data.advertiser_id) {
      errors.push({
        field: 'advertiser_id',
        message: `does not match ad_url advertiser segment: received "${data.advertiser_id}", expected "${advertiserFromUrl}"`,
        received: data.advertiser_id,
        expected: advertiserFromUrl,
        compared_with: 'ad_url advertiser segment',
      });
    }
    if (!creativeFromUrl) {
      issue(errors, 'ad_url', 'path must contain /creative/<ad_id>');
    } else if (checkable(data, rules, 'ad_id') && creativeFromUrl !== data.ad_id) {
      errors.push({
        field: 'ad_id',
        message: `does not match ad_url creative segment: received "${data.ad_id}", expected "${creativeFromUrl}"`,
        received: data.ad_id,
        expected: creativeFromUrl,
        compared_with: 'ad_url creative segment',
      });
    }
  }

  for (const field of ['system_id', 'version']) {
    if (checkable(data, rules, field) && (typeof data[field] !== 'string' || data[field].trim() === '')) issue(errors, field, 'must be a non-empty string');
  }
  if (checkable(data, rules, 'post_owner') && (typeof data.post_owner !== 'string' || data.post_owner.trim() === '')) {
    issue(errors, 'post_owner', 'must be null or a non-empty string');
  }
  for (const field of ['post_owner_image', 'image_url_original', 'video_url_original', 'destination_url', 'redirect_url']) {
    if (checkable(data, rules, field) && (typeof data[field] !== 'string' || !isHttpUrl(data[field]))) issue(errors, field, 'must be null or an absolute HTTP(S) URL');
  }
  for (const field of ['ad_title', 'ad_text']) {
    if (checkable(data, rules, field) && typeof data[field] !== 'string') issue(errors, field, 'must be null or a string');
  }
  if (checkable(data, rules, 'type') && !TYPES.has(data.type)) issue(errors, 'type', 'must be IMAGE, TEXT, or VIDEO');
  if (checkable(data, rules, 'subnetwork') && !SUBNETWORKS.has(data.subnetwork)) issue(errors, 'subnetwork', 'contains an unsupported value');
  if (checkable(data, rules, 'network') && data.network !== 'google') issue(errors, 'network', 'must equal google');
  if (checkable(data, rules, 'source') && data.source !== 'desktop') issue(errors, 'source', 'must equal desktop');
  if (checkable(data, rules, 'platform') && data.platform !== 18) issue(errors, 'platform', 'must be the integer 18');
  if (checkable(data, rules, 'version') && data.version !== '3.2.0') issue(errors, 'version', 'must equal contract version 3.2.0');
  if (checkable(data, rules, 'region_code') && (typeof data.region_code !== 'string' || !CODE_RE.test(data.region_code))) issue(errors, 'region_code', 'must be an uppercase alpha-2 code');

  for (const field of ['first_seen', 'last_seen', 'post_date']) {
    if (!checkable(data, rules, field)) continue;
    const value = data[field];
    if (typeof value !== 'string' || !RFC3339_RE.test(value) || Number.isNaN(Date.parse(value))) {
      issue(errors, field, 'must be null or an RFC 3339 timestamp');
    }
  }

  for (const field of ['country', 'othermultimedia', 'country_details']) {
    if (checkable(data, rules, field) && !Array.isArray(data[field])) issue(errors, field, 'must be an array');
  }
  if (!disabled(rules, 'country') && Array.isArray(data.country)) {
    if (data.country.some((v) => typeof v !== 'string' || !v.trim())) issue(errors, 'country', 'must contain non-empty strings');
    if (new Set(data.country).size !== data.country.length) issue(errors, 'country', 'must not contain duplicates');
  }
  if (!disabled(rules, 'othermultimedia') && Array.isArray(data.othermultimedia)) {
    if (data.othermultimedia.some((v) => typeof v !== 'string' || !isHttpUrl(v))) issue(errors, 'othermultimedia', 'must contain only absolute HTTP(S) URLs');
    if (new Set(data.othermultimedia).size !== data.othermultimedia.length) issue(errors, 'othermultimedia', 'must not contain duplicates');
    const primary = new Set([data.image_url_original, data.video_url_original].filter(Boolean));
    if (data.othermultimedia.some((v) => primary.has(v))) issue(errors, 'othermultimedia', 'must not repeat a primary media URL');
  }

  if (!disabled(rules, 'country_details') && Array.isArray(data.country_details)) {
    const names = [];
    for (let i = 0; i < data.country_details.length; i++) {
      const detail = data.country_details[i];
      const field = `country_details[${i}]`;
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
        issue(errors, field, 'must be an object');
        continue;
      }
      if (Object.keys(detail).sort().join(',') !== 'country,country_code,first_seen,last_seen,times_shown') {
        issue(errors, field, 'must contain exactly country, country_code, first_seen, last_seen, and times_shown');
        continue;
      }
      names.push(detail.country);
      if (typeof detail.country !== 'string' || !detail.country.trim()) issue(errors, `${field}.country`, 'must be a non-empty string');
      if (typeof detail.country_code !== 'string' || !CODE_RE.test(detail.country_code)) issue(errors, `${field}.country_code`, 'must be an uppercase alpha-2 code');
      for (const dateField of ['first_seen', 'last_seen']) {
        if (detail[dateField] !== null &&
            (typeof detail[dateField] !== 'string' || !RFC3339_RE.test(detail[dateField]) || Number.isNaN(Date.parse(detail[dateField])))) {
          issue(errors, `${field}.${dateField}`, 'must be null or an RFC 3339 timestamp');
        }
      }
      validateImpressions(detail.times_shown, `${field}.times_shown`, errors);
    }
    if (data.country_details.length && Array.isArray(data.country) &&
        JSON.stringify(names) !== JSON.stringify(data.country)) {
      issue(errors, 'country_details', 'country names and order must match country');
    }
  }
  if (!disabled(rules, 'impressions') && owns(data, 'impressions')) {
    validateImpressions(data.impressions, 'impressions', errors);
  }

  return errors.length ? invalid(errors) : { code: 200 };
}

function invalid(errors) {
  return {
    code: 422,
    status: 'rejected',
    message: 'Payload does not satisfy Google Transparency contract 3.2.0.',
    errors,
    hint: 'Send fields marked required/present, use explicit nulls for nullable values, and remove unknown fields.',
  };
}

module.exports = { validateTransparencyPayload, TRANSPARENCY_RULES, REQUIRED_FIELDS };

'use strict';

/**
 * Quora insertion — payload validation.
 * Faithful port of PHP quorAdController::quoraAdsData() validation.
 * Lenient validation — coercion happens in normalization.
 */

const { validationError } = require('../../../insertion/helpers/responses');
const { isNullLike, normalizeNullLike } = require('../../../insertion/helpers/util');

function isEmptyLike(v) {
  return isNullLike(v) || (typeof v === 'string' && v.trim() === '');
}

function validateQuoraAds(data) {
  const errors = [];

  // Sanitize stringified null / empty values before validation.
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key])) {
      data[key] = data[key].map(normalizeNullLike).filter((v) => !isNullLike(v));
    } else if (typeof data[key] === 'string') {
      data[key] = normalizeNullLike(data[key]);
    }
  }

  const type = isEmptyLike(data.type) ? '' : String(data.type).toUpperCase();

  // REQUIRED fields (must be present and not empty)
  if (!type || !['IMAGE', 'VIDEO', 'TEXT'].includes(type)) {
    errors.push('The type must be one of: IMAGE, VIDEO, TEXT.');
  }
  if (isEmptyLike(data.ad_id)) {
    errors.push('The ad_id field is required.');
  }
  if (isEmptyLike(data.platform)) {
    errors.push('The platform field is required.');
  }
  if (isEmptyLike(data.ad_position)) {
    errors.push('The ad_position field is required.');
  }
  if (isEmptyLike(data.version)) {
    errors.push('The version field is required.');
  }
  if (isEmptyLike(data.source) || !['desktop', 'android', 'ios'].includes(data.source)) {
    errors.push('The source must be one of: desktop, android, ios.');
  }
  if (isEmptyLike(data.quora_id)) {
    errors.push('The quora_id field is required.');
  }
  if (isEmptyLike(data.country)) {
    errors.push('The country field is required.');
  }

  // Image required for IMAGE type ads
  if (type === 'IMAGE') {
    const hasImage = !isEmptyLike(data.image_url) || !isEmptyLike(data.image_video_url);
    if (!hasImage) {
      errors.push('IMAGE type ads require an image_url or image_video_url.');
    }
  }

  // Thumbnail required for VIDEO type ads
  if (type === 'VIDEO') {
    const hasThumbnail = !isEmptyLike(data.image_video_url);
    if (!hasThumbnail) {
      errors.push('VIDEO type ads require an image_video_url (thumbnail).');
    }
  }

  // IP address validation (if provided)
  if (!isEmptyLike(data.ip_address) && !isValidIp(data.ip_address)) {
    errors.push('The ip_address must be a valid IP address.');
  }

  return errors.length ? validationError(errors) : { code: 200 };
}

function isValidIp(ip) {
  const ipv4Regex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})$/;
  return ipv4Regex.test(String(ip)) || ipv6Regex.test(String(ip));
}

function isValidUrl(url) {
  try { new URL(String(url)); return true; } catch { return false; }
}

module.exports = { validateQuoraAds };

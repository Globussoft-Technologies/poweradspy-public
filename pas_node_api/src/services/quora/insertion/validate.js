'use strict';

/**
 * Quora insertion — payload validation.
 * Faithful port of PHP quorAdController::quoraAdsData() validation.
 * Lenient validation — coercion happens in normalization.
 */

const { validationError } = require('../../../insertion/helpers/responses');

function validateQuoraAds(data) {
  const errors = [];
  const type = String(data.type).toUpperCase();

  // REQUIRED fields (must be present and not empty)
  if (!data.type || !['IMAGE', 'VIDEO', 'TEXT'].includes(type)) {
    errors.push('The type must be one of: IMAGE, VIDEO, TEXT.');
  }
  if (!data.ad_id || String(data.ad_id).trim() === '') {
    errors.push('The ad_id field is required.');
  }
  if (!data.platform) {
    errors.push('The platform field is required.');
  }
  if (!data.ad_position || String(data.ad_position).trim() === '') {
    errors.push('The ad_position field is required.');
  }
  if (!data.version || String(data.version).trim() === '') {
    errors.push('The version field is required.');
  }
  if (!data.source || !['desktop', 'android', 'ios'].includes(data.source)) {
    errors.push('The source must be one of: desktop, android, ios.');
  }
  if (!data.quora_id || String(data.quora_id).trim() === '') {
    errors.push('The quora_id field is required.');
  }
  if (!data.country || String(data.country).trim() === '') {
    errors.push('The country field is required.');
  }

  // Image required for IMAGE type ads
  if (type === 'IMAGE') {
    const hasImage = (data.image_url && String(data.image_url).trim() !== '') ||
                     (data.image_video_url && String(data.image_video_url).trim() !== '');
    if (!hasImage) {
      errors.push('IMAGE type ads require an image_url or image_video_url.');
    }
  }

  // Thumbnail required for VIDEO type ads
  if (type === 'VIDEO') {
    const hasThumbnail = data.image_video_url && String(data.image_video_url).trim() !== '';
    if (!hasThumbnail) {
      errors.push('VIDEO type ads require an image_video_url (thumbnail).');
    }
  }

  // IP address validation (if provided)
  if (data.ip_address && data.ip_address !== '' && !isValidIp(data.ip_address)) {
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

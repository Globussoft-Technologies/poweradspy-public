'use strict';

/**
 * AI Recreate — request validation for POST /recreate.
 */

const imageGenConfig = require('./config');

function validateRecreateRequest(body) {
  const errors = [];
  const b = body || {};

  if (!b.network || typeof b.network !== 'string') errors.push('The network field is required.');
  if (!b.ad_id || (typeof b.ad_id !== 'string' && typeof b.ad_id !== 'number')) {
    errors.push('The ad_id field is required.');
  }
  if (!b.aspect_ratio || typeof b.aspect_ratio !== 'string') {
    errors.push('The aspect_ratio field is required.');
  } else if (!imageGenConfig.aspectRatios.includes(b.aspect_ratio)) {
    errors.push(`The aspect_ratio must be one of: ${imageGenConfig.aspectRatios.join(', ')}.`);
  }
  if (typeof b.prompt !== 'string' || !b.prompt.trim()) {
    errors.push('The prompt field is required.');
  } else if (b.prompt.length > 1000) {
    errors.push('The prompt field must not exceed 1000 characters.');
  }
  if (b.watermark !== undefined && typeof b.watermark !== 'boolean') {
    errors.push('The watermark field must be a boolean.');
  }
  // product_image_url is the URL POST /upload returned — required by the UI (the
  // whole point of this screen is "recreate using YOUR product image"), but kept
  // optional here so a direct API caller without a product photo isn't hard-blocked.
  if (b.product_image_url !== undefined && b.product_image_url !== null) {
    if (typeof b.product_image_url !== 'string' || !/^https?:\/\//i.test(b.product_image_url)) {
      errors.push('The product_image_url field must be a valid URL.');
    }
  }
  if (Array.isArray(b.extra_image_urls)) {
    if (b.extra_image_urls.length > 3) errors.push('extra_image_urls accepts at most 3 images.');
    else if (b.extra_image_urls.some((u) => typeof u !== 'string' || !/^https?:\/\//i.test(u))) {
      errors.push('Every extra_image_urls entry must be a valid URL.');
    }
  } else if (b.extra_image_urls !== undefined && b.extra_image_urls !== null) {
    errors.push('The extra_image_urls field must be an array.');
  }
  if (b.brand_website !== undefined && b.brand_website !== null && typeof b.brand_website !== 'string') {
    errors.push('The brand_website field must be a string.');
  }
  if (b.source_advertiser !== undefined && b.source_advertiser !== null && typeof b.source_advertiser !== 'string') {
    errors.push('The source_advertiser field must be a string.');
  }
  if (b.source_running_days !== undefined && b.source_running_days !== null && !Number.isFinite(Number(b.source_running_days))) {
    errors.push('The source_running_days field must be a number.');
  }
  if (b.product_image !== undefined && b.product_image !== null && typeof b.product_image !== 'object') {
    errors.push('The product_image field must be an object.');
  }
  // The specific carousel slide the user was viewing when they hit Recreate —
  // optional (non-carousel ads never send it); validated server-side against
  // the ad's own resolved creative set in adResolver.js, never trusted blind.
  if (b.source_image_url !== undefined && b.source_image_url !== null) {
    if (typeof b.source_image_url !== 'string' || !/^https?:\/\//i.test(b.source_image_url)) {
      errors.push('The source_image_url field must be a valid URL.');
    }
  }

  return errors;
}

module.exports = { validateRecreateRequest };

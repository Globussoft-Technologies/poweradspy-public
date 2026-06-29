'use strict';

/**
 * Quora insertion — data normalization.
 * Faithful port of PHP urldecode, epoch conversion, and other cleanup.
 */

const { toInt, sanitizePayload } = require('../../../insertion/helpers/util');

function cleanStr(s) {
  return typeof s === 'string' ? s.trim() : String(s ?? '').trim();
}

function epochToDateTime(epoch) {
  if (!epoch) return null;
  const ts = toInt(epoch, 0);
  if (ts <= 0) return null;
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function normalizeQuoraAds(ad) {
  const out = sanitizePayload({ ...ad });

  // Coerce numeric fields with defaults (matching PHP behavior)
  out.likes = ad.likes === null || ad.likes === '' || ad.likes === undefined ? 0 : toInt(ad.likes, 0);
  out.comment = ad.comment === null || ad.comment === '' || ad.comment === undefined ? 0 : toInt(ad.comment, 0);
  out.share = ad.share === null || ad.share === '' || ad.share === undefined ? 0 : toInt(ad.share, 0);
  out.lower_age = ad.lower_age === null || ad.lower_age === '' || ad.lower_age === undefined ? 23 : toInt(ad.lower_age, 23);
  out.upper_age = ad.upper_age === null || ad.upper_age === '' || ad.upper_age === undefined ? 65 : toInt(ad.upper_age, 65);
  out.platform = toInt(ad.platform, 0);

  // URL decode text fields (safely, only if encoded)
  const safeUrlDecode = (val) => {
    if (!val || typeof val !== 'string') return val;
    try {
      // Only decode if it looks like it might be encoded
      if (val.includes('%')) {
        return decodeURIComponent(val);
      }
      return val;
    } catch (e) {
      // If decoding fails, return original value
      return val;
    }
  };

  out.ad_text = safeUrlDecode(ad.ad_text);
  out.news_feed_description = safeUrlDecode(ad.news_feed_description);
  out.destination_url = safeUrlDecode(ad.destination_url);
  out.ad_title = safeUrlDecode(ad.ad_title);
  out.ad_url = safeUrlDecode(ad.ad_url);

  // Post owner image decode (safely)
  if (ad.post_owner_image) {
    out.post_owner_image = safeUrlDecode(ad.post_owner_image);
    out.post_owner_image = out.post_owner_image.replace('=v1:', '=v1%3A');
  }

  // Epoch to datetime conversion (extract first 10 chars, convert to seconds)
  if (ad.post_date) {
    const epoch = parseInt(String(ad.post_date).substring(0, 10), 10);
    out.post_date = epochToDateTime(epoch);
  }
  if (ad.first_seen) {
    const epoch = parseInt(String(ad.first_seen).substring(0, 10), 10);
    out.first_seen = epochToDateTime(epoch);
  }
  if (ad.last_seen) {
    const epoch = parseInt(String(ad.last_seen).substring(0, 10), 10);
    out.last_seen = epochToDateTime(epoch);
  }

  // Ensure defaults for dates if not provided
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const nowDt = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

  if (!out.first_seen) out.first_seen = nowDt;
  if (!out.last_seen) out.last_seen = nowDt;

  // Type uppercase
  if (out.type) out.type = out.type.toUpperCase();

  // Map image_url → image_video_url (payload may use either name)
  if (ad.image_url && !ad.image_video_url) {
    out.image_video_url = ad.image_url;
  }

  // Strip whitespace from image fields — don't store empty/whitespace-only values
  if (out.image_video_url && typeof out.image_video_url === 'string') {
    const trimmed = out.image_video_url.trim();
    out.image_video_url = trimmed || null;
  }
  if (out.image_url_original && typeof out.image_url_original === 'string') {
    const trimmed = out.image_url_original.trim();
    out.image_url_original = trimmed || null;
  }

  // Parse other_multimedia
  if (ad.other_multimedia && typeof ad.other_multimedia === 'string') {
    out.other_multimedia_array = parseOtherMultimedia(ad.other_multimedia);
  }

  return out;
}

function parseOtherMultimedia(str) {
  if (!str || typeof str !== 'string') return [];
  let arr = [];
  if (str.includes('||,')) {
    arr = str.split('||,');
  } else if (str.includes('||')) {
    arr = str.split('||');
  } else if (str.includes('|')) {
    arr = str.split('|');
  }
  return arr.filter(s => s && s.trim());
}

function checkVersion(platform, version) {
  const minVersion = '1.0.0';
  // Allow platform 3, 4, 10 to bypass version check
  if ([3, 4, 10].includes(parseInt(platform, 10))) {
    return null;
  }
  if (version && version < minVersion) {
    return {
      code: 400,
      message: `Version ${version} is not allowed. Minimum required: ${minVersion}`,
      status: 'rejected',
    };
  }
  return null;
}

module.exports = { normalizeQuoraAds, parseOtherMultimedia, checkVersion, epochToDateTime, cleanStr };

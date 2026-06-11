'use strict';

/**
 * Reddit insertion — payload normalization (pure, no I/O).
 */

const URL_DECODE_FIELDS = [
  'ad_text', 'news_feed_description', 'destination_url',
  'image_video_url', 'ad_title', 'post_owner_image', 'ad_url',
];

function urldecode(s) {
  if (typeof s !== 'string') return s;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); }
  catch { return s; }
}

function fixAmp(s) {
  return typeof s === 'string' ? s.replace(/&amp;/g, '&') : s;
}

function versionLessThan(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da < db;
  }
  return false;
}

function checkVersion(platform, version) {
  // Version gates for Reddit if needed (customize per platform requirements)
  return null;
}

function normalizeRedditAds(ad) {
  const out = { ...ad };

  // post_owner_image string "null" → null
  if (out.post_owner_image === 'null') out.post_owner_image = null;

  // urldecode the listed fields
  for (const f of URL_DECODE_FIELDS) {
    if (out[f] !== undefined && out[f] !== null) out[f] = urldecode(out[f]);
  }

  // str_replace("=v1:", "=v1%3A") on image_video_url & post_owner_image
  for (const f of ['image_video_url', 'post_owner_image']) {
    if (typeof out[f] === 'string') out[f] = out[f].replace(/=v1:/g, '=v1%3A');
  }

  // cleanStr: trim + empty→null
  const cleanStr = (s) => {
    if (typeof s !== 'string') return s;
    const t = s.trim();
    return t === '' ? null : t;
  };

  // Coercions
  out.ad_id = cleanStr(out.ad_id);
  out.reddit_id = cleanStr(out.reddit_id);
  out.country = cleanStr(out.country);
  out.source = String(out.source).toLowerCase();
  out.ad_title = fixAmp(out.ad_title);
  out.ad_text = fixAmp(out.ad_text);
  out.news_feed_description = fixAmp(out.news_feed_description);

  // Convert string boolean/numeric to int
  if (out.lower_age !== undefined && out.lower_age !== null) {
    out.lower_age = parseInt(out.lower_age, 10) || null;
  }
  if (out.upper_age !== undefined && out.upper_age !== null) {
    out.upper_age = parseInt(out.upper_age, 10) || null;
  }

  return out;
}

module.exports = { normalizeRedditAds, checkVersion };

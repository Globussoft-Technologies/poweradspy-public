'use strict';

/**
 * Facebook insertion — payload normalization (pure, no I/O).
 *
 * Faithful port of the coercion/decoding/version logic in adsdata()
 * (see docs/insertion/PHP-SPEC-metaAdsData.md §2). Kept as small pure functions
 * so each rule is independently testable and easy to tweak.
 */

const URL_DECODE_FIELDS = [
  'ad_text', 'news_feed_description', 'destination_url', 'initial_url',
  'image_video_url', 'ad_title', 'post_owner_image', 'ad_url',
];

/** PHP urldecode — decode %XX and '+' → space. Tolerant of malformed input. */
function urldecode(s) {
  if (typeof s !== 'string') return s;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); }
  catch { return s; }
}

/** PHP intval(substr(v,0,10)) — epoch (ms or s) truncated to 10-digit seconds. */
function toEpochSeconds(v) {
  if (v === undefined || v === null || v === '') return v;
  const digits = String(v).slice(0, 10);
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

/** PHP version_compare(a, b, '<') — true when a < b. */
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

/**
 * Version gate (adsdata §2): platforms 5/6 need >= 1.3.2; platform 2 needs >= 1.0.31.
 * @returns {{code:number, message:string} | null}  null = ok
 */
function checkVersion(platform, version) {
  const p = String(platform);
  if ((p === '5' || p === '6') && versionLessThan(version, '1.3.2')) {
    return { code: 400, message: 'Please check the Version,Version Should be greater than 1.3.1 for ads' };
  }
  if (p === '2' && versionLessThan(version, '1.0.31')) {
    return { code: 400, message: 'Please check the Version,Version Should be greater than 1.0.31' };
  }
  return null;
}

/**
 * Parse other_multimedia into an array (PHP: split by first matching delimiter
 * `||,` → `||` → `|`, else single element). Returns { present, images }.
 */
function parseOtherMultimedia(value) {
  if (value === undefined || value === null || String(value).trim() === '') return { present: false, images: [] };
  const s = String(value);
  let parts;
  if (s.includes('||,')) parts = s.split('||,');
  else if (s.includes('||')) parts = s.split('||');
  else if (s.includes('|')) parts = s.split('|');
  else parts = [s];
  // drop empty/whitespace entries (payloads often have a trailing delimiter → empty tail)
  const images = parts.map((x) => x.trim()).filter((x) => x.length > 0);
  return { present: images.length > 0, images };
}

/** PHP `&amp;` → `&` used on variant title/text/newsfeed. */
function fixAmp(s) {
  return typeof s === 'string' ? s.replace(/&amp;/g, '&') : s;
}

/**
 * Apply the adsdata INSERT-path coercions to a copy of the ad payload.
 * Returns a NEW object (does not mutate input).
 */
function normalizeMetaAds(ad) {
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

  // timestamps → 10-digit epoch seconds
  for (const f of ['post_date', 'first_seen', 'last_seen']) {
    if (out[f] !== undefined) out[f] = toEpochSeconds(out[f]);
  }

  // text defaults ("" when unset)
  out.ad_text = out.ad_text ?? '';
  out.ad_title = out.ad_title ?? '';
  out.news_feed_description = out.news_feed_description ?? '';

  // variant amp fix
  out.ad_title = fixAmp(out.ad_title);
  out.ad_text = fixAmp(out.ad_text);
  out.news_feed_description = fixAmp(out.news_feed_description);

  // age "" → null
  if (out.lower_age === '') out.lower_age = null;
  if (out.upper_age === '') out.upper_age = null;

  // meta_ad_id / views normalization
  if (out.meta_ad_id === undefined || out.meta_ad_id === null || out.meta_ad_id === '') out.meta_ad_id = null;
  if (out.views === undefined || out.views === null || out.views === '') out.views = 0;

  return out;
}

module.exports = {
  urldecode, toEpochSeconds, versionLessThan, checkVersion,
  parseOtherMultimedia, fixAmp, normalizeMetaAds, URL_DECODE_FIELDS,
};

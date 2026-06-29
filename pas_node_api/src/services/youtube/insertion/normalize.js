'use strict';

/**
 * YouTube (ytAdsData) insertion — payload normalization + entry gates (pure, no I/O).
 *
 * Faithful port of insertNewYoutubeAds() gates + coercions (api_youtube lines 104-325;
 * see ../../../../KT-YOUTUBE-MIGRATION.md §2a,§2c). Dates are epoch seconds → 'YYYY-MM-DD
 * HH:MM:SS'. last_seen is forced to now() (PHP). type is kept as-is (already uppercase).
 */

const { epochToDateTime, nowDateTime, toInt, sanitizePayload } = require('../../../insertion/helpers/util');

function urldecode(s) {
  if (typeof s !== 'string') return s;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}
/** PHP cleanStr: trim(preg_replace('/\s\s+/',' ', str_replace("\n","",$s))). */
function cleanStr(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\n/g, '').replace(/\s\s+/g, ' ').trim();
}
function fixAmp(s) { return typeof s === 'string' ? s.replace(/&amp;/g, '&') : s; }
function stripNonBmp(s) {
  if (s === undefined || s === null) return s;
  return String(s).replace(/[\u{10000}-\u{10FFFF}]/gu, '');
}

function versionLessThan(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) { const da = pa[i] || 0; const db = pb[i] || 0; if (da !== db) return da < db; }
  return false;
}

const DISCOVERY_NO_POSTDATE = ['SEARCHFEED_DISCOVERY', 'HOMEFEED_DISCOVERY', 'COMPANION'];

/**
 * Entry gates from insertNewYoutubeAds (before the main insert):
 *   - ad_position == SHORTS AND destination_url == ""        → 400
 *   - version < 2.0.24 unless platform ∈ {3,10,12,13}        → 400
 *   - type == TEXT_IMAGE AND text_image_title empty          → 400
 * @returns {{code,error?,message}|null} null = ok
 */
function checkGates(ad) {
  const p = String(ad.platform);
  if (String(ad.ad_position) === 'SHORTS' && (ad.destination_url === '' || ad.destination_url === undefined || ad.destination_url === null)) {
    return { code: 400, message: 'destination_url is required for SHORTS ads' };
  }
  const exempt = p === '3' || p === '10' || p === '12' || p === '13';
  if (ad.version !== undefined && versionLessThan(ad.version, '2.0.24') && !exempt) {
    return { code: 400, error: 'Version is not allowed', message: `Minimum Version Required: 2.0.24, Version Found: ${ad.version}` };
  }
  if (String(ad.type) === 'TEXT_IMAGE' && (ad.text_image_title === undefined || ad.text_image_title === null || String(ad.text_image_title).trim() === '')) {
    return { code: 400, message: 'text_image_title is required for TEXT_IMAGE ads' };
  }
  return null;
}

/** Split the "othermedia" blob (PHP: try '||,' then '||' then '|'). */
function splitMultimedia(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  let parts = null;
  if (s.includes('||,')) parts = s.split('||,');
  else if (s.includes('||')) parts = s.split('||');
  else if (s.includes('|')) parts = s.split('|');
  else return null;
  return parts.map((x) => x.trim()).filter((x) => x.length);
}

/** Apply insertNewYoutubeAds() coercions to a copy of the payload. Returns a NEW object. */
function normalizeYoutubeAd(ad) {
  const out = sanitizePayload({ ...ad });
  // trim all string values unless landing_urls is an array (PHP array_map('trim'))
  if (!Array.isArray(out.landing_urls)) {
    for (const k of Object.keys(out)) if (typeof out[k] === 'string') out[k] = out[k].trim();
  }

  // numeric defaults
  out.category = (out.category === undefined || out.category === null || out.category === '') ? 12345 : toInt(out.category, 12345);
  out.likes = toInt(out.likes, 0);
  out.dislike = toInt(out.dislike, 0);
  out.views = toInt(out.views, 0);
  out.comment = toInt(out.comment, 0);
  out.lower_age = (out.lower_age === undefined || out.lower_age === null || out.lower_age === '') ? 18 : toInt(out.lower_age, 18);
  out.upper_age = (out.upper_age === undefined || out.upper_age === null || out.upper_age === '') ? 65 : toInt(out.upper_age, 65);

  // text fields
  out.ad_text = out.ad_text ? urldecode(cleanStr(out.ad_text)) : null;
  out.newsfeed_description = out.newsfeed_description ? urldecode(cleanStr(out.newsfeed_description)) : null;
  out.ad_title = out.ad_title ? urldecode(cleanStr(out.ad_title)) : null;
  out.ad_url = out.ad_url ? urldecode(out.ad_url) : null;
  out.ad_image = out.ad_image ? urldecode(out.ad_image) : null;
  out.destination_url = out.destination_url ? urldecode(out.destination_url) : null;
  out.channnelurl = out.channnelurl ? urldecode(out.channnelurl) : null; // sic: triple-n (PHP request key)
  out.post_owner_image = out.post_owner_image ? urldecode(out.post_owner_image) : null;

  // variant text amp-fix + stripNonBmp (utf8mb3)
  out.ad_title = stripNonBmp(fixAmp(out.ad_title));
  out.ad_text = stripNonBmp(fixAmp(out.ad_text));
  out.newsfeed_description = stripNonBmp(fixAmp(out.newsfeed_description));

  // RESPONSIVE only → display_link
  out.display_link = String(out.type) === 'RESPONSIVE' ? (out.display_link ?? null) : null;

  // dates (epoch seconds → datetime)
  const discoveryImage = DISCOVERY_NO_POSTDATE.includes(String(out.ad_position)) && String(out.type) === 'IMAGE';
  if (out.post_date !== undefined && out.post_date !== null && out.post_date !== '') {
    out.post_date = epochToDateTime(out.post_date);
  } else {
    out.post_date = discoveryImage ? '' : nowDateTime();
  }
  out.first_seen = (out.first_seen !== undefined && out.first_seen !== null && out.first_seen !== '') ? epochToDateTime(out.first_seen) : nowDateTime();
  out.last_seen = nowDateTime();

  // geo + misc defaults
  out.country = out.country ?? null;
  out.state = out.state ?? null;
  out.city = out.city ?? null;
  out.call_to_action = (out.call_to_action === undefined || out.call_to_action === null) ? '' : out.call_to_action;
  out.tags = out.tags ?? null;
  out.thumbnail = out.thumbnail ?? null;
  out.source = out.source ? String(out.source) : 'desktop';

  // verified flag
  out.verified = (out.verified !== undefined && out.verified !== null && out.verified !== '' && out.verified !== 0 && out.verified !== '0') ? 1 : 0;

  // othermedia parsed list (for VIDEO + SIDE carousel)
  out.othermedia_list = splitMultimedia(out.othermedia);

  return out;
}

module.exports = {
  urldecode, cleanStr, fixAmp, stripNonBmp, versionLessThan, splitMultimedia,
  checkGates, normalizeYoutubeAd,
};

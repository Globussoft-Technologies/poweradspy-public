'use strict';

/**
 * LinkedIn (lnAdsData) insertion — payload normalization + entry gates (pure, no I/O).
 *
 * Faithful port of adsDataController::adsdata() pre-insert coercions + version gates
 * (api_linkedin lines 157-334; see ../../../../KT-LINKEDIN-MIGRATION.md §5).
 *
 * Notes vs PHP:
 *   - type is normalized to UPPERCASE (Image→IMAGE, Video→VIDEO) so all DB/logic
 *     checks are canonical (PHP validates mixed-case but the type ENUM is uppercase).
 *   - post_date from epoch (intval(substr(.,0,10))) → 'YYYY-MM-DD HH:MM:SS';
 *     first_seen & last_seen are FORCED to now() (PHP: date('Y-m-d H:i:s', time())).
 */

const { epochToDateTime, nowDateTime, toInt } = require('../../../insertion/helpers/util');

function urldecode(s) {
  if (typeof s !== 'string') return s;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}
function cleanStr(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\n/g, '').replace(/\s\s+/g, ' ').trim();
}
function fixAmp(s) { return typeof s === 'string' ? s.replace(/&amp;/g, '&') : s; }
/** Strip 4-byte UTF-8 (emoji etc.) for utf8mb3 columns. */
function stripNonBmp(s) {
  if (s === undefined || s === null) return s;
  return String(s).replace(/[\u{10000}-\u{10FFFF}]/gu, '');
}
/** PHP str_replace("=v1:", "=v1%3A", ...) — re-encode the colon LinkedIn CDN appends. */
function fixV1Colon(s) { return typeof s === 'string' ? s.replace(/=v1:/g, '=v1%3A') : s; }

/** Numeric string with thousands separators → int (PHP str_replace(',','')). */
function toNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  return toInt(String(v).replace(/,/g, ''), 0);
}

function versionLessThan(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) { const da = pa[i] || 0; const db = pb[i] || 0; if (da !== db) return da < db; }
  return false;
}

/**
 * Entry gates from adsdata() (before the main insert):
 *   - version < 1.0.31  AND platform == 2                       → 400
 *   - platform != 2 AND version < 2.0.25 AND platform != 10
 *     AND platform != 3 AND ad_position == "SIDE"              → 400
 * @returns {{code,error?,message}|null} null = ok
 */
function checkGates(ad) {
  const p = String(ad.platform);
  if (p === '2' && ad.version !== undefined && versionLessThan(ad.version, '1.0.31')) {
    return { code: 400, error: 'Version is not allowed', message: 'Version Should be greater than 1.0.31' };
  }
  if (p !== '2' && p !== '10' && p !== '3' && String(ad.ad_position) === 'SIDE'
      && ad.version !== undefined && versionLessThan(ad.version, '2.0.25')) {
    return { code: 400, error: 'Version is not allowed', message: 'Version Should be greater than 2.0.25 for side ads' };
  }
  return null;
}

/** Split the "other_multimedia" blob (PHP: try '||,' then '||' then '|'). */
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

/**
 * Apply adsdata() INSERT-branch coercions to a copy of the payload. Returns a NEW object.
 */
function normalizeLinkedinAd(ad) {
  const out = { ...ad };
  for (const k of Object.keys(out)) if (typeof out[k] === 'string') out[k] = out[k].trim();

  // type → uppercase ENUM
  out.type = out.type ? String(out.type).toUpperCase() : out.type;

  // post_owner_image: "null" string → null, then urldecode + =v1 colon fix
  if (out.post_owner_image === 'null') out.post_owner_image = null;
  out.post_owner_image = out.post_owner_image ? fixV1Colon(urldecode(out.post_owner_image)) : null;

  // urldecoded text fields
  out.ad_text = out.ad_text ? urldecode(out.ad_text) : '';
  out.news_feed_description = out.news_feed_description ? urldecode(out.news_feed_description) : '';
  out.destination_url = out.destination_url ? urldecode(out.destination_url) : '';
  out.ad_title = out.ad_title ? urldecode(cleanStr(out.ad_title)) : '';
  out.ad_url = (out.ad_url !== undefined && out.ad_url !== null) ? urldecode(out.ad_url) : out.ad_url;
  out.post_owner = out.post_owner ? cleanStr(out.post_owner) : '';

  // image/video url: urldecode + =v1 colon fix + spaces → '+'
  out.image_video_url = out.image_video_url ? fixV1Colon(urldecode(out.image_video_url)).replace(/ /g, '+') : out.image_video_url;

  // variant text: amp fix + stripNonBmp (utf8mb3)
  out.ad_title = stripNonBmp(fixAmp(out.ad_title));
  out.ad_text = stripNonBmp(fixAmp(out.ad_text));
  out.news_feed_description = stripNonBmp(fixAmp(out.news_feed_description));

  // numerics
  out.likes = toNum(out.likes);
  out.comment = toNum(out.comment);
  out.followers = toNum(out.followers);
  out.lower_age = (out.lower_age === null || out.lower_age === undefined || out.lower_age === '') ? 23 : toInt(out.lower_age, 23);
  out.upper_age = (out.upper_age === null || out.upper_age === undefined || out.upper_age === '') ? 65 : toInt(out.upper_age, 65);

  // geo defaults
  out.country = out.country ?? '';
  out.state = out.state ?? '';
  out.city = out.city ?? '';

  // dates: post_date from epoch (10-digit) → datetime; first/last seen forced to now (PHP)
  out.post_date = (out.post_date !== undefined && out.post_date !== null && out.post_date !== '')
    ? epochToDateTime(out.post_date) : nowDateTime();
  out.first_seen = nowDateTime();
  out.last_seen = nowDateTime();

  // ad_category default ""
  out.ad_category = (out.ad_category === undefined || out.ad_category === null) ? '' : out.ad_category;

  // call_to_action default
  out.call_to_action = (out.call_to_action === undefined || out.call_to_action === null) ? '' : out.call_to_action;

  // other_multimedia parsed list (or null)
  out.other_multimedia_list = splitMultimedia(out.other_multimedia);

  // source default desktop
  out.source = out.source ? String(out.source) : 'desktop';

  return out;
}

module.exports = {
  urldecode, cleanStr, fixAmp, stripNonBmp, fixV1Colon, versionLessThan,
  checkGates, splitMultimedia, normalizeLinkedinAd,
};

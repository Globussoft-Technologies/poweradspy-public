'use strict';

/**
 * GTEXT (Google Text) insertion — payload normalization + gates (pure, no I/O).
 *
 * Faithful port of insertAdsFromPluginO() gates + insertNewGoogleTextAdsO() coercions
 * (see ../../../../KT-GTEXT-MIGRATION.md §1,§5). Note: last_seen is forced to now() (PHP).
 */

const { epochToDateTime, nowDateTime } = require('../../../insertion/helpers/util');

function urldecode(s) {
  if (typeof s !== 'string') return s;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}
function cleanStr(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\n/g, '').replace(/\s\s+/g, ' ').trim();
}
function fixAmp(s) { return typeof s === 'string' ? s.replace(/&amp;/g, '&') : s; }

/** Strip 4-byte UTF-8 (emoji etc.) for utf8mb3 columns — PHP stripNonBmp. */
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

/**
 * Entry gates from insertAdsFromPluginO (before validation):
 *   - IMAGE ad whose ad_image contains "gif" → 400.
 *   - version < 2.0.28 unless platform ∈ {3,4,10} → 400.
 *   - version == 4.0.3 AND platform ∈ {3,10} AND type IMAGE → 400.
 * @returns {{code,error?,message}|null} null = ok
 */
function checkGates(ad) {
  const p = String(ad.platform);
  if (ad.type === 'IMAGE' && typeof ad.ad_image === 'string' && ad.ad_image.includes('gif')) {
    return { code: 400, error: 'Invalid Image Type', message: `Image URL contains gif ${ad.ad_image}` };
  }
  const exempt = p === '3' || p === '4' || p === '10';
  if (ad.version !== undefined && versionLessThan(ad.version, '2.0.28') && !exempt) {
    return { code: 400, error: 'Version is not allowed', message: `Minimum Version Required: 2.0.28, Version Found: ${ad.version}` };
  }
  if (String(ad.version) === '4.0.3' && (p === '3' || p === '10') && ad.type === 'IMAGE') {
    return { code: 400, message: 'Not inserting ads for this Version' };
  }
  return null;
}

/**
 * Apply insertNewGoogleTextAdsO() coercions to a copy of the ad payload.
 * Returns a NEW object.
 */
function normalizeGtextAd(ad) {
  const out = { ...ad };
  for (const k of Object.keys(out)) if (typeof out[k] === 'string') out[k] = out[k].trim();

  out.ad_text = out.ad_text ? urldecode(out.ad_text) : '';
  out.ad_image = out.ad_image ? urldecode(out.ad_image) : '';
  out.post_owner = out.post_owner ? cleanStr(out.post_owner) : '';
  out.newsfeed_description = out.newsfeed_description ? urldecode(cleanStr(out.newsfeed_description)) : '';
  out.target_keyword = out.target_keyword ? urldecode(out.target_keyword) : '';
  out.destination_url = out.destination_url ? urldecode(out.destination_url) : '';
  out.g_temp_url = out.g_temp_url ? urldecode(out.g_temp_url) : '';
  out.ad_title = out.ad_title ? urldecode(cleanStr(out.ad_title)) : '';

  out.country = out.country ?? '';
  out.state = out.state ?? '';
  out.city = out.city ?? '';
  // dates: post_date/first_seen from epoch → 'YYYY-MM-DD HH:MM:SS'; last_seen forced to now (PHP).
  out.post_date = (out.post_date !== undefined && out.post_date !== null && out.post_date !== '') ? epochToDateTime(out.post_date) : nowDateTime();
  out.first_seen = (out.first_seen !== undefined && out.first_seen !== null && out.first_seen !== '') ? epochToDateTime(out.first_seen) : nowDateTime();
  out.last_seen = nowDateTime();
  // ad_image: spaces → '+' (CDN urls); empty → null
  out.ad_image = out.ad_image ? out.ad_image.replace(/ /g, '+') : null;
  out.ad_ranking = out.ad_ranking ?? '';

  // variant fields: amp fix + stripNonBmp (utf8mb3)
  out.ad_title = stripNonBmp(fixAmp(out.ad_title));
  out.ad_text = stripNonBmp(fixAmp(out.ad_text));
  out.newsfeed_description = stripNonBmp(fixAmp(out.newsfeed_description));
  out.target_keyword = stripNonBmp(fixAmp(out.target_keyword));

  return out;
}

module.exports = { urldecode, cleanStr, fixAmp, stripNonBmp, versionLessThan, checkGates, normalizeGtextAd };

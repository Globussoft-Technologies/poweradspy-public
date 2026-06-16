'use strict';

/**
 * GDN insertion — payload normalization (pure, no I/O).
 *
 * Faithful port of the coercion/decoding logic in insertNewGdnAds() + processAd()
 * (see ../../../../PHP-SPEC-gdn.md §2.2–2.3). Small pure functions, no DB/HTTP.
 *
 * NOTE: GDN's processAd() forces post_date/first_seen/last_seen to now() regardless
 * of payload — that override lives in the pipeline's row builder, not here.
 */

/** PHP urldecode — decode %XX and '+' → space. Tolerant of malformed input. */
function urldecode(s) {
  if (typeof s !== 'string') return s;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); }
  catch { return s; }
}

/** PHP cleanStr: strip newlines + collapse whitespace runs, then trim. */
function cleanStr(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\n/g, '').replace(/\s\s+/g, ' ').trim();
}

/** PHP `&amp;` → `&` (variant title/text/newsfeed). */
function fixAmp(s) {
  return typeof s === 'string' ? s.replace(/&amp;/g, '&') : s;
}

/** PHP version_compare(a,b,'<') — true when a < b. */
function versionLessThan(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0; const db = pb[i] || 0;
    if (da !== db) return da < db;
  }
  return false;
}

/**
 * Version gate (insertAds §2): version must be >= "1.0.0" unless platform ∈ {3,4,10}.
 * @returns {{code:number, error:string, message:string} | null} null = ok
 */
function checkVersion(platform, version) {
  const p = String(platform);
  const exempt = p === '3' || p === '4' || p === '10';
  if (version !== undefined && versionLessThan(version, '1.0.0') && !exempt) {
    return {
      code: 400,
      error: 'Version is not allowed',
      message: `Minimum Version Required: 1.0.0, Version Found: ${version}`,
    };
  }
  return null;
}

/**
 * Apply insertNewGdnAds()/processAd() normalization to a copy of the ad payload.
 * Returns a NEW object (does not mutate input).
 */
function normalizeGdnAd(ad) {
  const out = { ...ad };

  // trim every scalar (PHP array_map trim)
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string') out[k] = out[k].trim();
  }

  // urldecode + cleanStr (PHP insertNewGdnAds)
  out.ad_text = out.ad_text ? urldecode(out.ad_text) : '';
  out.post_owner = out.post_owner ? cleanStr(out.post_owner) : '';
  out.newsfeed_description = out.newsfeed_description ? urldecode(cleanStr(out.newsfeed_description)) : '';
  out.destination_url = out.destination_url ? urldecode(out.destination_url) : '';
  out.ad_title = out.ad_title ? urldecode(cleanStr(out.ad_title)) : '';

  // location / ip defaults
  out.country = out.country ?? '';
  out.state = out.state ?? '';
  out.city = out.city ?? '';
  out.ip_address = out.ip_address ?? '';

  // variant amp fix (PHP processAd builds the variant with &amp;→&)
  out.ad_title = fixAmp(out.ad_title);
  out.ad_text = fixAmp(out.ad_text);
  out.newsfeed_description = fixAmp(out.newsfeed_description);

  // redirect_url: trim "" → null
  out.redirect_url = (out.redirect_url !== undefined && String(out.redirect_url).trim() !== '') ? out.redirect_url : null;

  // perceptual hash (dhash) for near-dup detection — keep only a clean 16-hex string, else null
  out.phash = (typeof out.phash === 'string' && /^[0-9a-f]{16}$/i.test(out.phash.trim()))
    ? out.phash.trim().toLowerCase()
    : null;

  return out;
}

module.exports = { urldecode, cleanStr, fixAmp, versionLessThan, checkVersion, normalizeGdnAd };

'use strict';

const URL_DECODE_FIELDS = ['ad_text', 'newsfeed_description', 'destination_url', 'ad_title', 'post_owner_image'];

function urldecode(s) {
  if (typeof s !== 'string') return s;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

function cleanStr(s) {
  if (typeof s !== 'string') return s;
  return s.trim().replace(/\s\s+/g, ' ').replace(/\n/g, '');
}

function fixAmp(s) {
  return typeof s === 'string' ? s.replace(/&amp;/g, '&') : s;
}

function nowDateTime() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function epochToDateTime(v) {
  if (v === undefined || v === null || v === '') return nowDateTime();
  const epoch = parseInt(String(v).slice(0, 10), 10);
  if (!Number.isFinite(epoch) || epoch <= 0) return nowDateTime();
  const d = new Date(epoch * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function versionLessThan(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da < db;
  }
  return false;
}

// PHP: platforms 4, 10, 3 skip version check; all others need >= 1.0.0
function checkVersion(platform, version) {
  const p = String(platform);
  if (p === '4' || p === '10' || p === '3') return null;
  if (versionLessThan(version, '1.0.0')) {
    return { code: 400, error: 'Version is not allowed', message: `Minimum Version Required: 1.0.0, Version Found: ${version}` };
  }
  return null;
}

function normalizeNativeAd(ad) {
  const out = { ...ad };

  // network: ucfirst(strtolower)
  if (typeof out.network === 'string') {
    out.network = out.network.charAt(0).toUpperCase() + out.network.slice(1).toLowerCase();
  }

  // urldecode URL-encoded fields
  for (const f of URL_DECODE_FIELDS) {
    if (out[f] !== undefined && out[f] !== null) out[f] = urldecode(out[f]);
  }

  // cleanStr + text defaults
  out.ad_text            = fixAmp(cleanStr(out.ad_text ?? ''));
  out.ad_title           = fixAmp(cleanStr(out.ad_title ?? ''));
  out.newsfeed_description = fixAmp(cleanStr(out.newsfeed_description ?? ''));
  out.post_owner         = cleanStr(out.post_owner ?? '');
  out.destination_url    = out.destination_url ?? '';

  // timestamps → 'YYYY-MM-DD HH:MM:SS'
  out.post_date  = epochToDateTime(out.post_date);
  out.first_seen = epochToDateTime(out.first_seen);
  out.last_seen  = epochToDateTime(out.last_seen);

  // location defaults
  out.country    = out.country    ?? '';
  out.state      = out.state      ?? '';
  out.city       = out.city       ?? '';
  out.ip_address = out.ip_address ?? '';

  // If IMAGE type and no ad_image, fall back to image_url_original (PHP line 170-171)
  if (out.type !== 'TEXT' && (!out.ad_image || out.ad_image === null)) {
    out.ad_image = out.image_url_original ?? null;
  }

  // phash: keep only a clean 16-hex perceptual dhash (lowercased); otherwise null
  out.phash = (typeof out.phash === 'string' && /^[0-9a-f]{16}$/i.test(out.phash.trim()))
    ? out.phash.trim().toLowerCase()
    : null;

  return out;
}

module.exports = { urldecode, cleanStr, fixAmp, nowDateTime, epochToDateTime, versionLessThan, checkVersion, normalizeNativeAd };

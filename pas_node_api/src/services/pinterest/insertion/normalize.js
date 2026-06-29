'use strict';

/**
 * Pinterest insertion — payload normalization (pure, no I/O).
 * Key Pinterest differences vs Native:
 *   - type is 'Image' or 'Video' (not IMAGE/TEXT)
 *   - post_date is milliseconds → divide by 1000 before formatting
 *   - first_seen / last_seen default to now() (not from payload)
 *   - target_keyword is urldecoded
 *   - media URLs can be multiple, separated by ||, ||, or |
 */

const { sanitizePayload } = require('../../../insertion/helpers/util');

const URL_DECODE_FIELDS = ['ad_text', 'newsfeed_description', 'destination_url', 'ad_title', 'target_keyword'];

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

// PHP: date('Y-m-d H:i:s', $postData["post_date"] / 1000) — post_date is in milliseconds
function msToDateTime(v) {
  if (v === undefined || v === null || v === '') return nowDateTime();
  const ms = parseInt(String(v), 10);
  if (!Number.isFinite(ms) || ms <= 0) return nowDateTime();
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Parse media URL string into an array.
 * PHP explodeMediaUrl: splits by '||,' then '||' then '|' then ' '.
 */
function explodeMediaUrl(v) {
  if (!v || typeof v !== 'string') return [];
  if (v.includes('||,')) return v.split('||,').map((s) => s.trim()).filter(Boolean);
  if (v.includes('||'))  return v.split('||').map((s) => s.trim()).filter(Boolean);
  if (v.includes('|'))   return v.split('|').map((s) => s.trim()).filter(Boolean);
  return [v.trim()].filter(Boolean);
}

/**
 * Parse other_multimedia field into an array of URLs.
 */
function parseOtherMultimedia(value) {
  if (value === undefined || value === null || String(value).trim() === '') return { present: false, images: [] };
  const images = explodeMediaUrl(String(value)).filter((x) => x.length > 0);
  return { present: images.length > 0, images };
}

function normalizePinterestAd(ad) {
  const out = sanitizePayload({ ...ad });

  // Normalize type to uppercase for DB ENUM('IMAGE','VIDEO')
  // Accepts: Image, Video, IMAGE, VIDEO, image, video
  if (out.type) out.type = String(out.type).toUpperCase();

  // URL-decode fields
  for (const f of URL_DECODE_FIELDS) {
    if (out[f] !== undefined && out[f] !== null) out[f] = urldecode(out[f]);
  }

  // cleanStr + amp-fix
  out.ad_text             = fixAmp(cleanStr(out.ad_text            ?? ''));
  out.ad_title            = fixAmp(cleanStr(out.ad_title           ?? ''));
  out.newsfeed_description = fixAmp(cleanStr(out.newsfeed_description ?? ''));
  out.post_owner          = cleanStr(out.post_owner ?? '');
  out.target_keyword      = out.target_keyword ?? '';
  out.destination_url     = out.destination_url ?? '';

  // post_date: PHP uses milliseconds → divide by 1000
  out.post_date  = msToDateTime(out.post_date);
  // first_seen and last_seen default to now (PHP: date('Y-m-d H:i:s', time()))
  out.first_seen = nowDateTime();
  out.last_seen  = nowDateTime();

  // location defaults
  out.country    = out.country    ?? '';
  out.state      = out.state      ?? '';
  out.city       = out.city       ?? '';
  out.ip_address = out.ip_address ?? '';

  return out;
}

module.exports = { urldecode, cleanStr, fixAmp, nowDateTime, msToDateTime, explodeMediaUrl, parseOtherMultimedia, normalizePinterestAd };

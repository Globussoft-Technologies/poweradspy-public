'use strict';

/**
 * Instagram insertion — payload normalization (pure). Mirrors Facebook's coercions
 * (urldecode, =v1: fix, &amp; fix, other_multimedia split). Dates are handled in the pipeline.
 */

const { sanitizePayload } = require('../../../insertion/helpers/util');

const URL_DECODE_FIELDS = ['ad_text', 'news_feed_description', 'destination_url', 'initial_url', 'image_video_url', 'ad_title', 'post_owner_image', 'ad_url', 'meta_ad_url'];

function urldecode(s) {
  if (typeof s !== 'string') return s;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

function fixAmp(s) { return typeof s === 'string' ? s.replace(/&amp;/g, '&') : s; }

/** other_multimedia → array (split by ||, / || / |), trailing empties dropped. */
function parseOtherMultimedia(value) {
  if (value === undefined || value === null || String(value).trim() === '') return { present: false, images: [] };
  const s = String(value);
  let parts;
  if (s.includes('||,')) parts = s.split('||,');
  else if (s.includes('||')) parts = s.split('||');
  else if (s.includes('|')) parts = s.split('|');
  else parts = [s];
  const images = parts.map((x) => x.trim()).filter((x) => x.length > 0);
  return { present: images.length > 0, images };
}

/** Apply common decode/coercions; returns a NEW object. */
function normalizeInsta(ad) {
  const out = sanitizePayload({ ...ad });
  if (out.post_owner_image === 'null') out.post_owner_image = null;
  for (const f of URL_DECODE_FIELDS) {
    if (out[f] !== undefined && out[f] !== null) out[f] = urldecode(out[f]);
  }
  for (const f of ['image_video_url', 'post_owner_image']) {
    if (typeof out[f] === 'string') out[f] = out[f].replace(/=v1:/g, '=v1%3A');
  }
  out.ad_title = fixAmp(out.ad_title ?? '');
  out.ad_text = fixAmp(out.ad_text ?? '');
  out.news_feed_description = fixAmp(out.news_feed_description ?? '');
  if (out.meta_ad_id === undefined || out.meta_ad_id === null || out.meta_ad_id === '') out.meta_ad_id = null;
  if (out.views === undefined || out.views === null || out.views === '') out.views = 0;
  return out;
}

module.exports = { urldecode, fixAmp, parseOtherMultimedia, normalizeInsta, URL_DECODE_FIELDS };

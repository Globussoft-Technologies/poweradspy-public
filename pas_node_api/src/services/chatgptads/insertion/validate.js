'use strict';

/**
 * ChatGPT Ads insertion — payload validation.
 *
 * Rules are designed from the one real sample payload (MANIFEST §1), not ported from PHP —
 * this network has no legacy. The rule-engine shape (CHECKS/validate below) is a direct copy
 * of facebook's own (src/services/facebook/insertion/validate.js) — not imported from a shared
 * location, matching MANIFEST.md §7's self-contained-per-network architecture rule ("do NOT
 * try to parameterize one network from another" / "copy + adjust"). If this generic engine is
 * ever promoted to a real shared helper, update both copies at once — not done here to avoid
 * touching facebook's files for a change nobody asked for.
 *
 * image_video_url/image_url_original are deliberately `present|nullable` here, not
 * `required` — unlike facebook's single ad_image field, this payload can have the image
 * under either key (or, for a future VIDEO ad, under neither — gated by thumbnail_url
 * instead). The "at least one image/thumbnail present for this type" check is NOT
 * declarative — it lives in the pipeline, mirroring facebook adsLibraryPipeline.js's own
 * extra non-rule-engine VIDEO-thumbnail check.
 */

const { validationError } = require('../../../insertion/helpers/responses');

const CHATGPTADS_RULES = {
  type: 'required|in:IMAGE,VIDEO',
  ad_id: 'required',
  platform: 'required',
  post_owner: 'required|string',
  post_owner_image: 'present|nullable',
  ad_title: 'present|string|nullable',
  ad_text: 'present|string|nullable',
  newsfeed_description: 'present|string|nullable',
  news_feed_description: 'present|string|nullable',
  destination_url: 'nullable',
  ad_position: 'present|string|nullable',
  // country may be a single string OR an array of strings (multiple countries seen for the
  // same ad) — see normalize.js's n.countries / chatgptadsPipeline.js's per-country upsert.
  country: 'present|arrayOrString|nullable',
  version: 'present|nullable',
  uid: 'present|nullable',
  image_video_url: 'present|nullable|url',
  image_url_original: 'present|nullable|url',
  // UNCONFIRMED field name (see normalize.js) — validated leniently until a real sample exists.
  thumbnail_url: 'present|nullable|url',
  other_multimedia: 'present|nullable',
  first_seen: 'required|epoch',
  last_seen: 'required|epoch',
};

// ── Rule engine (copy of facebook's — see file header) ─────────────────────────

function isNullLike(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') { const t = v.trim(); return t === '' || t.toLowerCase() === 'null'; }
  return false;
}
function normalizeNullLike(v) { return isNullLike(v) ? null : v; }

const isMissing = (v) => v === undefined;
const isEmpty = (v) => isNullLike(v) || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '');

function isUrl(v) {
  try { new URL(String(v)); return true; } catch { return false; }
}

const CHECKS = {
  required: (v, _a, f) => (isMissing(v) || isEmpty(v) ? `The ${f} field is required.` : null),
  present: (v, _a, f) => (isMissing(v) ? `The ${f} field must be present.` : null),
  array: (v, _a, f) => (!isMissing(v) && v !== null && !Array.isArray(v) ? `The ${f} must be an array.` : null),
  string: (v, _a, f) => (!isMissing(v) && v !== null && typeof v !== 'string' ? `The ${f} must be a string.` : null),
  integer: (v, _a, f) =>
    isMissing(v) || v === null || !Number.isInteger(Number(v)) || String(v).trim() === '' ? `The ${f} must be an integer.` : null,
  url: (v, _a, f) => (!isMissing(v) && v !== null && !isUrl(v) ? `The ${f} format is invalid.` : null),
  epoch: (v, _a, f) =>
    isMissing(v) || v === null || String(v).trim() === '' || !/^\d+$/.test(String(v)) || Number(v) <= 0
      ? `The ${f} must be a valid epoch timestamp.`
      : null,
  in: (v, arg, f) => (!isMissing(v) && v !== null && !arg.split(',').includes(String(v)) ? `The selected ${f} is invalid.` : null),
  arrayOrString: (v, _a, f) => {
    if (isMissing(v) || v === null) return null;
    if (typeof v === 'string') return null;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return null;
    return `The ${f} must be a string or an array of strings.`;
  },
};

function validate(data, rules) {
  const errors = [];
  for (const [field, ruleStr] of Object.entries(rules)) {
    const tokens = ruleStr.split('|');
    let value = data[field];
    if (Array.isArray(value)) value = value.map(normalizeNullLike).filter((v) => !isNullLike(v));
    else if (typeof value === 'string') value = normalizeNullLike(value);

    const nullable = tokens.includes('nullable');
    if (nullable && (value === null || value === undefined)) continue;

    for (const token of tokens) {
      if (token === 'nullable') continue;
      const [name, arg] = token.split(':');
      const check = CHECKS[name];
      if (!check) continue;
      const err = check(value, arg, field);
      if (err) { errors.push(err); break; }
    }
  }
  return errors.length ? validationError(errors) : { code: 200 };
}

const validateChatgptAd = (data) => validate(data, CHATGPTADS_RULES);

module.exports = { validate, validateChatgptAd, CHATGPTADS_RULES };

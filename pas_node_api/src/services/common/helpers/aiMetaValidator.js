'use strict';

/**
 * AI-Meta payload validator — enforces AI_META_API_PAYLOAD_SPEC.md v1.5 (2026-07-10).
 *
 * Pure/synchronous: takes the raw `ai_meta` object and returns
 *   { errors: [{ field, message }], normalized: {…}, storedFields: [...] }
 * `normalized` is the cleaned object safe to write onto the ad's ES `ai` field.
 * `storedFields` lists the ai_meta keys that survived validation (for the response).
 *
 * v1.5 field set (8 core + colors/category/sub_category):
 *   ad_type, intent, hook, offering_type, offers, offering, caption, roa,
 *   colors, category, sub_category.
 *
 * Lineage vs the old v1.1 shape this file used to enforce:
 *   - `product_type` → `offering_type` (enum shrank to product|service|both).  [v1.4]
 *   - `reason` → `roa` (per-field model justification object).                  [v1.4]
 *   - added `caption` (plain description of the image).                         [v1.4]
 *   - `colors` is a fixed 16-value HEX palette (0–3), not the named-word vocab. [v1.2]
 *   - removed `object`, `language`, `ocr`, `brand_logos`, `status`,            [v1.2–1.4]
 *     and `brand` + `celebrity`.                                               [v1.5]
 * With `status` gone there is no more partial/failed relaxation — every payload is a
 * completed enrichment, so the core fields (ad_type, intent, hook, offering_type) are
 * ALWAYS required. `roa` self-explaining fallback strings are ordinary values (no special rule).
 */

const ENUMS = {
  ad_type: ['testimonial', 'ugc', 'before_after', 'demonstration', 'comparison', 'problem_solution', 'explainer', 'listicle', 'promotional', 'lifestyle', 'educational', 'announcement', 'storytelling', 'carousel', 'meme', 'other'],
  intent: ['awareness', 'consideration', 'conversion', 'lead_generation', 'traffic', 'app_install', 'engagement', 'retargeting', 'community_building', 'recruitment', 'other'],
  hook: ['scarcity', 'urgency', 'social_proof', 'authority', 'fear', 'curiosity', 'discount', 'pain_point', 'aspiration', 'transformation', 'convenience', 'novelty', 'fomo', 'comparison', 'emotion', 'other'],
  offering_type: ['product', 'service', 'both'],
  offer_type: ['percentage_discount', 'flat_discount', 'free_trial', 'free_shipping', 'buy_one_get_one', 'bundle_offer', 'coupon', 'cashback', 'financing', 'consultation', 'demo', 'limited_time_offer', 'other'],
  // Fixed 16-value hex palette (deterministically snapped from the image's pixels).
  colors: ['#000000', '#FFFFFF', '#808080', '#C0C0C0', '#E03131', '#F76707', '#F2CC0C', '#2F9E44', '#0CA678', '#1971C2', '#1E3A5F', '#7048E8', '#E64980', '#8B5E34', '#C9A227', '#E8D8B0'],
};

// value required (numeric) for these offer types; every other type must be null.
const OFFER_VALUE_REQUIRED = ['percentage_discount', 'flat_discount'];

// roa (reasoning-of-action) sub-fields — the only keys accepted inside `roa`.
const ROA_FIELDS = ['intent', 'hook', 'offering_type', 'offering'];

// Control chars never allowed in free-text fields (excludes \t; newline handled per-field).
const CTRL_WITH_NL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x0A]/;

function isPlainString(v) { return typeof v === 'string'; }

/**
 * Validate a multi-label enum array field (intent/hook). Order preserved.
 * @returns cleaned array (only when no errors for this field), else undefined
 */
function validateEnumArray(errors, base, key, arr, allowed, { min = 1, max = 5 } = {}) {
  if (!Array.isArray(arr)) {
    errors.push({ field: `${base}.${key}`, message: `${key} must be an array` });
    return undefined;
  }
  if (arr.length < min) {
    errors.push({ field: `${base}.${key}`, message: `${key} must contain at least ${min} element${min === 1 ? '' : 's'}` });
  }
  if (arr.length > max) {
    errors.push({ field: `${base}.${key}`, message: `${key} exceeds the max of ${max} items` });
  }
  const seen = new Set();
  let hadErr = arr.length < min || arr.length > max;
  arr.forEach((el, i) => {
    if (!allowed.includes(el)) {
      errors.push({ field: `${base}.${key}[${i}]`, message: `'${el}' is not in the allowed enum` });
      hadErr = true;
    } else if (seen.has(el)) {
      errors.push({ field: `${base}.${key}[${i}]`, message: `duplicate value '${el}'` });
      hadErr = true;
    }
    seen.add(el);
  });
  return hadErr ? undefined : arr.slice();
}

/**
 * Validate the hex `colors` array against the fixed 16-value palette (0–3 items,
 * most-dominant first, no dupes). Hex is compared case-insensitively and normalised
 * to the palette's canonical uppercase form.
 */
function validateColors(errors, base, arr) {
  if (!Array.isArray(arr)) {
    errors.push({ field: `${base}.colors`, message: 'colors must be an array' });
    return undefined;
  }
  if (arr.length > 3) {
    errors.push({ field: `${base}.colors`, message: 'colors exceeds the max of 3 items' });
  }
  const upper = new Map(ENUMS.colors.map((c) => [c.toUpperCase(), c]));
  const seen = new Set();
  let hadErr = arr.length > 3;
  const cleaned = [];
  arr.forEach((el, i) => {
    const canon = isPlainString(el) ? upper.get(el.trim().toUpperCase()) : undefined;
    if (!canon) {
      errors.push({ field: `${base}.colors[${i}]`, message: `'${el}' is not in the allowed hex palette` });
      hadErr = true;
      return;
    }
    if (seen.has(canon)) {
      errors.push({ field: `${base}.colors[${i}]`, message: `duplicate value '${el}'` });
      hadErr = true;
    }
    seen.add(canon);
    cleaned.push(canon);
  });
  return hadErr ? undefined : cleaned;
}

function validateOffers(errors, base, offers) {
  if (!Array.isArray(offers)) {
    errors.push({ field: `${base}.offers`, message: 'offers must be an array' });
    return undefined;
  }
  if (offers.length === 0) {
    errors.push({ field: `${base}.offers`, message: 'offers, if present, must be a non-empty array (omit it when there is no offer)' });
    return undefined;
  }
  if (offers.length > 3) {
    errors.push({ field: `${base}.offers`, message: 'offers exceeds the max of 3 items' });
  }
  let hadErr = offers.length > 3;
  const cleaned = [];

  offers.forEach((o, i) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      errors.push({ field: `${base}.offers[${i}]`, message: 'each offer must be an object' });
      hadErr = true;
      return;
    }
    if (!ENUMS.offer_type.includes(o.type)) {
      errors.push({ field: `${base}.offers[${i}].type`, message: `'${o.type}' is not in the allowed offer type enum` });
      hadErr = true;
      return;
    }
    let value = o.value === undefined ? null : o.value;
    if (OFFER_VALUE_REQUIRED.includes(o.type)) {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push({ field: `${base}.offers[${i}].value`, message: `value is required and must be a number for ${o.type}` });
        hadErr = true;
      } else if (o.type === 'percentage_discount' && (value < 0 || value > 100)) {
        errors.push({ field: `${base}.offers[${i}].value`, message: 'value must be between 0 and 100 for percentage_discount' });
        hadErr = true;
      } else if (value < 0) {
        errors.push({ field: `${base}.offers[${i}].value`, message: 'value must be >= 0' });
        hadErr = true;
      }
    } else {
      // Every other offer type must carry a null value (spec §3.5).
      value = null;
    }
    cleaned.push({ type: o.type, value });
  });

  return hadErr ? undefined : cleaned;
}

function validateSingleEnum(errors, base, key, val, allowed, required) {
  if (val === undefined || val === null || val === '') {
    if (required) errors.push({ field: `${base}.${key}`, message: `${key} is required` });
    return undefined;
  }
  if (!allowed.includes(val)) {
    errors.push({ field: `${base}.${key}`, message: `'${val}' is not in the allowed ${key} enum` });
    return undefined;
  }
  return val;
}

/**
 * Validate a free-text field. Empty/whitespace is treated as "omit" (returns undefined
 * with no error) because the pipeline omits empty free-text rather than sending "".
 */
function validateText(errors, base, key, val, { maxLen }) {
  if (val === undefined || val === null) return undefined;
  if (!isPlainString(val)) {
    errors.push({ field: `${base}.${key}`, message: `${key} must be a string` });
    return undefined;
  }
  if (val.trim() === '') return undefined;
  if (val.length > maxLen) {
    errors.push({ field: `${base}.${key}`, message: `${key} exceeds the max length of ${maxLen}` });
    return undefined;
  }
  if (CTRL_WITH_NL.test(val)) {
    errors.push({ field: `${base}.${key}`, message: `${key} contains disallowed control characters` });
    return undefined;
  }
  return val;
}

/** Validate the `roa` object — only the 4 known sub-fields, each ≤200 chars, empties dropped. */
function validateRoa(errors, base, roa) {
  if (roa === undefined || roa === null) return undefined;
  if (typeof roa !== 'object' || Array.isArray(roa)) {
    errors.push({ field: `${base}.roa`, message: 'roa must be an object' });
    return undefined;
  }
  const out = {};
  for (const f of ROA_FIELDS) {
    const v = validateText(errors, `${base}.roa`, f, roa[f], { maxLen: 200 });
    if (v !== undefined) out[f] = v;
  }
  // Whole object omitted if all four sub-fields ended up empty.
  return Object.keys(out).length ? out : undefined;
}

/**
 * @param {object} aiMeta  raw ai_meta object
 * @param {string} [base='ai_meta'] field-path prefix for error messages
 * @returns {{ errors: Array<{field,message}>, normalized: object, storedFields: string[] }}
 */
function validateAiMeta(aiMeta, base = 'ai_meta') {
  const errors = [];
  const normalized = {};

  if (!aiMeta || typeof aiMeta !== 'object' || Array.isArray(aiMeta)) {
    errors.push({ field: base, message: 'ai_meta must be an object' });
    return { errors, normalized, storedFields: [] };
  }

  // ── Required core (no status → always required) ─────────────────────
  const adType = validateSingleEnum(errors, base, 'ad_type', aiMeta.ad_type, ENUMS.ad_type, true);
  if (adType !== undefined) normalized.ad_type = adType;

  const offeringType = validateSingleEnum(errors, base, 'offering_type', aiMeta.offering_type, ENUMS.offering_type, true);
  if (offeringType !== undefined) normalized.offering_type = offeringType;

  const intent = validateEnumArray(errors, base, 'intent', aiMeta.intent ?? [], ENUMS.intent, { min: 1, max: 5 });
  if (intent !== undefined) normalized.intent = intent;

  const hook = validateEnumArray(errors, base, 'hook', aiMeta.hook ?? [], ENUMS.hook, { min: 1, max: 5 });
  if (hook !== undefined) normalized.hook = hook;

  // ── Optional fields (validated only if present) ─────────────────────
  if (aiMeta.offers !== undefined) {
    const offers = validateOffers(errors, base, aiMeta.offers);
    if (offers !== undefined) normalized.offers = offers;
  }
  if (aiMeta.colors !== undefined) {
    const colors = validateColors(errors, base, aiMeta.colors);
    if (colors !== undefined) normalized.colors = colors;
  }

  const offering = validateText(errors, base, 'offering', aiMeta.offering, { maxLen: 200 });
  if (offering !== undefined) normalized.offering = offering;

  const caption = validateText(errors, base, 'caption', aiMeta.caption, { maxLen: 200 });
  if (caption !== undefined) normalized.caption = caption;

  const roa = validateRoa(errors, base, aiMeta.roa);
  if (roa !== undefined) normalized.roa = roa;

  if (aiMeta.category !== undefined && aiMeta.category !== null) {
    if (isPlainString(aiMeta.category)) normalized.category = aiMeta.category;
    else errors.push({ field: `${base}.category`, message: 'category must be a string' });
  }
  if (aiMeta.sub_category !== undefined && aiMeta.sub_category !== null) {
    if (isPlainString(aiMeta.sub_category)) normalized.sub_category = aiMeta.sub_category;
    else errors.push({ field: `${base}.sub_category`, message: 'sub_category must be a string' });
  }

  const storedFields = Object.keys(normalized);
  return { errors, normalized, storedFields };
}

module.exports = { validateAiMeta, ENUMS };

'use strict';

/**
 * AI-Meta payload validator — enforces AI_META_API_PAYLOAD_SPEC.md v1.1.
 *
 * Pure/synchronous: takes the raw `ai_meta` object and returns
 *   { errors: [{ field, message }], normalized: {…}, storedFields: [...] }
 * `normalized` is the cleaned object safe to write onto the ad's ES `ai` field.
 * `storedFields` lists the ai_meta keys that survived validation (for the response).
 *
 * Per spec §3.15 + product decision: the "required" fields (ad_type, intent, hook,
 * product_type, language) are only enforced when status is `success` or `partial`.
 * For `failed`/`queued` only `status` is required; any other present fields are still
 * format-checked. This resolves the §3 (Required: Yes) vs §3.15 ("failed may be mostly
 * empty") contradiction.
 */

const ENUMS = {
  ad_type: ['testimonial', 'ugc', 'before_after', 'demonstration', 'comparison', 'problem_solution', 'explainer', 'listicle', 'promotional', 'lifestyle', 'educational', 'announcement', 'storytelling', 'carousel', 'meme', 'other'],
  intent: ['awareness', 'consideration', 'conversion', 'lead_generation', 'traffic', 'app_install', 'engagement', 'retargeting', 'community_building', 'recruitment', 'other'],
  hook: ['scarcity', 'urgency', 'social_proof', 'authority', 'fear', 'curiosity', 'discount', 'pain_point', 'aspiration', 'transformation', 'convenience', 'novelty', 'fomo', 'comparison', 'emotion', 'other'],
  product_type: ['physical_product', 'digital_product', 'service', 'software', 'subscription', 'course', 'event', 'job_opportunity', 'donation', 'other'],
  offer_type: ['percentage_discount', 'flat_discount', 'free_trial', 'free_shipping', 'buy_one_get_one', 'bundle_offer', 'coupon', 'cashback', 'financing', 'consultation', 'demo', 'limited_time_offer', 'other'],
  language: ['en', 'hi', 'es', 'fr', 'de', 'pt', 'ar', 'zh', 'ja', 'ko', 'ru', 'other'],
  colors: ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'black', 'white', 'gray', 'brown', 'gold', 'silver', 'multicolor'],
  status: ['success', 'partial', 'failed', 'queued'],
};

// value required (and numeric) for these offer types
const OFFER_VALUE_REQUIRED = ['percentage_discount', 'flat_discount'];

// Control chars that are never allowed. \n (\x0A) is allowed in `ocr` (layout meaning);
// `offering` disallows newlines too. This set excludes \n and \t.
const CTRL_NO_NL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
const CTRL_WITH_NL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x0A]/;

function isPlainString(v) { return typeof v === 'string'; }
function nonEmpty(v) { return isPlainString(v) && v.trim() !== ''; }

/**
 * Validate a multi-label enum array field.
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
 * Validate an open-vocabulary string array (object, celebrity, brand_logos).
 */
function validateStringArray(errors, base, key, arr, { max, lower = false } = {}) {
  if (!Array.isArray(arr)) {
    errors.push({ field: `${base}.${key}`, message: `${key} must be an array` });
    return undefined;
  }
  if (max != null && arr.length > max) {
    errors.push({ field: `${base}.${key}`, message: `${key} exceeds the max of ${max} items` });
  }
  const seen = new Set();
  let hadErr = max != null && arr.length > max;
  arr.forEach((el, i) => {
    if (!nonEmpty(el)) {
      errors.push({ field: `${base}.${key}[${i}]`, message: `must be a non-empty string` });
      hadErr = true;
      return;
    }
    const norm = lower ? el.trim().toLowerCase() : el.trim();
    if (seen.has(norm)) {
      errors.push({ field: `${base}.${key}[${i}]`, message: `duplicate value '${el}'` });
      hadErr = true;
    }
    seen.add(norm);
  });
  return hadErr ? undefined : arr.map((el) => (lower ? String(el).trim().toLowerCase() : String(el).trim()));
}

function validateOffers(errors, base, offers) {
  if (!Array.isArray(offers)) {
    errors.push({ field: `${base}.offers`, message: 'offers must be an array' });
    return undefined;
  }
  if (offers.length === 0) {
    errors.push({ field: `${base}.offers`, message: 'offers, if present, must be a non-empty array' });
    return undefined;
  }
  if (offers.length > 3) {
    errors.push({ field: `${base}.offers`, message: 'offers exceeds the max of 3 items' });
  }
  let hadErr = offers.length > 3;
  const cleaned = [];
  // duplicate type allowed only if value differs
  const seen = new Map(); // type -> Set of values

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
    let value = o.value;
    const needsValue = OFFER_VALUE_REQUIRED.includes(o.type);
    if (value === undefined) value = null;
    if (needsValue) {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push({ field: `${base}.offers[${i}].value`, message: `value is required and must be a number for ${o.type}` });
        hadErr = true;
      } else if (value < 0) {
        errors.push({ field: `${base}.offers[${i}].value`, message: 'value must be >= 0' });
        hadErr = true;
      } else if (o.type === 'percentage_discount' && (value < 0 || value > 100)) {
        errors.push({ field: `${base}.offers[${i}].value`, message: 'value must be between 0 and 100 for percentage_discount' });
        hadErr = true;
      }
    } else if (value !== null) {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push({ field: `${base}.offers[${i}].value`, message: 'value must be a number or null' });
        hadErr = true;
      } else if (value < 0) {
        errors.push({ field: `${base}.offers[${i}].value`, message: 'value must be >= 0' });
        hadErr = true;
      }
    }

    // duplicate type only allowed with differing value
    const vals = seen.get(o.type) || new Set();
    if (vals.has(value)) {
      errors.push({ field: `${base}.offers[${i}]`, message: `duplicate offer type '${o.type}' with identical value` });
      hadErr = true;
    }
    vals.add(value);
    seen.set(o.type, vals);

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

function validateText(errors, base, key, val, { maxLen, allowNl }) {
  if (val === undefined || val === null) return undefined;
  if (!isPlainString(val)) {
    errors.push({ field: `${base}.${key}`, message: `${key} must be a string` });
    return undefined;
  }
  if (val.length > maxLen) {
    errors.push({ field: `${base}.${key}`, message: `${key} exceeds the max length of ${maxLen}` });
    return undefined;
  }
  const ctrl = allowNl ? CTRL_NO_NL : CTRL_WITH_NL;
  if (ctrl.test(val)) {
    errors.push({ field: `${base}.${key}`, message: `${key} contains disallowed control characters` });
    return undefined;
  }
  return val;
}

/**
 * @param {object} aiMeta  raw ai_meta object
 * @param {string} [base='ai_meta'] field-path prefix for error messages
 * @returns {{ errors: Array<{field,message}>, normalized: object, storedFields: string[], status: string|undefined }}
 */
function validateAiMeta(aiMeta, base = 'ai_meta') {
  const errors = [];
  const normalized = {};

  if (!aiMeta || typeof aiMeta !== 'object' || Array.isArray(aiMeta)) {
    errors.push({ field: base, message: 'ai_meta must be an object' });
    return { errors, normalized, storedFields: [], status: undefined };
  }

  // status is always required and drives the required-fields relaxation.
  const status = validateSingleEnum(errors, base, 'status', aiMeta.status, ENUMS.status, true);
  const requireCore = status === 'success' || status === 'partial';

  // Single-label required enums (relaxed for failed/queued)
  const adType = validateSingleEnum(errors, base, 'ad_type', aiMeta.ad_type, ENUMS.ad_type, requireCore);
  if (adType !== undefined) normalized.ad_type = adType;

  const productType = validateSingleEnum(errors, base, 'product_type', aiMeta.product_type, ENUMS.product_type, requireCore);
  if (productType !== undefined) normalized.product_type = productType;

  const language = validateSingleEnum(errors, base, 'language', aiMeta.language, ENUMS.language, requireCore);
  if (language !== undefined) normalized.language = language;

  // Multi-label required enums
  if (aiMeta.intent !== undefined || requireCore) {
    const intent = validateEnumArray(errors, base, 'intent', aiMeta.intent ?? [], ENUMS.intent, { min: 1, max: 5 });
    if (intent !== undefined) normalized.intent = intent;
  }
  if (aiMeta.hook !== undefined || requireCore) {
    const hook = validateEnumArray(errors, base, 'hook', aiMeta.hook ?? [], ENUMS.hook, { min: 1, max: 5 });
    if (hook !== undefined) normalized.hook = hook;
  }

  // Optional fields (validated only if present)
  if (aiMeta.offers !== undefined) {
    const offers = validateOffers(errors, base, aiMeta.offers);
    if (offers !== undefined) normalized.offers = offers;
  }
  if (aiMeta.colors !== undefined) {
    const colors = validateEnumArray(errors, base, 'colors', aiMeta.colors, ENUMS.colors, { min: 1, max: 5 });
    if (colors !== undefined) normalized.colors = colors;
  }
  if (aiMeta.ocr !== undefined) {
    const ocr = validateText(errors, base, 'ocr', aiMeta.ocr, { maxLen: 2000, allowNl: true });
    if (ocr !== undefined) normalized.ocr = ocr;
  }
  if (aiMeta.object !== undefined) {
    const object = validateStringArray(errors, base, 'object', aiMeta.object, { max: 10, lower: true });
    if (object !== undefined) normalized.object = object;
  }
  if (aiMeta.celebrity !== undefined) {
    const celebrity = validateStringArray(errors, base, 'celebrity', aiMeta.celebrity, { max: 5 });
    if (celebrity !== undefined) normalized.celebrity = celebrity;
  }
  if (aiMeta.brand !== undefined && aiMeta.brand !== null) {
    if (!nonEmpty(aiMeta.brand)) {
      errors.push({ field: `${base}.brand`, message: 'brand must be a non-empty string (omit if unknown)' });
    } else if (aiMeta.brand.length > 100) {
      errors.push({ field: `${base}.brand`, message: 'brand exceeds the max length of 100' });
    } else {
      normalized.brand = aiMeta.brand.trim();
    }
  }
  if (aiMeta.brand_logos !== undefined) {
    const logos = validateStringArray(errors, base, 'brand_logos', aiMeta.brand_logos, { max: 10 });
    if (logos !== undefined) normalized.brand_logos = logos;
  }
  if (aiMeta.offering !== undefined && aiMeta.offering !== null) {
    const offering = validateText(errors, base, 'offering', aiMeta.offering, { maxLen: 200, allowNl: false });
    if (offering !== undefined) normalized.offering = offering;
  }
  if (aiMeta.category !== undefined && aiMeta.category !== null) {
    if (isPlainString(aiMeta.category)) normalized.category = aiMeta.category;
    else errors.push({ field: `${base}.category`, message: 'category must be a string' });
  }
  if (aiMeta.sub_category !== undefined && aiMeta.sub_category !== null) {
    if (isPlainString(aiMeta.sub_category)) normalized.sub_category = aiMeta.sub_category;
    else errors.push({ field: `${base}.sub_category`, message: 'sub_category must be a string' });
  }

  if (status !== undefined) normalized.status = status;

  const storedFields = Object.keys(normalized);
  return { errors, normalized, storedFields, status };
}

module.exports = { validateAiMeta, ENUMS };

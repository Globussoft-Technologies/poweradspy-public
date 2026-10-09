'use strict';

/**
 * Fit OCR/OCB report values to their MySQL columns before the UPDATE.
 *
 * The prod `*_ad_variants` OCR/OCB columns are latin1 varchar(256) under
 * STRICT_TRANS_TABLES: a character above U+00FF (emoji, Devanagari, CJK, ™, ’) or a
 * value longer than the column fails the whole UPDATE, so the report returns 401
 * "Image Object not updated" — and the same payload fails on every retry.
 *
 * Only the MySQL copy is changed: the report services build the Elasticsearch doc from
 * the request body, so search keeps the full text.
 */

const OCR_COLS = ['image_ocr', 'image_object', 'image_celebrity', 'image_brand_logo'];

const charLength = (s) => Array.from(s).length; // code points, as MySQL counts them

/**
 * Instagram/Reddit store tag lists as a JSON array string: drop trailing items so the
 * stored value stays valid JSON. Returns null when `value` is not a JSON array.
 */
function cutJsonArray(value, max) {
  if (!value.startsWith('[')) return null;
  let arr;
  try {
    arr = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  while (arr.length && charLength(JSON.stringify(arr)) > max) arr.pop();
  return JSON.stringify(arr);
}

function fit(value, max, stripNonLatin1) {
  const s = stripNonLatin1 ? value.replace(/[^\x00-\xFF]/g, '') : value;
  if (!max || charLength(s) <= max) return s;

  const json = cutJsonArray(s, max);
  if (json !== null) return json;

  // Plain text / `||` list: cut to `max`, ending on a whole item when one fits.
  const cut = Array.from(s).slice(0, max).join('');
  const sep = cut.lastIndexOf('||');
  return sep > 0 ? cut.slice(0, sep) : cut;
}

/**
 * In place: make each OCR/OCB string column in `data` fit its column. Fits the
 * `*_ad_variants` columns (OCR_COLS) plus any column named in `limits` (e.g. YouTube's
 * ocr/object/celebrity/brand_logo). `limits` maps a column to its max length (omitted →
 * no length limit). `stripNonLatin1` drops characters above U+00FF; pass false for
 * utf8mb4 columns. Returns `data`.
 */
function fitOcrColumns(data, limits = {}, { stripNonLatin1 = true } = {}) {
  if (!data || typeof data !== 'object') return data;
  for (const c of new Set([...OCR_COLS, ...Object.keys(limits)])) {
    if (typeof data[c] === 'string') data[c] = fit(data[c], limits[c], stripNonLatin1);
  }
  return data;
}

module.exports = { fitOcrColumns, OCR_COLS };

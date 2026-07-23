'use strict';

/**
 * landerTokenResolver
 *
 * The Google `built_with` (Ecommerce Platform) and `built_with_analytics_tracking`
 * (Funnel) fields on `google_ads_data_v2` are now keyword fields with a
 * lowercase normalizer. That means the mapping already supports exact
 * case-insensitive `term` matching, so there is no analyzer tokenization to
 * resolve anymore.
 *
 * Results are cached per `(index, field, value)` for the process lifetime, so a
 * given filter value is analyzed at most once (the filter vocabulary is small
 * and stable). `_analyze` is read-only and never mutates the index.
 */

const _tokenCache = new Map();

function _key(index, field, value) {
  return `${index}|${field}|${value.toLowerCase()}`;
}

/**
 * Normalize filter values for the keyword mapping and dedupe them.
 *
 * @param {Object} elastic  - db.elastic wrapper (exposes `analyze`)
 * @param {string} index    - ES index name
 * @param {string} field    - analyzed field whose analyzer to apply (e.g. 'built_with')
 * @param {Array}  values   - raw filter values
 * @param {Object} [logger] - optional service logger
 * @returns {Promise<string[]>} stemmed tokens (deduped); safe to pass to termFilter
 */
async function resolveLongestTokens(elastic, index, field, values, logger) {
  const out = [];
  for (const raw of Array.isArray(values) ? values : [values]) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw);
    const key = _key(index, field, value);

    if (_tokenCache.has(key)) {
      const cached = _tokenCache.get(key);
      if (cached) out.push(cached);
      continue;
    }

    const token = value.toLowerCase();
    _tokenCache.set(key, token);
    if (token) out.push(token);
  }
  return [...new Set(out)];
}

module.exports = { resolveLongestTokens, _tokenCache };

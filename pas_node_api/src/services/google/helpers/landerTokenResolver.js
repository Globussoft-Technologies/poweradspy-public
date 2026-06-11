'use strict';

/**
 * landerTokenResolver
 *
 * The Google `built_with` (Ecommerce Platform) and `built_with_analytics_tracking`
 * (Funnel) fields on `google_ads_data` are indexed with an `edge_ngram`
 * `custom_analyzer`. An analyzed `match` on such a field collapses the query's
 * n-grams onto a single token position, so it matches ANY document sharing a
 * leading prefix — e.g. filtering "WooCommerce" also returns "Wix", "WordPress"
 * and "www.dell.com" (all start with "w").
 *
 * There is no populated keyword sub-field to `term`-match against, and we want
 * to avoid changing the ES mapping/data. Instead we ask Elasticsearch (via the
 * read-only `_analyze` API) for the exact token the field's own analyzer
 * produced for each filter value — the longest token is the fully-stemmed whole
 * value (e.g. "WooCommerce" -> "woocommerc", "Magento" -> "magent") — and then
 * `term`-match that token. This is exact (no prefix collapse), case-insensitive
 * (the analyzer lowercases), and adapts automatically to the analyzer's stemmer.
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
 * Resolve filter values to the exact stemmed tokens indexed for `field`.
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

    // Fallback (analyze unavailable/failing): the literal lowercased value. This
    // is exact and never over-matches — it can only under-match a stemmed value,
    // which is preferable to leaking unrelated platforms back in.
    let token = value.toLowerCase();
    try {
      if (typeof elastic?.analyze === 'function') {
        const res = await elastic.analyze({ index, body: { field, text: value } });
        const tokens = (res?.tokens || res?.body?.tokens || []).map(t => t.token);
        if (tokens.length) {
          token = tokens.reduce((longest, t) => (t.length > longest.length ? t : longest), '');
        }
      }
    } catch (err) {
      logger?.warn?.(
        `[google] _analyze failed for ${field}="${value}"; falling back to literal token`,
        { error: err?.message },
      );
    }

    _tokenCache.set(key, token);
    if (token) out.push(token);
  }
  return [...new Set(out)];
}

module.exports = { resolveLongestTokens, _tokenCache };

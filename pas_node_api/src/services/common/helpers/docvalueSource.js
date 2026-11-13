'use strict';

/**
 * Rebuild a `_source`-shaped object from a hit fetched with `docvalue_fields`.
 *
 * The insights queries read only a few fields from up to 10,000 docs. Reading them
 * from doc values (`_source: false` + `docvalue_fields`) avoids loading every stored
 * document from disk. This helper lets the existing readers keep their `src[...]`
 * logic unchanged:
 *   - a hit that still has `_source` is returned as is;
 *   - doc-value arrays with one value are unwrapped (`[42]` → `42`);
 *   - `rename` maps a doc-value field back to its `_source` key
 *     (e.g. `{ 'countries.keyword': 'countries' }`);
 *   - `numeric` lists keys converted with Number() — epoch-second dates come back
 *     from doc values as strings ("1731621770"), while `_source` holds numbers.
 */
function docvalueSource(hit, { rename = {}, numeric = [] } = {}) {
  if (hit && hit._source) return hit._source;
  const out = {};
  for (const [field, values] of Object.entries((hit && hit.fields) || {})) {
    const key = rename[field] || field;
    let value = Array.isArray(values) && values.length === 1 ? values[0] : values;
    if (numeric.includes(key)) value = Array.isArray(value) ? value.map(Number) : Number(value);
    out[key] = value;
  }
  return out;
}

module.exports = { docvalueSource };

'use strict';

/**
 * Shared Elasticsearch query helpers used by every platform builder.
 *
 * Goals:
 *   1. Keep behaviour as close to the original PHP-derived query shapes as
 *      possible while removing the most expensive constructs.
 *   2. Push every non-scoring clause into the bool `filter` context so ES
 *      can cache it and skip _score computation.
 *   3. Avoid `query_string` for fields that don't need its grammar — `term`,
 *      `terms`, `match` and `multi_match` are all cheaper to parse and
 *      execute than the QueryString parser.
 *   4. Flatten the recursive `bool -> must -> filter -> must -> filter`
 *      pattern into one `bool { must, filter, must_not }` per builder.
 *
 * No mappings/analyzers/index settings are touched — every helper here
 * works against the existing schema.
 */

// ─── Text helpers (shared escaping logic) ────────────────────────────────

/**
 * Escape special Elasticsearch query_string characters.
 * Mirrors PHP Search_mix::escapeWords().
 */
function escapeWords(text) {
  if (!text) return '';
  let t = String(text);
  // Order matters — backslash first
  t = t.replace(/\\/g, '\\\\');
  t = t.replace(/!/g, '\\!');
  t = t.replace(/\//g, '\\/');
  t = t.replace(/#/g, '\\#');
  t = t.replace(/:/g, '\\:');
  t = t.replace(/\[/g, '\\[');
  t = t.replace(/\]/g, '\\]');
  t = t.replace(/\(/g, '\\(');
  t = t.replace(/\)/g, '\\)');
  t = t.replace(/\?/g, '\\?');
  t = t.replace(/\|/g, '\\|');
  t = t.replace(/'/g, "\\'");
  t = t.replace(/\./g, '\\.');
  t = t.replace(/-/g, '\\-');
  if (t.startsWith('&')) t = '\\&' + t.slice(1);
  return t;
}

function relativeWords(text) {
  if (Array.isArray(text)) {
    return text.map((t) => {
      const words = escapeWords(t).split(' ').filter(Boolean);
      return '(' + words.join(') AND (') + ')';
    });
  }
  const words = escapeWords(text).split(' ').filter(Boolean);
  return '(' + words.join(') AND (') + ')';
}

function wrapIfNeed(term) {
  return String(term).includes(' ') ? `(${term})` : term;
}

// ─── Generic builders ────────────────────────────────────────────────────

/**
 * Build a single `bool` query from category buckets, omitting empty arrays.
 * Replaces the recursive nested `bool { must, filter: { bool { must, filter ... } } }`
 * pattern with a flat structure that ES can plan and cache more efficiently.
 */
function flatBool({ must = [], filter = [], must_not = [], should = [], minimum_should_match } = {}) {
  const b = {};
  if (must.length) b.must = must;
  if (filter.length) b.filter = filter;
  if (must_not.length) b.must_not = must_not;
  if (should.length) b.should = should;
  if (minimum_should_match !== undefined) b.minimum_should_match = minimum_should_match;
  return { bool: b };
}

/**
 * For exact-match keyword fields.
 *   - 1 value  → `term`
 *   - >1 vals  → `terms`
 *
 * The caller decides whether `field` is the analyzed field or its `.keyword`
 * sub-field; pick `.keyword` whenever that sub-field is known to exist
 * (mappings already define `.keyword` for category, subCategory and the
 * country-only fields used in country-priority boosting).
 */
function termFilter(field, vals) {
  if (vals === undefined || vals === null) return null;
  if (Array.isArray(vals)) {
    const arr = vals.filter(v => v !== undefined && v !== null && v !== '');
    if (!arr.length) return null;
    if (arr.length === 1) return { term: { [field]: arr[0] } };
    return { terms: { [field]: arr } };
  }
  if (vals === '') return null;
  return { term: { [field]: vals } };
}

/**
 * Exact, case-INSENSITIVE value match on a keyword sub-field.
 *
 * Use for categorical values (e.g. Call-To-Action) where:
 *   - the whole field value must match exactly — a single-token value like
 *     "Buy" must NOT match "Buy Tickets" (which `matchFilter`/analyzed `match`
 *     would do at token level), AND
 *   - the stored casing is inconsistent ("Buy tickets" vs "Buy Tickets" vs
 *     "buy tickets"), so a plain `term` on `.keyword` (case-sensitive) would
 *     miss valid docs.
 *
 * `field` must be a keyword sub-field (it is read via doc_values).
 *
 * Implementation note: the production clusters run Elasticsearch 6.8, which has
 * no `case_insensitive` term option and no `normalizer` on the existing keyword
 * mappings (changing that needs a reindex). A painless `script` filter lower-
 * cases both sides at match time, giving exact whole-value, case-insensitive
 * matching without a mapping change. The values are pre-lowercased here so the
 * script only has to lowercase the doc value. Runs in filter context (no
 * scoring); CTA is always combined with other selective filters.
 */
function termFilterCI(field, vals) {
  if (vals === undefined || vals === null) return null;
  const arr = Array.isArray(vals) ? vals : [vals];
  const cleaned = arr
    .filter(v => v !== undefined && v !== null && v !== '')
    .map(v => String(v).toLowerCase());
  if (!cleaned.length) return null;
  return {
    script: {
      script: {
        lang: 'painless',
        source:
          'if (doc[params.f].size() == 0) return false; ' +
          'return params.vals.contains(doc[params.f].value.toLowerCase());',
        params: { f: field, vals: cleaned },
      },
    },
  };
}

/**
 * For text fields where we want to preserve the field's analyzer (so the
 * query goes through the same lowercasing/tokenization as the indexed
 * data) but don't need full query_string grammar.
 *
 *   - 1 value  → `match` with operator AND
 *   - >1 vals  → `bool.should: match[]` with minimum_should_match=1
 *
 * `match { operator: 'and' }` reproduces the per-value
 * `(word) AND (word)` semantics that `relativeWords` was emitting.
 */
function matchFilter(field, vals) {
  if (vals === undefined || vals === null) return null;
  const arr = Array.isArray(vals) ? vals : [vals];
  const cleaned = arr.filter(v => v !== undefined && v !== null && v !== '');
  if (!cleaned.length) return null;
  if (cleaned.length === 1) {
    return { match: { [field]: { query: String(cleaned[0]), operator: 'and' } } };
  }
  return {
    bool: {
      should: cleaned.map(v => ({ match: { [field]: { query: String(v), operator: 'and' } } })),
      minimum_should_match: 1,
    },
  };
}

/**
 * Same idea as `matchFilter` but across multiple fields (mirrors
 * `query_string { fields: [...], query: '(A) OR (B)' }`).
 */
function multiFieldMatchFilter(fields, vals) {
  if (!fields || !fields.length) return null;
  if (vals === undefined || vals === null) return null;
  const arr = Array.isArray(vals) ? vals : [vals];
  const cleaned = arr.filter(v => v !== undefined && v !== null && v !== '');
  if (!cleaned.length) return null;
  if (cleaned.length === 1) {
    return { multi_match: { query: String(cleaned[0]), fields, operator: 'and' } };
  }
  return {
    bool: {
      should: cleaned.map(v => ({ multi_match: { query: String(v), fields, operator: 'and' } })),
      minimum_should_match: 1,
    },
  };
}

/**
 * Phrase keyword search across many fields.
 *
 * Replaces:
 *   query_string { fields, query: '((kw1) AND (kw2))', type: 'phrase' }
 *
 * With:
 *   - quoted input: `multi_match { type: 'phrase' }` (already cheaper)
 *   - non-quoted single-word: `multi_match { type: 'phrase' }`
 *   - non-quoted multi-word: bool.must of `multi_match { type: 'phrase' }`,
 *     one per word — equivalent to the AND-of-phrases the query_string
 *     was building, but without the QueryString parser overhead.
 */
function phraseAcrossFields(fields, kw, opts = {}) {
  if (!kw || !fields || !fields.length) return null;
  const hasQuotes = String(kw).includes('"');
  const cleaned = String(kw).replace(/"/g, '').trim();
  if (!cleaned) return null;
  const exactlyFields = opts.exactlyFields || [];
  // Optional `analyzer` override. Forces ES to use this analyzer at search
  // time instead of whatever the field's mapping default is. Required for
  // indexes where the field's search_analyzer is set to an edge-ngram
  // analyzer (or any other tokenizer that produces partial tokens at search
  // time) — otherwise a query for "hubspot" becomes Synonym(h, hu, hub, …)
  // and matches docs that share a single-character prefix. Setting
  // `analyzer: 'standard'` reverts the search side to whole-word tokens
  // while leaving the field's index-time analyzer untouched.
  const analyzer = opts.analyzer;
  const withAnalyzer = (mm) => (analyzer ? { ...mm, analyzer } : mm);
  if (hasQuotes) {
    return { multi_match: withAnalyzer({ query: cleaned, type: 'phrase', fields: [...fields, ...exactlyFields] }) };
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return { multi_match: withAnalyzer({ query: words[0], type: 'phrase', fields }) };
  }
  return {
    bool: {
      must: words.map(w => ({ multi_match: withAnalyzer({ query: w, type: 'phrase', fields }) })),
    },
  };
}

/**
 * Build the country-priority boost wrapper used everywhere.
 *
 * `keywordField` should be the `.keyword` sub-field for term lookups, and
 * `textField` the analyzed field for the case-insensitive `match` fallback.
 * Set `includeWildcard: true` only for builders that historically used a
 * leading-wildcard variant (Facebook, Instagram, YouTube). Leading
 * wildcards are slow but keep behaviour intact for those platforms.
 */
function wrapWithCountryBoost(innerQuery, c, keywordField, textField, opts = {}) {
  const should = [
    { term: { [keywordField]: c } },
    { term: { [keywordField]: c.toUpperCase() } },
    { term: { [keywordField]: c.toLowerCase() } },
    { term: { [keywordField]: c.charAt(0).toUpperCase() + c.slice(1).toLowerCase() } },
    { match: { [textField]: c } },
  ];
  if (opts.includeWildcard) {
    should.push({ wildcard: { [keywordField]: `*${c}*` } });
  }
  return {
    bool: {
      must: [innerQuery || { match_all: {} }],
      should: [
        {
          constant_score: {
            filter: { bool: { should } },
            boost: 1000000,
          },
        },
      ],
      minimum_should_match: 0,
    },
  };
}

/**
 * Compute pagination params. We retain `from`+`size` for backwards
 * compatibility and ask ES to track total hits so the UI count is
 * accurate. The value is a boolean because the legacy clusters
 * (Facebook/Instagram/YouTube/GDN/Native/LinkedIn/Pinterest/Quora/Reddit
 * /Google run ES 6.8) only accept boolean for this field — the integer
 * cap form was added in ES 7.0 and rejecting it crashed the boolean
 * parser on those clusters.
 *
 * Deep pagination warning: any `from > 10000` lookup pulls heavy work
 * onto the coordinator. The IP-based-country code already short-circuits
 * the boost path past from=10000; the controllers should consider using
 * `search_after` for true deep pagination cases.
 */
function paginationDefaults() {
  return { track_total_hits: true };
}

/**
 * Apply optional `profile: true` to a search body.
 *
 *   1. Caller passes `{ profile: true }` to the builder via `setProfile()`.
 *   2. OR set environment variable `ES_PROFILE=true` (only honoured when
 *      `NODE_ENV !== 'production'` so we never accidentally enable the
 *      expensive profiler in prod).
 */
function shouldProfile(explicit) {
  if (explicit === true) return true;
  if (explicit === false) return false;
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ES_PROFILE === 'true' || process.env.ES_PROFILE === '1';
}

/**
 * Tag clause kinds so the builder can route them to `must` vs. `filter`
 * automatically. Returning a `{ ctx, clause }` envelope from each
 * generator avoids the old recursive `_formatBody` walker entirely.
 */
const CTX_FILTER = 'filter';
const CTX_MUST = 'must';
const CTX_MUST_NOT = 'must_not';

function asFilter(clause) { return clause ? { ctx: CTX_FILTER, clause } : null; }
function asMust(clause)   { return clause ? { ctx: CTX_MUST, clause } : null; }
function asMustNot(clause){ return clause ? { ctx: CTX_MUST_NOT, clause } : null; }

/**
 * Bucket an array of `{ ctx, clause }` envelopes into `{must, filter, must_not}`.
 * Plain clause objects (legacy) default to `filter` — which is the safe
 * choice because filter context is cacheable and skips scoring. If a
 * legacy clause needs scoring it should be wrapped with `asMust()`.
 */
function bucketize(envelopes) {
  const out = { must: [], filter: [], must_not: [] };
  for (const e of envelopes) {
    if (!e) continue;
    if (e.ctx && e.clause) {
      out[e.ctx].push(e.clause);
    } else {
      out.filter.push(e);
    }
  }
  return out;
}

module.exports = {
  // text helpers
  escapeWords,
  relativeWords,
  wrapIfNeed,
  // builders
  flatBool,
  termFilter,
  termFilterCI,
  matchFilter,
  multiFieldMatchFilter,
  phraseAcrossFields,
  wrapWithCountryBoost,
  // wiring
  asFilter,
  asMust,
  asMustNot,
  bucketize,
  CTX_FILTER,
  CTX_MUST,
  CTX_MUST_NOT,
  // misc
  paginationDefaults,
  shouldProfile,
};

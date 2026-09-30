'use strict';

const config = require('../../../config');
const { termFilter, termFilterOrMissing } = require('./esQueryHelpers');

// The aligned SDUI stores taxonomy IDs, while older network fields still store
// category names. Keep the field knowledge here so every search controller can
// accept both representations without duplicating builder changes per network.
const LEGACY_CATEGORY_FIELDS = {
  facebook: { category: ['facebook.category.keyword'], subcategory: ['facebook.subCategory.keyword'] },
  instagram: { category: ['instagram.category.keyword'], subcategory: ['instagram.subCategory.keyword'] },
  youtube: { category: ['youtube.category.keyword'], subcategory: ['youtube.subCategory.keyword'] },
  gdn: { category: ['gdn.category.keyword'], subcategory: ['gdn.subCategory.keyword'] },
  native: {
    category: ['native.category.keyword', 'native_category.category'],
    subcategory: ['native.subCategory.keyword'],
  },
  linkedin: { category: ['linkedin.category.keyword'], subcategory: ['linkedin.subCategory.keyword'] },
  reddit: { category: ['reddit.category.keyword'], subcategory: ['reddit.subCategory.keyword'] },
  quora: { category: ['quora.category.keyword'], subcategory: ['quora.subCategory.keyword'] },
  pinterest: { category: ['pinterest.category.keyword'], subcategory: ['pinterest.subCategory.keyword'] },
  // Google has both the v2 flat fields and the production-qualified fields.
  // Keep both names available so old label-based requests remain searchable.
  google: {
    category: ['category', 'google.category', 'google.category.keyword'],
    subcategory: ['subCategory', 'google.subCategory', 'google.subCategory.keyword'],
  },
  tiktok: { category: ['industry'], subcategory: [] },
};

const TAXONOMY_ID_FIELDS = {
  category: 'category_id',
  subcategory: 'subCategory_id',
};

const AI_META_REQUIRED_FIELDS = ['ad_type', 'intent', 'hook', 'offering_type'];

// AI-filtered search results are presented as a visible card count, not as the
// raw ES hit total. On collapsed indices (Facebook / Instagram) the raw hit
// total can run ahead of what the UI renders, so we keep a lightweight
// cardinality count field here and only enable it when an AI filter is active.
const AI_VISIBLE_COUNT_FIELDS = {
  facebook: 'facebook_ad.id',
  instagram: 'instagram_ad.id',
  youtube: 'ad_id',
  gdn: 'gdn_ad.id',
  // LinkedIn search docs are indexed as flat objects, so the internal
  // `linkedin_ad.id` value is exposed on the top-level `ad_id` field.
  linkedin: 'ad_id',
  native: 'native_ad.id',
  reddit: 'reddit_ad.id',
  quora: 'quora_ad.id',
  pinterest: 'pinterest_ad.id',
  google: 'id',
  tiktok: 'sql_id',
};

/**
 * The dashboard exposes one logical AI-Meta filter, while production Facebook
 * stores new enrichment under `ai_meta` to avoid its legacy `ai` mapping.
 */
function getAiMetaEsField(network) {
  return config.env === 'production' && String(network).toLowerCase() === 'facebook'
    ? 'ai_meta'
    : 'ai';
}

function getAiMetaSourceFields(network) {
  const field = getAiMetaEsField(network);
  return AI_META_REQUIRED_FIELDS.map((key) => `${field}.${key}`);
}

function hasCompleteAiMeta(source, network) {
  const aiMeta = source?.[getAiMetaEsField(network)];
  if (!aiMeta || typeof aiMeta !== 'object' || Array.isArray(aiMeta)) return false;
  return AI_META_REQUIRED_FIELDS.every((field) => {
    const value = aiMeta[field];
    return Array.isArray(value)
      ? value.length > 0
      : value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function markAiMetaResult(ad, source, network) {
  const aiMeta = source?.[getAiMetaEsField(network)];
  if (!aiMeta || typeof aiMeta !== 'object' || Array.isArray(aiMeta)) return ad;
  return { ...ad, has_ai_meta: hasCompleteAiMeta(source, network) };
}

function addAiMetaSourceFields(esParams, network) {
  const source = esParams?.body?._source;
  // Facebook's builder intentionally requests the complete source. Do not
  // replace a non-array source configuration; other builders use arrays.
  if (!Array.isArray(source)) return esParams;
  esParams.body._source = [...new Set([...source, ...getAiMetaSourceFields(network)])];
  return esParams;
}

/**
 * Production received offer_type values before its explicit mapping was
 * deployed, so Elasticsearch created a text field with a keyword multi-field.
 * Other environments were mapped explicitly and query the keyword base field.
 */
function getAiMetaOfferTypeEsField(network) {
  const field = `${getAiMetaEsField(network)}.offer_type`;
  return config.env === 'production' ? `${field}.keyword` : field;
}

function isEnabled(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

/**
 * "Has AI-Meta" requires the four classifier core fields, not merely a
 * partially written object. This keeps incomplete ingestion records hidden.
 */
function getHasAiMetaFilter(network) {
  const field = getAiMetaEsField(network);
  return {
    bool: {
      filter: ['ad_type', 'intent', 'hook', 'offering_type'].map((key) => ({
        exists: { field: `${field}.${key}` },
      })),
    },
  };
}

function values(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== '' && item !== 'NA' && item != null);
  if (value === '' || value === 'NA' || value == null) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueValues(...inputs) {
  return [...new Set(inputs.flatMap((input) => values(input)))];
}

function taxonomyIds(input, length) {
  return uniqueValues(input)
    .map((value) => String(value))
    .filter((value) => new RegExp(`^\\d{${length}}$`).test(value));
}

function clauseContainsField(clause, fields) {
  if (!clause || typeof clause !== 'object') return false;
  if (Array.isArray(clause)) return clause.some((item) => clauseContainsField(item, fields));
  return Object.entries(clause).some(([key, value]) =>
    fields.includes(key) || clauseContainsField(value, fields),
  );
}

function orWithTaxonomyIds(baseClause, idField, ids) {
  if (!baseClause || !ids.length) return baseClause;
  return {
    bool: {
      should: [baseClause, { terms: { [idField]: ids } }],
      minimum_should_match: 1,
    },
  };
}

function getLegacyCategoryFieldConfig(network) {
  return LEGACY_CATEGORY_FIELDS[String(network || '').toLowerCase()] || null;
}

function getCategoryValues(params = {}) {
  return uniqueValues(params.adcategory, params.category, params.industry);
}

function getSubcategoryValues(params = {}) {
  return uniqueValues(params.subCategory, params.subcategory);
}

/**
 * Build category predicates for secondary query paths (for example the
 * YouTube DISPLAY merge) that do not pass through a network query builder.
 */
function getLegacyCategoryFilterClauses(network, params = {}) {
  const fields = getLegacyCategoryFieldConfig(network);
  if (!fields) return [];

  const categoryValues = getCategoryValues(params);
  const subcategoryValues = getSubcategoryValues(params);
  const clauses = [];

  if (categoryValues.length && fields.category[0]) {
    clauses.push(orWithTaxonomyIds(
      termFilter(fields.category[0], categoryValues),
      TAXONOMY_ID_FIELDS.category,
      taxonomyIds(categoryValues, 4),
    ));
  }

  if (subcategoryValues.length && fields.subcategory[0]) {
    const baseClause = categoryValues.length
      ? termFilterOrMissing(fields.subcategory[0], subcategoryValues)
      : termFilter(fields.subcategory[0], subcategoryValues);
    clauses.push(orWithTaxonomyIds(
      baseClause,
      TAXONOMY_ID_FIELDS.subcategory,
      taxonomyIds(subcategoryValues, 8),
    ));
  }

  return clauses.filter(Boolean);
}

/**
 * Add ID-field alternatives to category clauses already emitted by a builder.
 * Name-field behavior remains the original branch, so old label-based payloads
 * and indices without populated taxonomy IDs continue to work unchanged.
 */
function addLegacyCategoryIdAlternatives(network, filters, params = {}) {
  const fields = getLegacyCategoryFieldConfig(network);
  if (!fields) return filters;

  const categoryIds = taxonomyIds(getCategoryValues(params), 4);
  const subcategoryIds = taxonomyIds(getSubcategoryValues(params), 8);
  if (!categoryIds.length && !subcategoryIds.length) return filters;

  return filters.map((clause) => {
    let next = clause;
    if (categoryIds.length && clauseContainsField(clause, fields.category)) {
      next = orWithTaxonomyIds(next, TAXONOMY_ID_FIELDS.category, categoryIds);
    }
    if (subcategoryIds.length && clauseContainsField(clause, fields.subcategory)) {
      next = orWithTaxonomyIds(next, TAXONOMY_ID_FIELDS.subcategory, subcategoryIds);
    }
    return next;
  });
}

function groupCategoryClauses(clauses) {
  return clauses.length === 1 ? clauses[0] : { bool: { filter: clauses } };
}

function combineCategorySources(legacyClauses, aiClauses) {
  if (!legacyClauses.length || !aiClauses.length) {
    return [...legacyClauses, ...aiClauses];
  }
  return [{
    bool: {
      should: [groupCategoryClauses(legacyClauses), groupCategoryClauses(aiClauses)],
      minimum_should_match: 1,
    },
  }];
}

function expandOfferingTypeSelection(selected) {
  const normalized = [...new Set((selected || []).map((value) => String(value)))];
  if (normalized.includes('product') || normalized.includes('service')) {
    normalized.push('both');
  }
  return [...new Set(normalized)];
}

function buildOfferTypeClause(network, field, selected) {
  // Keep the new scalar contract and older nested JSON payloads both searchable
  // while honoring the production mapping created by dynamic field detection.
  return {
    bool: {
      should: [
        { terms: { [getAiMetaOfferTypeEsField(network)]: selected } },
        { terms: { [`${field}.offers.type`]: selected } },
      ],
      minimum_should_match: 1,
    },
  };
}

function buildOfferingTypeClause(field, selected) {
  const expanded = expandOfferingTypeSelection(selected);
  return { terms: { [`${field}.offering_type`]: expanded } };
}

/**
 * Fixed-value AI-Meta filters from the live-dashboard contract. Values within
 * a field are OR'd; each returned clause is added alongside other filters, so
 * separate fields combine with AND semantics.
 */
function getAiMetaFilterParts(network, params = {}) {
  const field = getAiMetaEsField(network);
  const clauses = [];
  const categoryClauses = [];
  const nonCategoryClauses = [];

  if (isEnabled(params.has_ai_meta)) {
    const clause = getHasAiMetaFilter(network);
    clauses.push(clause);
    nonCategoryClauses.push(clause);
  }

  const exactFields = {
    ai_ad_type: 'ad_type',
    ai_intent: 'intent',
    ai_hook: 'hook',
    ai_offering_type: 'offering_type',
    ai_offer_type: 'offer_type',
    ai_colors: 'colors',
    ai_category_id: 'category_id',
    ai_subcategory_id: 'subcategory_id',
  };

  for (const [param, suffix] of Object.entries(exactFields)) {
    const selected = values(params[param]);
    if (!selected.length) continue;
    // An AI subcategory is a real child selection, so it must be exact. A
    // parent-only request omits ai_subcategory_id and therefore still matches
    // records whose parent classification has no child value.
    const clause = suffix === 'offering_type'
      ? buildOfferingTypeClause(field, selected)
      : suffix === 'offer_type'
      ? buildOfferTypeClause(network, field, selected)
      : { terms: { [`${field}.${suffix}`]: selected } };
    clauses.push(clause);
    (param === 'ai_category_id' || param === 'ai_subcategory_id'
      ? categoryClauses
      : nonCategoryClauses).push(clause);
  }

  return { clauses, categoryClauses, nonCategoryClauses };
}

function getAiMetaFilterClauses(network, params = {}) {
  return getAiMetaFilterParts(network, params).clauses;
}

function getAiMetaCategoryFilterClauses(network, params = {}) {
  return getAiMetaFilterParts(network, params).categoryClauses;
}

function getAiMetaNonCategoryFilterClauses(network, params = {}) {
  return getAiMetaFilterParts(network, params).nonCategoryClauses;
}

/**
 * Add the AI-Meta predicate without changing a network builder's existing
 * query structure, sorting, or displayability filters.
 */
function applyAiMetaFilters(esParams, network, params) {
  if (!esParams?.body) return esParams;

  // Normal result cards need only a cheap per-ad AI marker. Keep the full AI
  // object out of ordinary feed responses and let the detail modal read it on
  // demand when the user opens an AI-enriched ad.
  addAiMetaSourceFields(esParams, network);

  const query = esParams.body.query;
  if (query?.bool) {
    const originalFilters = Array.isArray(query.bool.filter)
      ? query.bool.filter
      : query.bool.filter ? [query.bool.filter] : [];
    const filters = addLegacyCategoryIdAlternatives(network, originalFilters, params);
    const aiParts = getAiMetaFilterParts(network, params);

    if (!aiParts.clauses.length) {
      // Preserve the builder's original bool shape for ordinary searches. The
      // helper is called for every request, so a disabled AI filter must not
      // turn a single filter object or an absent filter into a new array.
      if (filters !== originalFilters) query.bool.filter = filters;
      return esParams;
    }

    if (!aiParts.categoryClauses.length) {
      filters.push(...aiParts.clauses);
      query.bool.filter = filters;
      return esParams;
    }

    const legacyCategoryClauses = [];
    const remainingFilters = [];
    const legacyFields = getLegacyCategoryFieldConfig(network);
    for (const clause of filters) {
      const isCategoryClause = legacyFields && (
        clauseContainsField(clause, legacyFields.category) ||
        clauseContainsField(clause, legacyFields.subcategory)
      );
      (isCategoryClause ? legacyCategoryClauses : remainingFilters).push(clause);
    }

    remainingFilters.push(...combineCategorySources(
      legacyCategoryClauses,
      aiParts.categoryClauses,
    ));
    remainingFilters.push(...aiParts.nonCategoryClauses);
    query.bool.filter = remainingFilters;
  } else {
    const clauses = getAiMetaFilterClauses(network, params);
    if (!clauses.length) return esParams;
    esParams.body.query = { bool: { must: query ? [query] : [], filter: clauses } };
  }

  return esParams;
}

/**
 * When AI filters are active, request a distinct-ad count alongside the
 * normal search results so the header total matches the visible cards.
 *
 * This is intentionally limited to the collapsed Meta indices, where raw
 * `hits.total` can overcount the same ad after ES doc duplication.
 */
function addAiMetaVisibleCountAgg(esParams, network, params) {
  if (!esParams?.body) return esParams;

  const field = AI_VISIBLE_COUNT_FIELDS[String(network || '').toLowerCase()];
  if (!field) return esParams;

  const clauses = getAiMetaFilterClauses(network, params);
  if (!clauses.length) return esParams;

  esParams.body.aggs = esParams.body.aggs || {};
  if (!esParams.body.aggs.total_ads) {
    esParams.body.aggs.total_ads = {
      cardinality: {
        field,
        precision_threshold: 40000,
      },
    };
  }

  return esParams;
}

function readAiMetaVisibleCount(result) {
  const aggs = result?.aggregations || result?.body?.aggregations || null;
  return aggs?.total_ads?.value ?? null;
}

module.exports = {
  applyAiMetaFilters,
  addAiMetaVisibleCountAgg,
  combineCategorySources,
  getAiMetaCategoryFilterClauses,
  getAiMetaEsField,
  getAiMetaSourceFields,
  getAiMetaOfferTypeEsField,
  getAiMetaFilterClauses,
  getAiMetaNonCategoryFilterClauses,
  getLegacyCategoryFilterClauses,
  getHasAiMetaFilter,
  hasCompleteAiMeta,
  markAiMetaResult,
  readAiMetaVisibleCount,
  isEnabled,
};

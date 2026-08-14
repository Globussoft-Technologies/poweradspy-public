'use strict';

const config = require('../../../config');

// AI-filtered search results are presented as a visible card count, not as the
// raw ES hit total. On collapsed indices (Facebook / Instagram) the raw hit
// total can run ahead of what the UI renders, so we keep a lightweight
// cardinality count field here and only enable it when an AI filter is active.
const AI_VISIBLE_COUNT_FIELDS = {
  facebook: 'facebook_ad.id',
  instagram: 'instagram_ad.id',
  youtube: 'ad_id',
  gdn: 'gdn_ad.id',
  linkedin: 'linkedin_ad.id',
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
function getAiMetaFilterClauses(network, params = {}) {
  const field = getAiMetaEsField(network);
  const clauses = [];

  if (isEnabled(params.has_ai_meta)) clauses.push(getHasAiMetaFilter(network));

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
    clauses.push(suffix === 'offering_type'
      ? buildOfferingTypeClause(field, selected)
      : suffix === 'offer_type'
      ? buildOfferTypeClause(network, field, selected)
      : { terms: { [`${field}.${suffix}`]: selected } });
  }

  return clauses;
}

/**
 * Add the AI-Meta predicate without changing a network builder's existing
 * query structure, sorting, or displayability filters.
 */
function applyAiMetaFilters(esParams, network, params) {
  if (!esParams?.body) return esParams;

  const clauses = getAiMetaFilterClauses(network, params);
  if (!clauses.length) return esParams;
  const query = esParams.body.query;
  if (query?.bool) {
    const filters = Array.isArray(query.bool.filter)
      ? query.bool.filter
      : query.bool.filter ? [query.bool.filter] : [];
    filters.push(...clauses);
    query.bool.filter = filters;
  } else {
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
  getAiMetaEsField,
  getAiMetaOfferTypeEsField,
  getAiMetaFilterClauses,
  getHasAiMetaFilter,
  readAiMetaVisibleCount,
  isEnabled,
};

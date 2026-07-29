'use strict';

const config = require('../../../config');

/**
 * The dashboard exposes one logical AI-Meta filter, while production Facebook
 * stores new enrichment under `ai_meta` to avoid its legacy `ai` mapping.
 */
function getAiMetaEsField(network) {
  return config.env === 'production' && String(network).toLowerCase() === 'facebook'
    ? 'ai_meta'
    : 'ai';
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

function buildOfferTypeClause(field, selected) {
  // Keep the new scalar contract and older nested JSON payloads both searchable
  // while the index catches up with the offer_type shape change.
  return {
    bool: {
      should: [
        { terms: { [`${field}.offer_type`]: selected } },
        { terms: { [`${field}.offers.type`]: selected } },
      ],
      minimum_should_match: 1,
    },
  };
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
    clauses.push(suffix === 'offer_type'
      ? buildOfferTypeClause(field, selected)
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

module.exports = {
  applyAiMetaFilters,
  getAiMetaEsField,
  getAiMetaFilterClauses,
  getHasAiMetaFilter,
  isEnabled,
};

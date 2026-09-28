import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../../../../src/config');
const {
  applyAiMetaFilters,
  addAiMetaVisibleCountAgg,
  combineCategorySources,
  getAiMetaCategoryFilterClauses,
  getAiMetaFilterClauses,
  getAiMetaNonCategoryFilterClauses,
  getAiMetaEsField,
  getAiMetaOfferTypeEsField,
  getLegacyCategoryFilterClauses,
  readAiMetaVisibleCount,
} = require('../../../../src/services/common/helpers/aiMetaSearchFilter');
const originalEnv = config.env;

afterEach(() => {
  config.env = originalEnv;
});

describe('aiMetaSearchFilter', () => {
  it('uses ai_meta for production Facebook and ai elsewhere', () => {
    config.env = 'production';
    expect(getAiMetaEsField('facebook')).toBe('ai_meta');
    expect(getAiMetaEsField('instagram')).toBe('ai');

    config.env = 'development';
    expect(getAiMetaEsField('facebook')).toBe('ai');
  });

  it('uses the dynamically-created offer_type keyword sub-field only in production', () => {
    config.env = 'production';
    expect(getAiMetaOfferTypeEsField('facebook')).toBe('ai_meta.offer_type.keyword');
    expect(getAiMetaOfferTypeEsField('instagram')).toBe('ai.offer_type.keyword');

    config.env = 'staging';
    expect(getAiMetaOfferTypeEsField('facebook')).toBe('ai.offer_type');
    expect(getAiMetaOfferTypeEsField('instagram')).toBe('ai.offer_type');
  });

  it('adds all four required AI-Meta fields as an AND filter', () => {
    config.env = 'production';
    const esParams = { body: { query: { bool: { filter: [{ exists: { field: 'country' } }] } } } };
    applyAiMetaFilters(esParams, 'facebook', { has_ai_meta: true });

    const aiClause = esParams.body.query.bool.filter.at(-1);
    expect(aiClause.bool.filter.map((item) => item.exists.field)).toEqual([
      'ai_meta.ad_type',
      'ai_meta.intent',
      'ai_meta.hook',
      'ai_meta.offering_type',
    ]);
  });

  it('leaves the query unchanged when the toggle is disabled', () => {
    const esParams = { body: { query: { match_all: {} } } };
    applyAiMetaFilters(esParams, 'facebook', { has_ai_meta: false });
    expect(esParams.body.query).toEqual({ match_all: {} });
  });

  it('preserves ordinary bool filter structure when AI filters are inactive', () => {
    const filter = { term: { country: 'India' } };
    const esParams = { body: { query: { bool: { filter } } } };

    applyAiMetaFilters(esParams, 'facebook', { has_ai_meta: false });

    expect(esParams.body.query.bool.filter).toBe(filter);
  });

  it('counts LinkedIn AI-filtered cards through the flat ad_id field', () => {
    const esParams = { body: { query: { bool: { filter: [] } } } };

    addAiMetaVisibleCountAgg(esParams, 'linkedin', { has_ai_meta: true });

    expect(esParams.body.aggs).toEqual({
      total_ads: {
        cardinality: {
          field: 'ad_id',
          precision_threshold: 40000,
        },
      },
    });
    expect(readAiMetaVisibleCount({
      aggregations: { total_ads: { value: 9 } },
    })).toBe(9);
  });

  it('maps fixed contract fields and offer_type to the resolved ES object', () => {
    config.env = 'development';
    const clauses = getAiMetaFilterClauses('google', {
      ai_ad_type: ['promotional', 'demonstration'],
      ai_intent: 'conversion,lead_generation',
      ai_offer_type: ['percentage_discount'],
      ai_category_id: '1038',
    });

    expect(clauses).toEqual(expect.arrayContaining([
      { terms: { 'ai.ad_type': ['promotional', 'demonstration'] } },
      { terms: { 'ai.intent': ['conversion', 'lead_generation'] } },
      { bool: { should: [
        { terms: { 'ai.offer_type': ['percentage_discount'] } },
        { terms: { 'ai.offers.type': ['percentage_discount'] } },
      ], minimum_should_match: 1 } },
      { terms: { 'ai.category_id': ['1038'] } },
    ]));
  });

  it('keeps parent-only AI category searches independent of child filtering', () => {
    config.env = 'development';
    const parentOnlyClauses = getAiMetaFilterClauses('facebook', {
      ai_category_id: ['1009'],
    });
    const parentAndChildClauses = getAiMetaFilterClauses('facebook', {
      ai_category_id: ['1009'],
      ai_subcategory_id: ['10090001', '10090002'],
    });

    expect(parentOnlyClauses).toEqual(expect.arrayContaining([
      { terms: { 'ai.category_id': ['1009'] } },
    ]));
    expect(parentOnlyClauses).not.toEqual(expect.arrayContaining([
      { terms: { 'ai.subcategory_id': ['10090001', '10090002'] } },
    ]));
    expect(parentAndChildClauses).toEqual(expect.arrayContaining([
      { terms: { 'ai.category_id': ['1009'] } },
      { terms: { 'ai.subcategory_id': ['10090001', '10090002'] } },
    ]));
  });

  it('queries production offer_type through its keyword multi-field', () => {
    config.env = 'production';
    const clauses = getAiMetaFilterClauses('facebook', {
      ai_offer_type: ['percentage_discount'],
    });

    expect(clauses).toEqual([
      { bool: { should: [
        { terms: { 'ai_meta.offer_type.keyword': ['percentage_discount'] } },
        { terms: { 'ai_meta.offers.type': ['percentage_discount'] } },
      ], minimum_should_match: 1 } },
    ]);
  });

  it('expands offering_type product/service filters to include both', () => {
    const clauses = getAiMetaFilterClauses('facebook', {
      ai_offering_type: ['product'],
    });

    expect(clauses).toEqual([
      { terms: { 'ai.offering_type': ['product', 'both'] } },
    ]);
  });

  it('supports aligned taxonomy IDs alongside legacy category names', () => {
    const esParams = {
      body: {
        query: {
          bool: {
            filter: [
              { term: { 'youtube.category.keyword': '1009' } },
              { bool: { should: [
                { term: { 'youtube.subCategory.keyword': '10090001' } },
                { bool: { must_not: [{ exists: { field: 'youtube.subCategory.keyword' } }] } },
              ], minimum_should_match: 1 } },
            ],
          },
        },
      },
    };

    applyAiMetaFilters(esParams, 'youtube', {
      adcategory: ['1009'],
      subCategory: ['10090001'],
    });

    expect(esParams.body.query.bool.filter[0]).toEqual({
      bool: {
        should: [
          { term: { 'youtube.category.keyword': '1009' } },
          { terms: { category_id: ['1009'] } },
        ],
        minimum_should_match: 1,
      },
    });
    expect(esParams.body.query.bool.filter[1].bool.should).toEqual(expect.arrayContaining([
      { terms: { subCategory_id: ['10090001'] } },
    ]));

    const displayClauses = getLegacyCategoryFilterClauses('youtube', {
      adcategory: ['Computer Software'],
      subCategory: ['Browser Extensions'],
    });
    expect(displayClauses).toEqual([
      { term: { 'youtube.category.keyword': 'Computer Software' } },
      { bool: { should: [
        { term: { 'youtube.subCategory.keyword': 'Browser Extensions' } },
        { bool: { must_not: [{ exists: { field: 'youtube.subCategory.keyword' } }] } },
      ], minimum_should_match: 1 } },
    ]);

    expect(getLegacyCategoryFilterClauses('youtube', {
      adcategory: ['1009'],
      subCategory: ['10090001'],
    })).toEqual([
      { bool: { should: [
        { term: { 'youtube.category.keyword': '1009' } },
        { terms: { category_id: ['1009'] } },
      ], minimum_should_match: 1 } },
      { bool: { should: [
        { bool: { should: [
          { term: { 'youtube.subCategory.keyword': '10090001' } },
          { bool: { must_not: [{ exists: { field: 'youtube.subCategory.keyword' } }] } },
        ], minimum_should_match: 1 } },
        { terms: { subCategory_id: ['10090001'] } },
      ], minimum_should_match: 1 } },
    ]);
  });

  it('unions outer and AI category sources without widening other filters', () => {
    const esParams = {
      body: {
        query: {
          bool: {
            filter: [
              { term: { 'youtube.category.keyword': '1009' } },
              { term: { country: 'India' } },
            ],
          },
        },
      },
    };

    applyAiMetaFilters(esParams, 'youtube', {
      has_ai_meta: true,
      adcategory: ['1009'],
      ai_category_id: ['1009'],
    });

    const filters = esParams.body.query.bool.filter;
    expect(filters).toContainEqual({ term: { country: 'India' } });
    expect(filters).toContainEqual(getAiMetaNonCategoryFilterClauses('youtube', { has_ai_meta: true })[0]);
    expect(filters).toContainEqual({
      bool: {
        should: [
          {
            bool: {
              should: [
                { term: { 'youtube.category.keyword': '1009' } },
                { terms: { category_id: ['1009'] } },
              ],
              minimum_should_match: 1,
            },
          },
          ...getAiMetaCategoryFilterClauses('youtube', { ai_category_id: ['1009'] }),
        ],
        minimum_should_match: 1,
      },
    });

    expect(combineCategorySources(
      [{ term: { 'youtube.category.keyword': 'Computer Software' } }],
      getAiMetaCategoryFilterClauses('youtube', { ai_category_id: ['1009'] }),
    )).toEqual([{
      bool: {
        should: [
          { term: { 'youtube.category.keyword': 'Computer Software' } },
          { terms: { 'ai.category_id': ['1009'] } },
        ],
        minimum_should_match: 1,
      },
    }]);
  });
});

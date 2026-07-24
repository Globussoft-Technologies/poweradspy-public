import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../../../../src/config');
const {
  applyAiMetaFilters,
  getAiMetaFilterClauses,
  getAiMetaEsField,
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

  it('maps fixed contract fields and an offer range to the resolved ES object', () => {
    const clauses = getAiMetaFilterClauses('google', {
      ai_ad_type: ['promotional', 'demonstration'],
      ai_intent: 'conversion,lead_generation',
      ai_offer_type: ['percentage_discount'],
      ai_offer_value: [50, 10],
      ai_category_id: '1038',
    });

    expect(clauses).toEqual(expect.arrayContaining([
      { terms: { 'ai.ad_type': ['promotional', 'demonstration'] } },
      { terms: { 'ai.intent': ['conversion', 'lead_generation'] } },
      { terms: { 'ai.offers.type': ['percentage_discount'] } },
      { terms: { 'ai.category_id': ['1038'] } },
      { range: { 'ai.offers.value': { gte: 10, lte: 50 } } },
    ]));
  });
});

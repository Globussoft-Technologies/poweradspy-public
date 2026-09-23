import { describe, expect, it } from 'vitest';

import { verifyAiExpectations } from '../../src/utils/aiSearchVerification';

describe('verifyAiExpectations', () => {
  it('reports verified, violated, and unverifiable fields without dropping aliases', () => {
    const report = verifyAiExpectations([
      {
        filter: 'network',
        record_fields: ['network', 'platform'],
        comparator: 'equals_any',
        values: ['Facebook'],
      },
      {
        filter: 'likes',
        record_fields: ['likes'],
        comparator: 'range',
        min: 500,
        max: 1000,
      },
      {
        filter: 'ecommerce',
        record_fields: ['ecommerce', 'ecommerce_platform'],
        comparator: 'present',
      },
    ], [
      { platform: 'facebook', likes: '600', ecommerce_platform: 'shopify' },
      { platform: 'facebook', likes: '1200' },
    ]);

    expect(report.filters).toMatchObject([
      { filter: 'network', status: 'verified', actualFields: ['platform'] },
      { filter: 'likes', status: 'violated', recordsFailed: 1 },
      { filter: 'ecommerce', status: 'verified', actualFields: ['ecommerce_platform'] },
    ]);
  });

  it('marks an expectation unverifiable and exposes returned record field names', () => {
    const report = verifyAiExpectations([
      { filter: 'market_platform', record_fields: ['market_platform'], comparator: 'present' },
    ], [{ network: 'youtube', platform: 'youtube' }]);

    expect(report.filters[0]).toMatchObject({
      status: 'unverifiable',
      actualFields: ['network', 'platform'],
      recordsChecked: 0,
    });
  });
});

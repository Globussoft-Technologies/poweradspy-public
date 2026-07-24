import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Builder = require('../../../../src/services/google/builders/GoogleSearchQueryBuilder');

describe('Google Transparency search filters', () => {
  it('existing last-seen range searches top-level and nested last_seen', () => {
    const query = new Builder()
      .setLastSeen({ lower_date: '2025-12-12 00:00:00', upper_date: '2025-12-21 23:59:59' })
      .build();
    const json = JSON.stringify(query.body.query);
    expect(json).toContain('"last_seen"');
    expect(json).toContain('"country_details.last_seen"');
    expect(json).toContain('"path":"country_details"');
    expect(json).toContain('"minimum_should_match":1');
  });

  it('keeps country, seen dates, and impressions in one nested row', () => {
    const query = new Builder()
      .setCountry(['Germany'])
      .setCountryDelivery({
        countries: ['Germany'],
        countryCodes: ['DE'],
        firstSeen: { gte: '2025-12-01', lte: '2025-12-31' },
        lastSeen: { gte: '2025-12-12', lte: '2025-12-21' },
        timesShown: { min: 0, max: 1000 },
      })
      .build();
    const nested = query.body.query.bool.filter.find((filter) => filter.nested);
    expect(nested.nested.path).toBe('country_details');
    const json = JSON.stringify(nested);
    expect(json).toContain('"country_details.country":"Germany"');
    expect(json).toContain('"country_details.country_code":"DE"');
    expect(json).toContain('"country_details.first_seen"');
    expect(json).toContain('"country_details.last_seen"');
    expect(json).toContain('"country_details.times_shown.max"');
    expect(json).toContain('"country_details.times_shown.min"');
  });
});

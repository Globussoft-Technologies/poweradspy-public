import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  normalizeTransparencyPayload,
  mysqlDateTime,
  daysRunning,
  UNKNOWN_POST_DATE_SQL,
} = require('../../../../src/services/google/transparencyInsertion/normalize');

describe('Google Transparency normalization', () => {
  it('normalizes RFC3339 timestamps for SQL', () => {
    expect(mysqlDateTime('2025-12-12T10:30:45Z')).toBe('2025-12-12 10:30:45');
    expect(mysqlDateTime('2025-12-12 10:30:45')).toBe('2025-12-12 10:30:45');
    expect(mysqlDateTime(null)).toBeNull();
  });

  it('computes inclusive running days', () => {
    expect(daysRunning('2025-12-01T00:00:00Z', '2025-12-03T00:00:00Z')).toBe(3);
  });

  it('keeps contract fields and adds SQL projections', () => {
    const result = normalizeTransparencyPayload({
      post_owner: ' Owner ',
      system_id: ' worker ',
      first_seen: null,
      last_seen: '2025-12-21T00:00:00Z',
      post_date: null,
      destination_url: 'https://www.example.com/path',
      country_details: [],
    });
    expect(result.post_owner).toBe('Owner');
    expect(result.domain).toBe('example.com');
    expect(result.lastSeenSql).toBe('2025-12-21 00:00:00');
    expect(result.postDateSql).toBe(UNKNOWN_POST_DATE_SQL);
    expect(result.postDateEs).toBeNull();
    expect(result.adPosition).toBe('FEED');
    expect(result.hasPayloadLastSeen).toBe(true);
  });

  it('preserves a nullable post owner', () => {
    const result = normalizeTransparencyPayload({
      post_owner: null, system_id: 'worker', first_seen: null, last_seen: null,
      post_date: null, destination_url: null, country_details: [],
    });
    expect(result.post_owner).toBeNull();
    expect(result.hasPayloadLastSeen).toBe(false);
  });

  it('projects nullable country-level first_seen and last_seen timestamps', () => {
    const result = normalizeTransparencyPayload({
      post_owner: null, system_id: 'worker', first_seen: null, last_seen: null,
      post_date: null, destination_url: null,
      country_details: [{
        country: 'Germany', country_code: 'DE',
        first_seen: '2025-12-12T00:00:00Z', last_seen: null, times_shown: null,
      }],
    });
    expect(result.countryDetailsSql[0].firstSeenSql).toBe('2025-12-12 00:00:00');
    expect(result.countryDetailsSql[0].lastSeenSql).toBeNull();
  });
});

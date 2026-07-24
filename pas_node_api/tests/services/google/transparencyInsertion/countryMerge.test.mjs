import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  ensureCountry,
  mergeCountryDelivery,
} = require('../../../../src/services/google/transparencyInsertion/repository');

describe('Google Transparency country delivery merge', () => {
  it('uses empty city/state values required by the shared non-null schema', async () => {
    const calls = [];
    const exec = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT id FROM google_text_country_only')) return [{ id: 10 }];
        if (sql.includes('FROM google_text_country WHERE')) return [];
        if (sql.startsWith('INSERT INTO google_text_country')) return { insertId: 11 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    await expect(ensureCountry(exec, 'Germany')).resolves.toEqual({
      countryId: 11,
      countryOnlyId: 10,
    });
    const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO google_text_country'));
    expect(insert.sql).toContain("VALUES ('', '', ?, ?, 1)");
    expect(insert.params).toEqual(['Germany', 10]);
  });

  it('updates an existing country and appends a new country without deleting either', async () => {
    const deliveryWrites = [];
    let deliveryReads = 0;
    const exec = {
      query: async (sql, params) => {
        if (sql.includes('FROM google_transparency_country_delivery d')) {
          deliveryReads++;
          return deliveryReads === 1
            ? [{ country: 'Germany', country_code: 'DE', ordinal: 0 }]
            : [
                { country: 'Germany', country_code: 'DE', ordinal: 0 },
                { country: 'India', country_code: 'IN', ordinal: 1 },
              ];
        }
        if (sql.startsWith('SELECT id FROM google_text_country_only')) {
          return [{ id: params[0] === 'Germany' ? 10 : 20 }];
        }
        if (sql.includes('FROM google_text_country WHERE')) {
          return [{ id: params[0] === 'Germany' ? 11 : 21 }];
        }
        if (sql.startsWith('SELECT id FROM google_text_ad_countries ')) return [{ id: 31 }];
        if (sql.startsWith('SELECT id FROM google_text_ad_countries_only')) return [{ id: 32 }];
        if (sql.includes('INSERT INTO google_transparency_country_delivery')) {
          deliveryWrites.push({ sql, params });
        }
        return { affectedRows: 1 };
      },
    };

    const rows = await mergeCountryDelivery(
      exec,
      42,
      [
        {
          country: 'Germany', country_code: 'DE',
          firstSeenSql: '2025-12-12 00:00:00', lastSeenSql: '2025-12-22 00:00:00',
          times_shown: { min: 100, max: 2000, operator: 'range' },
        },
        {
          country: 'India', country_code: 'IN',
          firstSeenSql: '2026-01-01 00:00:00', lastSeenSql: null,
          times_shown: { min: 0, max: 1000, operator: 'range' },
        },
      ],
      ['Germany', 'India'],
      '2026-01-02 00:00:00'
    );

    expect(deliveryWrites).toHaveLength(2);
    expect(deliveryWrites[0].params.slice(0, 4)).toEqual([42, 10, 0, 'DE']);
    expect(deliveryWrites[1].params.slice(0, 4)).toEqual([42, 20, 1, 'IN']);
    expect(deliveryWrites[1].params[5]).toBe('2026-01-02 00:00:00');
    expect(deliveryWrites.every(({ sql }) => sql.includes('ON DUPLICATE KEY UPDATE'))).toBe(true);
    expect(rows.map((row) => row.country)).toEqual(['Germany', 'India']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const applyScript = require('../../../../scripts/apply-google-transparency-schema');
const rollbackScript = require('../../../../scripts/rollback-google-transparency-schema');

describe('Google Transparency schema scripts', () => {
  it.each([
    ['DatabaseManager rows', [{ COLUMN_NAME: 'first_seen', DATA_TYPE: 'datetime' }]],
    ['mysql2 tuple', [[{ COLUMN_NAME: 'first_seen', DATA_TYPE: 'datetime' }], []]],
  ])('normalizes %s query results', (_label, result) => {
    expect(applyScript.selectRows(result)).toEqual([
      { COLUMN_NAME: 'first_seen', DATA_TYPE: 'datetime' },
    ]);
  });

  it('does not alter already-current country date columns', async () => {
    const sql = {
      query: vi.fn(async () => [
        { COLUMN_NAME: 'first_seen', DATA_TYPE: 'datetime' },
        { COLUMN_NAME: 'last_seen', DATA_TYPE: 'datetime' },
      ]),
    };

    await applyScript.migrateCountryDateColumns(sql);

    expect(sql.query).toHaveBeenCalledTimes(1);
  });

  it('reads rollback counts from the project DatabaseManager result shape', async () => {
    const sql = { query: vi.fn(async () => [{ count: 12 }]) };

    await expect(rollbackScript.existingRowCount(sql, 'google_transparency_ad_payload'))
      .resolves.toBe(12);
  });
});

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

  it('adds the nullable payload last_shown column when missing', async () => {
    const sql = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };

    await applyScript.ensurePayloadLastShownColumn(sql);

    expect(sql.query).toHaveBeenLastCalledWith(
      'ALTER TABLE google_transparency_ad_payload ADD COLUMN last_shown DATETIME NULL AFTER region_code'
    );
  });

  it('keeps an existing payload last_shown column unchanged', async () => {
    const sql = { query: vi.fn(async () => [{ COLUMN_NAME: 'last_shown' }]) };

    await applyScript.ensurePayloadLastShownColumn(sql);

    expect(sql.query).toHaveBeenCalledTimes(1);
  });

  it('reads rollback counts from the project DatabaseManager result shape', async () => {
    const sql = { query: vi.fn(async () => [{ count: 12 }]) };

    await expect(rollbackScript.existingRowCount(sql, 'google_transparency_ad_payload'))
      .resolves.toBe(12);
  });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { deleteAdCascade } = require('../../../../src/services/google/insertion/repository');

describe('Google Transparency delete compatibility', () => {
  it('deletes platform-18 children before the canonical Google ad', async () => {
    const calls = [];
    const exec = {
      query: async (sql, params) => {
        calls.push([sql, params]);
        return sql === 'DELETE FROM google_text_ad WHERE id = ?' ? { affectedRows: 1 } : { affectedRows: 0 };
      },
    };

    await expect(deleteAdCascade(exec, 42)).resolves.toBe(1);
    expect(calls.slice(0, 2)).toEqual([
      ['DELETE FROM google_transparency_country_delivery WHERE google_text_ad_id = ?', [42]],
      ['DELETE FROM google_transparency_ad_payload WHERE google_text_ad_id = ?', [42]],
    ]);
    expect(calls.at(-1)).toEqual(['DELETE FROM google_text_ad WHERE id = ?', [42]]);
  });

  it('keeps delete compatible before the new tables are installed', async () => {
    const exec = {
      query: async (sql) => {
        if (sql.includes('google_transparency_')) {
          const error = new Error('table missing');
          error.code = 'ER_NO_SUCH_TABLE';
          throw error;
        }
        return sql === 'DELETE FROM google_text_ad WHERE id = ?' ? { affectedRows: 1 } : { affectedRows: 0 };
      },
    };

    await expect(deleteAdCascade(exec, 42)).resolves.toBe(1);
  });
});

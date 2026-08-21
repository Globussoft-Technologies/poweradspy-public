import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const requeue = require('../../../scripts/admob/requeue-lander-ads');

describe('AdMob lander requeue script', () => {
  it('builds a cleanup plan that skips missing optional tables without blocking redirect reset', () => {
    const plan = requeue.buildCleanupPlan(
      { deleteLanderContent: true },
      new Set(['mob_es_outbox', 'mob_ad_lander_content'])
    );

    expect(plan).toEqual({
      clearClaims: false,
      clearOutbox: true,
      deleteLanderContent: true,
      skippedTables: ['mob_ad_lander_claims'],
    });
  });

  it('reads existing helper tables from information_schema into a set', async () => {
    const sql = {
      query: vi.fn().mockResolvedValue([
        { table_name: 'mob_es_outbox' },
        { TABLE_NAME: 'mob_ad_lander_claims' },
      ]),
    };

    const tables = await requeue.getExistingTables(sql, [
      'mob_es_outbox',
      'mob_ad_lander_claims',
      'mob_ad_lander_content',
    ]);

    expect(sql.query).toHaveBeenCalledTimes(1);
    expect(sql.query.mock.calls[0][0]).toContain('FROM information_schema.tables');
    expect(tables).toEqual(new Set(['mob_es_outbox', 'mob_ad_lander_claims']));
  });

  it('does not query mob_ad_lander_content for --from-lander-table when that table is absent', async () => {
    const sql = {
      query: vi.fn().mockResolvedValue([
        { id: 17, ad_id: 'public-17' },
      ]),
    };

    const targets = await requeue.resolveTargets(
      sql,
      {
        fromLanderTable: true,
        internalIds: [],
        publicAdIds: ['public-17'],
      },
      new Set(['mob_es_outbox'])
    );

    expect(targets).toEqual([{ id: 17, ad_id: 'public-17' }]);
    expect(sql.query).toHaveBeenCalledTimes(1);
    expect(sql.query.mock.calls[0][0]).toContain('FROM mob_ads');
    expect(sql.query.mock.calls[0][0]).not.toContain('FROM mob_ad_lander_content');
  });
});

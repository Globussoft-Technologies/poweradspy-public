import { describe, expect, it, vi } from 'vitest';
import jobModule from '../../src/services/admob/jobs/admobEsOutboxJob.js';

const { runAdmobEsOutbox } = jobModule;

function dependencies({ pending = [], indexError = null } = {}) {
  const sql = {};
  const elastic = {
    indexName: 'mob_search_mix',
    esMajor: 6,
    index: vi.fn(async () => {
      if (indexError) throw indexError;
    }),
  };
  const repository = {
    getPendingEs: vi.fn(async () => pending),
    getCompleteAd: vi.fn(async () => ({ id: 1 })),
    completeEs: vi.fn(async () => {}),
    failEs: vi.fn(async () => {}),
  };
  return {
    sql,
    elastic,
    repository,
    deps: {
      databaseManager: {
        getSQL: vi.fn(() => sql),
        getElastic: vi.fn(() => elastic),
      },
      repository,
      buildDocument: vi.fn(() => ({ id: 1, ad_id: 'ADMOB-1' })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
  };
}

describe('AdMob Elasticsearch outbox worker', () => {
  it('indexes pending ads and deletes only successful outbox rows', async () => {
    const setup = dependencies({ pending: [{ ad_id: 1, public_ad_id: 'ADMOB-1', attempts: 0 }] });

    const result = await runAdmobEsOutbox({ batchSize: 25, maxAttempts: 10 }, setup.deps);

    expect(setup.repository.getPendingEs).toHaveBeenCalledWith(setup.sql, 25, 10);
    expect(setup.elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      index: 'mob_search_mix', id: '1', type: 'doc', refresh: false,
    }));
    expect(setup.repository.completeEs).toHaveBeenCalledWith(setup.sql, 1);
    expect(setup.repository.failEs).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: false, processed: 1, indexed: 1, failed: 0 });
  });

  it('keeps failed rows and records retry state', async () => {
    const setup = dependencies({
      pending: [{ ad_id: 7, public_ad_id: 'ADMOB-7', attempts: 2 }],
      indexError: new Error('ES unavailable'),
    });

    const result = await runAdmobEsOutbox({}, setup.deps);

    expect(setup.repository.completeEs).not.toHaveBeenCalled();
    expect(setup.repository.failEs).toHaveBeenCalledWith(setup.sql, 7, 'ES unavailable');
    expect(result).toEqual({ skipped: false, processed: 1, indexed: 0, failed: 1 });
  });

  it('skips safely when an AdMob database connection is unavailable', async () => {
    const setup = dependencies();
    setup.deps.databaseManager.getElastic.mockReturnValue(null);

    const result = await runAdmobEsOutbox({}, setup.deps);

    expect(setup.repository.getPendingEs).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: true, processed: 0, indexed: 0, failed: 0 });
  });
});

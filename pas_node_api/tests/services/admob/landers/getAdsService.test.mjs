import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = require('../../../../src/services/admob/landers/repository.js');
const service = require('../../../../src/services/admob/landers/getAdsService.js');

const originalRepoFns = {
  withTransaction: repo.withTransaction,
  updateRedirectStatus: repo.updateRedirectStatus,
  getNeverProcessedAds: repo.getNeverProcessedAds,
  getPreviouslyProcessedAds: repo.getPreviouslyProcessedAds,
  claimAdForToday: repo.claimAdForToday,
  clampLimit: repo.clampLimit,
};

afterEach(() => {
  Object.assign(repo, originalRepoFns);
  vi.restoreAllMocks();
});

describe('admob get_ads_for_blackhat service', () => {
  it('requires x-scraper-name so PAS can prevent same-day duplicate pickup', async () => {
    const result = await service.getAdmobAdsWithCountry(
      { query: { status: 0 }, headers: {} },
      { sql: {}, elastic: {} },
      { error() {} },
    );

    expect(result.code).toBe(422);
    expect(result.message).toBe('The x-scraper-name header is required.');
  });

  it('rejects GET status values other than 0 and 2', async () => {
    const result = await service.getAdmobAdsWithCountry(
      { query: { status: 7 }, headers: { 'x-scraper-name': 'scraper-a' } },
      { sql: {}, elastic: {} },
      { error() {} },
    );

    expect(result.code).toBe(422);
    expect(result.message).toBe('The status filter is invalid.');
  });

  it('returns never-processed ads only after ES validation and a same-day claim', async () => {
    repo.getNeverProcessedAds = vi.fn(async () => ([
      { id: 11, ad_id: 'AD-1', destination_url: 'https://a.example', country: 'US, CA' },
      { id: 12, ad_id: 'AD-2', destination_url: 'https://b.example', country: 'IN' },
    ]));
    repo.withTransaction = vi.fn(async (sql, work) => work({ query: sql.query }));
    repo.claimAdForToday = vi.fn(async () => true);
    repo.updateRedirectStatus = vi.fn(async () => {});
    repo.getPreviouslyProcessedAds = vi.fn(async () => []);
    repo.clampLimit = vi.fn((value, fallback) => Number(value ?? fallback));

    const sql = {
      query: vi.fn(async () => []),
    };
    const elastic = {
      indexName: 'mob_search_mix',
      search: vi.fn(async () => ({
        body: {
          hits: {
            hits: [
              { _source: { ad_id: 'ad-1' } },
            ],
          },
        },
      })),
    };

    const result = await service.getAdmobAdsWithCountry(
      { query: { status: 0, limit: 10 }, headers: { 'x-scraper-name': 'scraper-a' } },
      { sql, elastic },
      { error() {} },
    );

    expect(result.code).toBe(200);
    expect(result.message).toBe('Ads fetched successfully');
    expect(result.data).toEqual([
      {
        id: 11,
        ad_id: 11,
        destination_url: 'https://a.example',
        country: ['US', 'CA'],
      },
    ]);
    expect(repo.getNeverProcessedAds).toHaveBeenCalledWith(sql, 10);
    expect(repo.claimAdForToday).toHaveBeenCalledWith(expect.anything(), 11, 'scraper-a', 0);
    expect(repo.updateRedirectStatus).toHaveBeenCalledWith(expect.anything(), 11, 2);
    expect(repo.claimAdForToday).toHaveBeenCalledWith(expect.anything(), 12, 'scraper-a', 0);
    expect(repo.updateRedirectStatus).toHaveBeenCalledWith(expect.anything(), 12, 5);
  });

  it('uses the previously-processed queue for status=2 and skips same-day claim collisions', async () => {
    repo.getNeverProcessedAds = vi.fn(async () => []);
    repo.getPreviouslyProcessedAds = vi.fn(async () => ([
      { id: 21, ad_id: 'AD-21', destination_url: 'https://old.example', country: 'GB' },
    ]));
    repo.withTransaction = vi.fn(async (sql, work) => work({ query: sql.query }));
    repo.claimAdForToday = vi.fn(async () => false);
    repo.updateRedirectStatus = vi.fn(async () => {});
    repo.clampLimit = vi.fn((value, fallback) => Number(value ?? fallback));

    const result = await service.getAdmobAdsWithCountry(
      {
        query: { status: 2 },
        headers: { 'x-scraper-name': 'scraper-b' },
      },
      {
        sql: { query: vi.fn(async () => []) },
        elastic: {
          search: vi.fn(async () => ({
            body: { hits: { hits: [{ _source: { ad_id: 'ad-21' } }] } },
          })),
        },
      },
      { error() {} },
    );

    expect(result.code).toBe(200);
    expect(result.message).toBe('No Ads found');
    expect(result.data).toEqual([]);
    expect(repo.getPreviouslyProcessedAds).toHaveBeenCalled();
    expect(repo.getNeverProcessedAds).not.toHaveBeenCalled();
  });

  it('claims ES misses for the current day so the same missing doc is not retried in a hot loop', async () => {
    repo.withTransaction = vi.fn(async (sql, work) => work({ query: sql.query }));
    repo.claimAdForToday = vi.fn(async () => true);
    repo.updateRedirectStatus = vi.fn(async () => {});

    const claimed = await service.markEsMiss(
      { query: vi.fn(async () => []) },
      { id: 77, ad_id: 'AD-77' },
      'scraper-es-miss',
      0,
    );

    expect(claimed).toBe(true);
    expect(repo.claimAdForToday).toHaveBeenCalledWith(expect.anything(), 77, 'scraper-es-miss', 0);
    expect(repo.updateRedirectStatus).toHaveBeenCalledWith(expect.anything(), 77, 5);
  });
});

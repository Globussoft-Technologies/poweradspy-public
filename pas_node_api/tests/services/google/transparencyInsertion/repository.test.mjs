import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ensureDomainRecord, upsertTransparency } = require(
  '../../../../src/services/google/transparencyInsertion/repository'
);

describe('Google Transparency repository', () => {
  it('returns the existing domain id and timezone-safe registration date in one lookup', async () => {
    const exec = {
      query: vi.fn(async () => [{ id: 12, domain_registered_date: '2004-06-04' }]),
    };

    await expect(ensureDomainRecord(exec, 'example.com')).resolves.toEqual({
      id: 12,
      domain_registered_date: '2004-06-04',
    });
    expect(exec.query).toHaveBeenCalledOnce();
    expect(exec.query.mock.calls[0][0]).toContain("DATE_FORMAT(domain_registered_date, '%Y-%m-%d')");
    expect(exec.query.mock.calls[0][1]).toEqual(['example.com']);
  });

  it('returns a null registration date when it creates a pending domain', async () => {
    const exec = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ insertId: 13 }),
    };

    await expect(ensureDomainRecord(exec, 'new.example')).resolves.toEqual({
      id: 13,
      domain_registered_date: null,
    });
  });

  it('re-reads the domain and date after a concurrent insert wins the race', async () => {
    const duplicate = Object.assign(new Error('duplicate domain'), { code: 'ER_DUP_ENTRY' });
    const exec = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(duplicate)
        .mockResolvedValueOnce([{ id: 14, domain_registered_date: '2010-05-06' }]),
    };

    await expect(ensureDomainRecord(exec, 'raced.example')).resolves.toEqual({
      id: 14,
      domain_registered_date: '2010-05-06',
    });
    expect(exec.query).toHaveBeenCalledTimes(3);
    expect(exec.query.mock.calls[2][1]).toEqual(['raced.example']);
  });

  it('does not query SQL when the ad has no destination domain', async () => {
    const exec = { query: vi.fn() };

    await expect(ensureDomainRecord(exec, null)).resolves.toBeNull();
    expect(exec.query).not.toHaveBeenCalled();
  });

  it.each([
    ['timestamp', '2026-07-27 00:00:00'],
    ['explicit null', null],
  ])('always writes last_shown from the latest payload (%s)', async (_label, lastShownSql) => {
    const exec = { query: vi.fn(async () => []) };

    await upsertTransparency(exec, 179596, {
      advertiser_id: 'AR1',
      ad_url: 'https://adstransparency.google.com/creative/CR1',
      subnetwork: 'YOUTUBE',
      region_code: 'US',
      impressions: null,
      lastShownSql,
      video_url_original: null,
      redirect_url: null,
      othermultimedia: [],
    });

    const [statement, params] = exec.query.mock.calls[0];
    expect(statement).toContain('last_shown=VALUES(last_shown)');
    expect(params[8]).toBe(lastShownSql);
  });
});

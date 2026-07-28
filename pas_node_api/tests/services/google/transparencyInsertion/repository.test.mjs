import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { upsertTransparency } = require(
  '../../../../src/services/google/transparencyInsertion/repository'
);

describe('Google Transparency repository', () => {
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

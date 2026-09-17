import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeAdmobPayload } = require('../../../../src/services/admob/insertion/normalize');

describe('AdMob insertion normalization', () => {
  it('stores the final landing host from a nested tracking URL', () => {
    const result = normalizeAdmobPayload({
      ad_id: 'ad-1',
      country: [],
      destination_url: 'https://ad.doubleclick.net/track?https://turbotax.intuit.com/lp/byp/1495/',
    });
    expect(result.destination_host).toBe('turbotax.intuit.com');
  });
});

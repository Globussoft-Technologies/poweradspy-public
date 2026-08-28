import { describe, expect, it } from 'vitest';

import { mapArgsToFilters, normalizeAiSearchArgs } from '../../src/services/aiSearchMapper';

describe('aiSearchMapper', () => {
  it('forwards exact_search for explicit advertiser payloads', () => {
    const mapped = mapArgsToFilters({
      advertiser: 'Apple',
      network: ['facebook'],
      exact_search: 1,
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [
            { label: 'Facebook', value: 'facebook' },
            { label: 'Instagram', value: 'instagram' },
          ],
        }],
      }],
    });

    expect(mapped.searchQuery).toBe('Apple');
    expect(mapped.searchIn).toBe('advertiser');
    expect(mapped.activePlatforms).toEqual(['facebook']);
    expect(mapped.exactSearch).toBe(true);
  });

  it('defaults exact_search to false when DS omits it', () => {
    const mapped = mapArgsToFilters({ domain: 'apple.com' }, {});

    expect(mapped.searchQuery).toBe('apple.com');
    expect(mapped.searchIn).toBe('domain');
    expect(mapped.exactSearch).toBe(false);
  });

  it('falls back to full_payload exact_search when args omits it', () => {
    const args = normalizeAiSearchArgs({
      args: {
        advertiser: 'Apple',
        network: ['facebook'],
      },
      full_payload: {
        advertiser: 'Apple',
        network: ['facebook'],
        exact_search: 1,
      },
    });

    const mapped = mapArgsToFilters(args, {});

    expect(args.exact_search).toBe(1);
    expect(mapped.searchIn).toBe('advertiser');
    expect(mapped.searchQuery).toBe('Apple');
    expect(mapped.exactSearch).toBe(true);
  });
});

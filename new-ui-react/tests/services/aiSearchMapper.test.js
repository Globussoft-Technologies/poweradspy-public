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

  it('hydrates DS AI filter fields into frontend filter state', () => {
    const mapped = mapArgsToFilters({
      keyword: 'skincare products',
      network: ['instagram'],
      has_ai_meta: true,
      ai_ad_type: ['testimonial'],
      ai_intent: ['conversion'],
      ai_category_id: ['1009'],
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [
            { label: 'Instagram', value: 'instagram' },
          ],
        }],
      }],
      sidebar: [{
        filters: [
          { _id: 'has_ai_meta', type: 'toggle' },
          {
            _id: 'ai_ad_type',
            type: 'chip_multi_select',
            options: [{ label: 'Testimonial', value: 'testimonial' }],
          },
          {
            _id: 'ai_intent',
            type: 'chip_multi_select',
            options: [{ label: 'Conversion', value: 'conversion' }],
          },
          {
            _id: 'ai_category_id',
            type: 'nested_select',
            parent_filter_id: 'ai_category_id',
            child_filter_id: 'ai_subcategory_id',
            options: [{ label: 'Beauty', value: '1009' }],
          },
        ],
      }],
    });

    expect(mapped.activePlatforms).toEqual(['instagram']);
    expect(mapped.filterValues).toMatchObject({
      has_ai_meta: true,
      ai_ad_type: ['testimonial'],
      ai_intent: ['conversion'],
      ai_category_id: ['1009'],
    });
  });

  it('inherits AI fields from full_payload when args omits them', () => {
    const args = normalizeAiSearchArgs({
      args: {
        keyword: 'skincare products',
        network: ['instagram'],
      },
      full_payload: {
        keyword: 'skincare products',
        network: ['instagram'],
        has_ai_meta: true,
        ai_ad_type: ['testimonial'],
      },
    });

    expect(args).toMatchObject({
      has_ai_meta: true,
      ai_ad_type: ['testimonial'],
    });
  });
});

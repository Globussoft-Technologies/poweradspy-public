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

  it('hydrates nested AI category selections like a manual parent selection', () => {
    const mapped = mapArgsToFilters({
      adcategory: ['Ad Safety Risk'],
    }, {
      sidebar: [{
        filters: [{
          _id: 'categories',
          type: 'nested_select',
          options: [{
            label: 'Ad Safety Risk',
            value: 'Ad Safety Risk',
            children: [
              { label: 'General Ad Safety Risk', value: 'General Ad Safety Risk' },
              { label: 'Restricted Products', value: 'Restricted Products' },
            ],
          }],
        }],
      }],
    });

    expect(mapped.filterValues).toEqual({
      adcategory: ['Ad Safety Risk'],
      subcategory: ['General Ad Safety Risk', 'Restricted Products'],
    });
    expect(mapped.filterValues).not.toHaveProperty('categories');
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

  it('carries AI posted-date presets through the regular date filter state', () => {
    const mapped = mapArgsToFilters({
      network: ['facebook'],
      datePreset: 'last_30_days',
    }, {});

    expect(mapped.filterValues.post_date_btn_sort).toBe('last_30_days');
  });

  it('prefers an AI custom posted-date range over a preset', () => {
    const mapped = mapArgsToFilters({
      datePreset: 'last_30_days',
      dateRange: { startDate: '2026-08-13', endDate: '2026-09-11' },
    }, {});

    expect(mapped.filterValues.post_date_btn_sort).toEqual({
      startDate: '2026-08-13',
      endDate: '2026-09-11',
    });
  });

  it('maps planning date dimensions without forwarding planning metadata', () => {
    const posted = mapArgsToFilters(
      {},
      {},
      { date_filter: { field: 'post_date', preset: 'last_30_days' } },
    );
    const firstSeen = mapArgsToFilters(
      {},
      {},
      { date_filter: { field: 'first_seen', preset: 'last_7_days' } },
    );
    const lastSeen = mapArgsToFilters(
      { keyword: 'shoe' },
      {},
      { date_filter: { field: 'last_seen', preset: 'last_7_days' } },
    );
    const custom = mapArgsToFilters(
      {},
      {},
      {
        date_filter: {
          field: 'last_seen',
          start_date: '2026-08-01',
          end_date: '2026-09-11',
        },
      },
    );

    expect(posted.filterValues).toEqual({ post_date_btn_sort: 'last_30_days' });
    expect(firstSeen.filterValues).toEqual({ first_seen_btn_sort: 'last_7_days' });
    expect(lastSeen).toMatchObject({
      searchQuery: 'shoe',
      filterValues: { seen_btn_sort: 'last_7_days' },
    });
    expect(custom.filterValues).toEqual({
      seen_btn_sort: { startDate: '2026-08-01', endDate: '2026-09-11' },
    });
  });

  it('defaults a fieldless AI recency filter to last seen', () => {
    const mapped = mapArgsToFilters({}, {}, {
      date_filter: { preset: 'last_7_days' },
    });

    expect(mapped.filterValues).toEqual({ seen_btn_sort: 'last_7_days' });
    expect(mapped.unmappedDetails).toEqual([]);
  });

  it('preserves valid continuous age bounds for Common Ads Search', () => {
    const mapped = mapArgsToFilters({ lower_age: 25, upper_age: 34 }, {});

    expect(mapped.filterValues).toEqual({ lower_age: 25, upper_age: 34 });
    expect(mapped.unmappedDetails).toEqual([]);
  });

  it('rejects incomplete or invalid continuous age bounds', () => {
    const mapped = mapArgsToFilters({ lower_age: 25 }, {});
    const upperOnly = mapArgsToFilters({ upper_age: 34 }, {});
    const reversed = mapArgsToFilters({ lower_age: 34, upper_age: 25 }, {});

    expect(mapped.filterValues).toEqual({});
    expect(mapped.unmappedDetails).toContainEqual(expect.objectContaining({ field: 'age' }));
    expect(upperOnly.filterValues).toEqual({});
    expect(upperOnly.unmappedDetails).toContainEqual(expect.objectContaining({ field: 'age' }));
    expect(reversed.unmappedDetails).toContainEqual(expect.objectContaining({ field: 'age' }));
  });

  it('hydrates dimension-specific date args when DS sends the wire fields directly', () => {
    const mapped = mapArgsToFilters({
      first_seen_btn_sort: 'last_7_days',
      domain_date_btn_sort: { startDate: '2026-08-01', endDate: '2026-09-11' },
    }, {});

    expect(mapped.filterValues).toEqual({
      first_seen_btn_sort: 'last_7_days',
      domain_date_btn_sort: { startDate: '2026-08-01', endDate: '2026-09-11' },
    });
  });

  it('maps open-ended likes ranges without turning the missing bound into zero', () => {
    const mapped = mapArgsToFilters({
      network: ['facebook'],
      likes: { min: 500 },
    }, {
      sidebar: [{
        filters: [{
          _id: 'likes_range',
          type: 'range_slider',
          min: 0,
          max: 1000000,
        }],
      }],
    });

    expect(mapped.filterValues.likes_range).toEqual([500, 1000000]);
  });

  it('keeps the subject keyword when a bounded likes range is also requested', () => {
    const mapped = mapArgsToFilters({
      keyword: 'shoe',
      likes: { max: 4500 },
    }, {
      sidebar: [{
        filters: [{
          _id: 'likes_range',
          type: 'range_slider',
          min: 0,
          max: 1000000,
        }],
      }],
    });

    expect(mapped.searchQuery).toBe('shoe');
    expect(mapped.filterValues.likes_range).toEqual([0, 4500]);
  });

  it('maps a closed likes range without changing either boundary', () => {
    const mapped = mapArgsToFilters({
      likes: [500, 2000],
    }, {
      sidebar: [{
        filters: [{
          _id: 'likes_range',
          type: 'range_slider',
          min: 0,
          max: 1000000,
        }],
      }],
    });

    expect(mapped.filterValues.likes_range).toEqual([500, 2000]);
  });

  it('keeps impressions sorting distinct from popularity sorting', () => {
    const mapped = mapArgsToFilters({
      network: ['facebook'],
      order_column: 'impressions',
      order_by: 'desc',
    }, {
      navbar: [{
        filters: [{
          _id: 'sort_by',
          type: 'radio',
          options: [{ label: 'Impressions', value: 'impression' }],
        }],
      }],
    });

    expect(mapped.sortBy).toBe('impression');
    expect(mapped.sortBy).not.toBe('popular');
  });

  it('preserves ascending direction and domain-registration sorting', () => {
    const mapped = mapArgsToFilters({
      network: ['facebook'],
      order_column: 'domain_reg_date',
      order_by: 'asc',
    }, {});

    expect(mapped.sortBy).toBe('domain_sort');
    expect(mapped.sortDirection).toBe('asc');
  });

  it('resolves the deployed domain-registration sort alias', () => {
    const mapped = mapArgsToFilters({
      order_column: 'domain_reg_date',
      order_by: 'desc',
    }, {
      navbar: [{
        filters: [{
          _id: 'sort_by',
          type: 'radio',
          options: [{ label: 'Domain Registration Date', value: 'domain_reg_date' }],
        }],
      }],
    });

    expect(mapped.sortBy).toBe('domain_reg_date');
    expect(mapped.unmappedDetails).toEqual([]);
  });

  it('does not copy planner metadata into mapped search arguments', () => {
    const normalized = normalizeAiSearchArgs({
      args: { network: ['facebook'] },
      planning: {
        search_term_role: 'unsupported',
        consumed_phrases: ['highest views'],
        unsupported: [{ operation: 'sort', field: 'view', reason: 'unsupported' }],
        quick_filter: '',
      },
    });

    expect(normalized).not.toHaveProperty('planning');
    expect(mapArgsToFilters(normalized, {}).filterValues).toEqual({});
  });

  it('hydrates standard mode-specific fields into live SDUI state', () => {
    const mapped = mapArgsToFilters({
      network: ['google'],
      platform: 18,
      lang: ['en'],
      google_transparency_subnetwork: ['YOUTUBE'],
      ad_sub_position: ['top'],
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [{ label: 'Google', value: 'google' }],
        }],
      }],
      sidebar: [{
        filters: [
          {
            _id: 'language_filter',
            type: 'combobox',
            options: [{ label: 'English', value: 'en' }],
          },
          { _id: 'google_transparency_ads', type: 'toggle_switch' },
          {
            _id: 'google_transparency_subnetwork',
            type: 'dropdown',
            options: [{ label: 'YouTube', value: 'YOUTUBE' }],
          },
          {
            _id: 'ad_sub_position_filter',
            type: 'checkbox',
            options: [{ label: 'Top', value: 'top' }],
          },
        ],
      }],
    });

    expect(mapped.filterValues).toMatchObject({
      language_filter: ['en'],
      google_transparency_ads: true,
      google_transparency_subnetwork: 'YOUTUBE',
      ad_sub_position_filter: ['top'],
    });
    expect(mapped.unmappedDetails).toEqual([]);

    const sizeMapped = mapArgsToFilters({
      network: ['gdn'],
      size: ['300x250'],
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [{ label: 'GDN', value: 'gdn' }],
        }],
      }],
      sidebar: [{
        filters: [{
          _id: 'image_size_filter',
          type: 'checkbox',
          options: [{ label: '300x250', value: '300x250' }],
        }],
      }],
    });

    expect(sizeMapped.filterValues).toMatchObject({
      image_size_filter: ['300x250'],
    });

    const incompatibleSize = mapArgsToFilters({
      network: ['facebook'],
      size: ['300x250'],
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [{ label: 'Facebook', value: 'facebook' }],
        }],
      }],
      sidebar: [{
        filters: [{
          _id: 'image_size_filter',
          type: 'checkbox',
          options: [{ label: '300x250', value: '300x250' }],
        }],
      }],
    });

    expect(incompatibleSize.filterValues).not.toHaveProperty('image_size_filter');
    expect(incompatibleSize.unmappedDetails).toContainEqual(expect.objectContaining({
      field: 'size',
      reason: 'Image size requires only the GDN and/or AdMob network',
      network: ['facebook'],
    }));
  });

  it('hydrates AdMob poster fields and rejects incompatible modes explicitly', () => {
    const mapped = mapArgsToFilters({
      network: ['admob'],
      admobPosterSort: 'lead_score',
      leadScoreRange: { min: 10 },
      sub_network: ['banner'],
      source_app: ['example.app'],
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [{ label: 'AdMob', value: 'admob' }],
        }],
      }],
      sidebar: [{
        filters: [
          {
            _id: 'admob_poster_rank_filter',
            type: 'radio',
            options: [{ label: 'Top Ranked', value: 'lead_score' }],
          },
          { _id: 'admob_lead_score_range', type: 'range_slider', min: 0, max: 100 },
          {
            _id: 'admob_network_filter',
            type: 'checkbox',
            options: [{ label: 'Banner', value: 'banner' }],
          },
          {
            _id: 'admob_source_app_filter',
            type: 'checkbox',
            options: [{ label: 'Example', value: 'example.app' }],
          },
        ],
      }],
    });

    expect(mapped.filterValues).toMatchObject({
      admob_poster_rank_filter: 'lead_score',
      admob_lead_score_range: [10, 100],
      admob_network_filter: ['banner'],
      admob_source_app_filter: ['example.app'],
    });

    const incompatible = mapArgsToFilters({
      network: ['facebook'],
      platform: 18,
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [{ label: 'Facebook', value: 'facebook' }],
        }],
      }],
      sidebar: [{ filters: [{ _id: 'google_transparency_ads', type: 'toggle_switch' }] }],
    });

    expect(incompatible.filterValues).not.toHaveProperty('google_transparency_ads');
    expect(incompatible.unmappedDetails).toContainEqual(expect.objectContaining({
      field: 'google_transparency_ads',
      value: true,
      reason: 'Google Transparency mode requires only the Google network',
      network: ['facebook'],
    }));
  });

  it('maps DS camel-case AdMob query parameters without reporting them as unknown', () => {
    const mapped = mapArgsToFilters({
      network: ['admob'],
      subNetwork: ['gdn'],
      sourceApp: ['example.app'],
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [{ label: 'AdMob', value: 'admob' }],
        }],
      }],
      sidebar: [{
        filters: [
          {
            _id: 'admob_network_filter',
            type: 'checkbox',
            options: [{ label: 'GDN', value: 'gdn' }],
          },
          {
            _id: 'admob_source_app_filter',
            type: 'checkbox',
            options: [{ label: 'Example', value: 'example.app' }],
          },
        ],
      }],
    });

    expect(mapped.filterValues).toMatchObject({
      admob_network_filter: ['gdn'],
      admob_source_app_filter: ['example.app'],
    });
    expect(mapped.unmappedDetails).toEqual([]);
  });
});

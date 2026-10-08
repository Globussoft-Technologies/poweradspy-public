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

  it('keeps sort and type values when they only exist in full_payload', () => {
    const normalized = normalizeAiSearchArgs({
      args: { network: ['facebook'] },
      full_payload: {
        order_column: 'popularity',
        order_by: 'asc',
        type: ['VIDEO'],
      },
    });

    expect(normalized).toMatchObject({
      order_column: 'popularity',
      order_by: 'asc',
      type: ['VIDEO'],
    });
  });

  it('inherits CTA and AdMob size values when they only exist in full_payload', () => {
    const normalized = normalizeAiSearchArgs({
      args: { network: ['facebook', 'youtube'] },
      full_payload: {
        network: ['facebook', 'youtube'],
        call_to_action: ['More on This'],
        size: '1080*159',
      },
    });

    expect(normalized).toMatchObject({
      call_to_action: ['More on This'],
      size: '1080*159',
    });

    const ctaMapped = mapArgsToFilters(normalizeAiSearchArgs({
      args: { network: ['facebook', 'youtube'] },
      full_payload: { network: ['facebook', 'youtube'], call_to_action: ['More on This'] },
    }), {
      sidebar: [{
        filters: [{
          _id: 'cta_filter',
          type: 'chip_multi_select',
          options: [{ label: 'More on This', value: 'more on this' }],
        }],
      }],
    });

    expect(ctaMapped.filterValues).toMatchObject({
      cta_filter: ['more on this'],
    });
    expect(ctaMapped.unmappedDetails).toEqual([]);

    const defaultsOnly = mapArgsToFilters(normalizeAiSearchArgs({
      args: { network: ['facebook'] },
      full_payload: { network: ['facebook'], call_to_action: 'NA', size: 'NA' },
    }), {});

    expect(defaultsOnly.unmappedDetails).toEqual([]);
  });

  it('ignores the default full_payload post_date when no sort was requested', () => {
    const normalized = normalizeAiSearchArgs({
      args: {
        ai_category_id: ['1010'],
        has_ai_meta: true,
      },
      full_payload: {
        ai_category_id: ['1010'],
        has_ai_meta: true,
        order_column: 'post_date',
        order_by: 'desc',
        newest_sort: 'NA',
        last_seen_sort: 'NA',
        impression_sort: 'NA',
        popularity_sort: 'NA',
        domain_sort: 'NA',
        running_longest_sort: 'NA',
      },
    });

    expect(normalized).not.toHaveProperty('order_column');
    expect(normalized).not.toHaveProperty('order_by');
    expect(mapArgsToFilters(normalized, {}).unmappedDetails).toEqual([]);
  });

  it('ignores the current full_payload last_seen default for an age-only prompt', () => {
    const normalized = normalizeAiSearchArgs({
      args: {
        lower_age: 45,
        upper_age: 54,
        network: ['facebook'],
      },
      full_payload: {
        lower_age: 45,
        upper_age: 54,
        network: ['facebook'],
        order_column: 'last_seen',
        order_by: 'desc',
        newest_sort: 'NA',
        last_seen_sort: 'NA',
        impression_sort: 'NA',
        popularity_sort: 'NA',
        domain_sort: 'NA',
        running_longest_sort: 'NA',
      },
    });

    expect(normalized).not.toHaveProperty('order_column');
    expect(normalized).not.toHaveProperty('order_by');
    expect(mapArgsToFilters(normalized, {})).toMatchObject({
      sortBy: null,
      sortDirection: null,
      activePlatforms: ['facebook'],
      filterValues: { lower_age: 45, upper_age: 54 },
      unmappedDetails: [],
    });
  });

  it('removes a copied post_date default from args when planning has no sort constraint', () => {
    const normalized = normalizeAiSearchArgs({
      args: {
        ai_intent: ['app_install'],
        has_ai_meta: true,
        order_column: 'post_date',
        order_by: 'desc',
      },
      full_payload: {
        ai_intent: ['app_install'],
        has_ai_meta: true,
        order_column: 'post_date',
        order_by: 'desc',
        newest_sort: 'NA',
      },
      planning: {
        intent: {
          constraints: [{ field: 'ai_intent', wire_field: 'ai_intent' }],
        },
      },
    });

    expect(normalized).not.toHaveProperty('order_column');
    expect(normalized).not.toHaveProperty('order_by');
    expect(mapArgsToFilters(normalized, {}).unmappedDetails).toEqual([]);
  });

  it('keeps an explicit post_date sort when planning declares it', () => {
    const normalized = normalizeAiSearchArgs({
      args: { order_column: 'post_date', order_by: 'desc' },
      full_payload: { order_column: 'post_date', order_by: 'desc' },
      planning: {
        intent: {
          constraints: [{
            field: 'sort',
            wire_fields: ['order_column', 'order_by'],
          }],
        },
      },
    });

    expect(normalized).toMatchObject({ order_column: 'post_date', order_by: 'desc' });
  });

  it('ignores the full_payload type default when the planner did not request an ad type', () => {
    const normalized = normalizeAiSearchArgs({
      args: { keyword: 'weight-loss products' },
      full_payload: { type: 'NA' },
    });
    const mapped = mapArgsToFilters(normalized, {});

    expect(mapped.searchQuery).toBe('weight-loss products');
    expect(mapped.unmappedDetails).toEqual([]);
    expect(mapped.filterValues).toEqual({});
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

  it('does not turn a full_payload AI default into an AI filter for a network-only plan', () => {
    const normalized = normalizeAiSearchArgs({
      args: { network: ['chatgptads'] },
      full_payload: { network: ['chatgptads'], has_ai_meta: true },
    });

    expect(normalized).not.toHaveProperty('has_ai_meta');
    expect(mapArgsToFilters(normalized, {}).filterValues).toEqual({});
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

  it('maps AI popularity sorting to the live popularity_score SDUI option', () => {
    const mapped = mapArgsToFilters({
      network: ['facebook', 'instagram'],
      order_column: 'popularity',
      order_by: 'desc',
    }, {
      navbar: [{
        filters: [{
          _id: 'sort_by',
          type: 'radio',
          options: [{ label: 'Popularity', value: 'popularity_score' }],
        }],
      }],
    });

    expect(mapped.sortBy).toBe('popularity_score');
    expect(mapped.sortDirection).toBe('desc');
    expect(mapped.unmappedDetails).toEqual([]);
  });

  it('preserves DS last_seen sorting as the Common Ads Search wire value', () => {
    const mapped = mapArgsToFilters({
      country: ['India'],
      order_column: 'last_seen',
      order_by: 'desc',
    }, {
      navbar: [{
        filters: [{
          _id: 'sort_by',
          type: 'radio',
          options: [{ label: 'Ad Seen Date', value: 'newest' }],
        }],
      }],
      sidebar: [{
        filters: [{
          _id: 'country_filter',
          type: 'checkbox',
          options: [{ label: 'India', value: 'India' }],
        }],
      }],
    }, {
      date_filter: { field: 'post_date', preset: 'last_30_days' },
    });

    expect(mapped.sortBy).toBe('last_seen');
    expect(mapped.sortDirection).toBe('desc');
    expect(mapped.filterValues).toMatchObject({
      country_filter: ['India'],
      post_date_btn_sort: 'last_30_days',
    });
    expect(mapped.unmappedDetails).toEqual([]);
  });

  it('keeps an explicit post_date sort separate from Ad Seen Date', () => {
    const mapped = mapArgsToFilters({
      order_column: 'post_date',
      order_by: 'asc',
    }, {
      navbar: [{
        filters: [{
          _id: 'sort_by',
          type: 'radio',
          options: [{ label: 'Post Date', value: 'post_date' }],
        }],
      }],
    });

    expect(mapped.sortBy).toBe('post_date');
    expect(mapped.sortDirection).toBe('asc');
    expect(mapped.unmappedDetails).toEqual([]);
  });

  it('maps DS uppercase ad types and preserves ascending popularity sorting', () => {
    const mapped = mapArgsToFilters({
      network: ['facebook', 'instagram', 'linkedin'],
      type: ['VIDEO'],
      order_column: 'popularity',
      order_by: 'asc',
    }, {
      navbar: [{
        filters: [{
          _id: 'sort_by',
          type: 'radio',
          options: [{ label: 'Popularity', value: 'popularity_score' }],
        }],
      }],
      sidebar: [{
        filters: [{
          _id: 'ad_type_filter',
          type: 'radio',
          options: [{ label: 'Video', value: 'Video' }],
        }],
      }],
    });

    expect(mapped.filterValues.ad_type_filter).toEqual('Video');
    expect(mapped.sortBy).toBe('popularity_score');
    expect(mapped.sortDirection).toBe('asc');
    expect(mapped.unmappedDetails).toEqual([]);
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

    const admobSize = mapArgsToFilters({
      network: ['admob'],
      size: ['1080*159'],
    }, {
      navbar: [{
        filters: [{
          _id: 'platform_selector',
          type: 'chip_multi_select',
          options: [{ label: 'AdMob', value: 'admob' }],
        }],
      }],
      sidebar: [{
        filters: [{
          _id: 'image_size_filter',
          type: 'checkbox',
          options: [{ label: '1080x159', value: '1080x159' }],
        }],
      }],
    });

    expect(admobSize.filterValues).toMatchObject({
      image_size_filter: ['1080x159'],
    });
    expect(admobSize.unmappedDetails).toEqual([]);

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

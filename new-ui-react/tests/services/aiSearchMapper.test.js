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
});

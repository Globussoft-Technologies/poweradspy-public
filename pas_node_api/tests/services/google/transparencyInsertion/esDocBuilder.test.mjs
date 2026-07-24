import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildTransparencyDoc } = require('../../../../src/services/google/transparencyInsertion/esDocBuilder');

describe('Google Transparency ES document', () => {
  it('combines existing searchable fields with platform-18 fields', () => {
    const doc = buildTransparencyDoc({
      ad_id: 'CR1', advertiser_id: 'AR1', ad_url: 'https://example.test',
      post_owner: 'Owner', post_owner_image: null, ad_title: 'Title', ad_text: 'Text',
      image_url_original: null, video_url_original: null,
      othermultimediaNasPaths: [
        '/pas-dev/stream/gt/otherMultiMedia/202607/42_0.jpg',
      ],
      destination_url: null, redirect_url: null, domain: null, country: ['India'],
      country_details: [], countryDetailsSql: [{
        country: 'India', country_code: 'IN',
        first_seen: '2025-12-12T00:00:00Z', last_seen: '2025-12-21T00:00:00Z',
        firstSeenSql: '2025-12-12 00:00:00', lastSeenSql: '2025-12-21 00:00:00',
        times_shown: { min: 0, max: 1000, operator: 'range' },
      }],
      region_code: 'IN', type: 'TEXT', subnetwork: 'SEARCH',
      languageId: 7, detectedLanguage: 'de',
      translation: { title: 'Titel', text: 'Text übersetzt', newsfeed_description: '' },
      firstSeenSql: '2026-01-01 00:00:00', firstSeenForSearch: '2026-01-01 00:00:00',
      lastSeenSql: '2026-01-02 00:00:00', lastSeenForSearch: '2026-01-02 00:00:00',
      postDateSql: null, daysRunning: 2, impressions: { min: 0, max: 1000, operator: 'range' },
      network: 'google', source: 'desktop', platform: 18, system_id: 'worker', version: '3.2.0',
    }, 42, null);
    expect(doc).toMatchObject({
      id: 42, ad_id: 'CR1', advertiser_id: 'AR1', platform: 18,
      title: 'Title', ad_title: 'Titel', ad_text: 'Text übersetzt',
      language_id: 7, lang_detect: 'de',
      impressions_max: 1000, country: ['India'],
      last_seen: '2026-01-02 00:00:00',
    });
    expect(doc.country_details[0]).toEqual({
      country: 'India', country_code: 'IN',
      first_seen: '2025-12-12T00:00:00Z', last_seen: '2025-12-21T00:00:00Z',
      times_shown: { min: 0, max: 1000, operator: 'range' },
    });
    expect(doc.version).toBe('3.2.0');
    expect(doc.othermultimedia).toEqual([
      '/pas-dev/stream/gt/otherMultiMedia/202607/42_0.jpg',
    ]);
    expect(doc).not.toHaveProperty('nas_othermultimedia');
    expect(doc).not.toHaveProperty('system_id');
    expect(doc).not.toHaveProperty('contract_version');
    expect(doc).not.toHaveProperty('network');
  });
});

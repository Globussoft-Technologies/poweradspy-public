import { describe, expect, it } from 'vitest';
import validateModule from '../../src/services/admob/insertion/validate.js';
import normalizeModule from '../../src/services/admob/insertion/normalize.js';
import documentModule from '../../src/services/admob/insertion/esDocBuilder.js';
import searchModule from '../../src/services/admob/controllers/adSearchController.js';

const { validateAdmobPayload } = validateModule;
const { normalizeAdmobPayload } = normalizeModule;
const { buildAdmobDocument } = documentModule;
const { searchAds } = searchModule;

const payload = {
  ad_id: '00bcf053e64747019f6a35ee',
  country: ['India'],
  first_seen: null,
  image_url_original: 'https://tmpfiles.org/example/banner.png',
  last_seen: '2026-08-04T06:53:39+00:00',
  network: 'mob-network',
  platform: 19,
  post_date: 1785826419,
  source: 'Android',
  system_id: '20260804_065315_cc600c3f',
  type: 'BANNER',
  version: '30.4',
  source_app: 'CRM',
  source_app_pkg: 'com.example.crm',
};

describe('isolated AdMob insertion contract', () => {
  it('accepts type as the AdMob subtype without a sub_type field', () => {
    expect(validateAdmobPayload(payload)).toEqual({ code: 200, status: 'ok' });
    expect(normalizeAdmobPayload(payload).type).toBe('BANNER');
  });

  it('rejects duplicate countries case-insensitively with a clear reason', () => {
    const result = validateAdmobPayload({ ...payload, country: ['India', ' india '] });
    expect(result.code).toBe(422);
    expect(result.errors).toContainEqual(expect.objectContaining({ field: 'country', reason: 'DUPLICATE_VALUE' }));
  });

  it('rejects the removed sub_type field', () => {
    const result = validateAdmobPayload({ ...payload, sub_type: 'BANNER' });
    expect(result.errors).toContainEqual(expect.objectContaining({ field: 'sub_type', reason: 'UNKNOWN_FIELD' }));
  });

  it('requires ad_id, country, last_seen, and source_app', () => {
    const result = validateAdmobPayload({ ...payload, ad_id: '', country: [], last_seen: null, source_app: '' });
    expect(result.code).toBe(422);
    expect(new Set(result.errors.map((error) => error.field))).toEqual(expect.objectContaining(new Set(['ad_id', 'country', 'last_seen', 'source_app'])));
  });

  it('accepts a missing version', () => {
    const { version, ...withoutVersion } = payload;
    expect(validateAdmobPayload(withoutVersion)).toEqual({ code: 200, status: 'ok' });
  });

  it('requires source_app to be a string', () => {
    const result = validateAdmobPayload({ ...payload, source_app: 123 });
    expect(result.errors).toContainEqual(expect.objectContaining({ field: 'source_app', reason: 'INVALID_TYPE' }));
  });

  it('builds filterable ES dimensions and preserves the NAS image URL', () => {
    const doc = buildAdmobDocument({
      id: 42, ad_id: payload.ad_id, post_owner_id: null, post_owner: null,
      post_owner_image: null, type: 'BANNER', platform: 19, network: 'mob-network',
      source: 'android', status: 1, last_seen: new Date(payload.last_seen),
      image_url_original: payload.image_url_original,
      image_url: '/pas-dev/stream/admob/adImage/202608/42.webp',
      countries: [{ name: 'India', appearance_count: 2, first_seen: payload.last_seen, last_seen: payload.last_seen }],
      states: [], sub_networks: [],
      source_apps: [{ name: 'CRM', package: 'com.example.crm', appearance_count: 2, first_seen: payload.last_seen, last_seen: payload.last_seen }],
    });
    expect(doc.type).toBe('BANNER');
    expect(doc.country).toEqual(['India']);
    expect(doc.source_app_count).toBe(2);
    expect(doc.image_url).toContain('/admob/adImage/');
  });

  it('searches mob_search_mix and returns an independent admob card row', async () => {
    const elastic = {
      indexName: 'mob_search_mix',
      search: async ({ index }) => {
        expect(index).toBe('mob_search_mix');
        return {
          body: {
            hits: {
              total: { value: 1 },
              hits: [{
                _id: '42',
                _source: {
                  id: 42,
                  ad_id: payload.ad_id,
                  type: 'BANNER',
                  platform: 19,
                  network: 'mob-network',
                  last_seen: payload.last_seen,
                  image_url: '/pas-dev/stream/admob/adImage/202608/42.webp',
                  country: ['India'],
                },
              }],
            },
          },
        };
      },
    };
    const result = await searchAds({ body: { take: 9, skip: 0 } }, { elastic }, { error() {} });
    expect(result.code).toBe(200);
    expect(result.total).toBe(1);
    expect(result.data[0]).toEqual(expect.objectContaining({ network: 'admob', platform: 19 }));
    expect(result.data[0].image_video_url).toContain('/admob/adImage/');
  });
});

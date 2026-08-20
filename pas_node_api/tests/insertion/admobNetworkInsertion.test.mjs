import { describe, expect, it } from 'vitest';
import validateModule from '../../src/services/admob/insertion/validate.js';
import normalizeModule from '../../src/services/admob/insertion/normalize.js';
import documentModule from '../../src/services/admob/insertion/esDocBuilder.js';
import searchModule from '../../src/services/admob/controllers/adSearchController.js';

const { validateAdmobPayload } = validateModule;
const { normalizeAdmobPayload } = normalizeModule;
const { buildAdmobDocument } = documentModule;
const { searchAds, getAdSessions } = searchModule;

const payload = {
  ad_id: '00bcf053e64747019f6a35ee',
  country: ['India'],
  first_seen: null,
  image_url_original: 'https://tmpfiles.org/example/banner.png',
  last_seen: 1785826419,
  network: 'mob-network',
  platform: 19,
  post_date: 1785826419,
  source: 'Android',
  session_id: 'session-1',
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

  it('requires epoch timestamps for first_seen and last_seen', () => {
    const result = validateAdmobPayload({ ...payload, last_seen: '2026-08-04T06:53:39+00:00' });
    expect(result.errors).toContainEqual(expect.objectContaining({ field: 'last_seen', reason: 'INVALID_FORMAT' }));
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
      source: 'android', status: 1, last_seen: new Date(payload.last_seen * 1000),
      image_url_original: payload.image_url_original,
      image_url: '/pas-dev/stream/admob/adImage/202608/42.webp',
      countries: [{ name: 'India', appearance_count: 2, first_seen: new Date(payload.last_seen * 1000), last_seen: new Date(payload.last_seen * 1000) }],
      states: [], sub_networks: [],
      source_apps: [{ name: 'CRM', package: 'com.example.crm', appearance_count: 2, first_seen: new Date(payload.last_seen * 1000), last_seen: new Date(payload.last_seen * 1000) }],
    });
    expect(doc.type).toBe('BANNER');
    expect(doc.country).toEqual(['India']);
    expect(doc.source_app_count).toBe(2);
    expect(doc.image_url).toContain('/admob/adImage/');
  });

  it('projects the WA/VPN lander enrichment fields into the ES document', () => {
    const doc = buildAdmobDocument({
      id: 77,
      ad_id: payload.ad_id,
      post_owner_id: null,
      post_owner: null,
      post_owner_image: null,
      type: 'BANNER',
      platform: 19,
      network: 'mob-network',
      source: 'android',
      status: 1,
      first_seen: '2026-08-01 00:00:00',
      last_seen: '2026-08-10 00:00:00',
      occurrence_count: 4,
      image_url_original: payload.image_url_original,
      image_url: '/pas-dev/stream/admob/adImage/202608/77.webp',
      source_website: 'https://clickza.space/DDD/',
      source_parameters_json: JSON.stringify({
        gad_source: '5',
        gad_campaignid: '24090156948',
        gclid: 'gclid-value',
      }),
      whatsapp_url: 'https://api.whatsapp.com/send/?phone=%2B919311475239&text=Hello&type=phone_number&app_absent=0',
      whatsapp_domain: 'api.whatsapp.com',
      whatsapp_path: '/send/',
      whatsapp_phone: '+919311475239',
      whatsapp_message: 'Hello',
      whatsapp_parameters_json: JSON.stringify({
        phone: '+919311475239',
        text: 'Hello',
        type: 'phone_number',
        app_absent: '0',
      }),
      campaign_id: '24090156948',
      location_without_vpn_json: JSON.stringify({
        ip: '106.51.38.160',
        country: 'India',
        country_code: 'IN',
      }),
      location_with_vpn_json: JSON.stringify({
        ip: '185.177.126.136',
        country: 'Netherlands',
        country_code: 'NL',
      }),
      comparison_json: JSON.stringify({
        location_changed: true,
        whatsapp_data_changed: false,
      }),
      countries: [],
      states: [],
      sub_networks: [],
      source_apps: [],
    });

    expect(doc.source_website).toBe('https://clickza.space/DDD/');
    expect(doc.source_parameters).toEqual(expect.objectContaining({
      gad_source: '5',
      gad_campaignid: '24090156948',
      gclid: 'gclid-value',
    }));
    expect(doc.whatsapp_phone).toBe('+919311475239');
    expect(doc.whatsapp_parameters).toEqual(expect.objectContaining({
      phone: '+919311475239',
      text: 'Hello',
    }));
    expect(doc.campaign_id).toBe('24090156948');
    expect(doc.location_without_vpn).toEqual(expect.objectContaining({
      country: 'India',
      country_code: 'IN',
    }));
    expect(doc.comparison).toEqual(expect.objectContaining({
      location_changed: true,
      whatsapp_data_changed: false,
    }));
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

  it('applies every supported AdMob sidebar filter to its ES field', async () => {
    let searchBody;
    const elastic = {
      indexName: 'mob_search_mix',
      search: async ({ body }) => {
        searchBody = body;
        return { body: { hits: { total: { value: 0 }, hits: [] } } };
      },
    };
    const result = await searchAds({ body: {
      country: ['India'],
      source: ['Android'],
      sub_network: ['GDN'],
      source_app: ['Cricket App'],
      ad_position: ['MIDDLE'],
      ad_sub_position: ['BOTTOM'],
      size: '1080*159,300*250',
    } }, { elastic }, { error() {} });

    expect(result.code).toBe(200);
    expect(searchBody.query.bool.filter).toEqual(expect.arrayContaining([
      { terms: { country: ['india'] } },
      { terms: { source: ['android'] } },
      { terms: { sub_network: ['gdn'] } },
      { terms: { source_app: ['cricket app'] } },
      { terms: { ad_position: ['middle'] } },
      { terms: { ad_sub_position: ['bottom'] } },
      { terms: { ad_image_size: [
        '1080x159', '1080*159', '1080\u00d7159',
        '300x250', '300*250', '300\u00d7250',
      ] } },
    ]));
  });

  it('normalizes AdMob ad type filters to lowercase so BANNER matches the indexed keyword', async () => {
    let searchBody;
    const elastic = {
      indexName: 'mob_search_mix',
      search: async ({ body }) => {
        searchBody = body;
        return { body: { hits: { total: { value: 0 }, hits: [] } } };
      },
    };

    const result = await searchAds({ body: { type: ['BANNER'] } }, { elastic }, { error() {} });

    expect(result.code).toBe(200);
    expect(searchBody.query.bool.filter).toEqual(expect.arrayContaining([
      { terms: { type: ['banner'] } },
    ]));
  });

  it('applies AdMob poster intelligence range filters to the ES query', async () => {
    let searchBody;
    const elastic = {
      indexName: 'mob_search_mix',
      search: async ({ body }) => {
        searchBody = body;
        return { body: { hits: { total: { value: 0 }, hits: [] } } };
      },
    };

    const result = await searchAds({ body: {
      leadScoreRange: { min: 10, max: 100 },
      occurrenceCountRange: { min: 2, max: 8 },
      activeDaysRange: { min: 5, max: 30 },
      admobPosterSort: 'occurrence_count',
    } }, { elastic }, { error() {} });

    expect(result.code).toBe(200);
    expect(searchBody.sort).toEqual(expect.arrayContaining([
      { occurrence_count: { order: 'desc', missing: '_last' } },
      { id: 'desc' },
    ]));
    expect(searchBody.query.bool.filter).toEqual(expect.arrayContaining([
      { range: { lead_score: { gte: 10, lte: 100 } } },
      { range: { occurrence_count: { gte: 2, lte: 8 } } },
      { range: { days_running: { gte: 5, lte: 30 } } },
    ]));
  });

  it('returns AdMob session history with occurrence totals and rate', async () => {
    const sql = {
      query: async (query, params) => {
        if (query.includes('FROM mob_ads')) {
          expect(params).toEqual([42]);
          return [{
            id: 42,
            ad_id: payload.ad_id,
            first_seen: '2026-08-01 00:00:00',
            last_seen: '2026-08-10 00:00:00',
          }];
        }
        if (query.includes('FROM mob_ad_source_apps')) {
          return [{ source_app_id: 77 }];
        }
        if (query.includes('COUNT(*) AS sessions_total')) {
          return [{ sessions_total: 3 }];
        }
        if (query.includes('ORDER BY observed_at DESC')) {
          return [
            {
              session_id: 'session-3',
              system_id: 'system-3',
              observed_at: '2026-08-10 09:00:00',
            },
            {
              session_id: 'session-2',
              system_id: 'system-2',
              observed_at: '2026-08-09 09:00:00',
            },
          ];
        }
        if (query.includes('COUNT(DISTINCT o.session_id) AS total_sessions')) {
          expect(params).toEqual([77]);
          return [{ total_sessions: 10 }];
        }
        throw new Error(`Unexpected query: ${query}`);
      },
    };

    const result = await getAdSessions(
      { body: { id: 42, take: 2, skip: 0 } },
      { sql },
      { error() {} },
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual(expect.objectContaining({
      id: 42,
      ad_id: payload.ad_id,
      days_running: 10,
      occurrence_count: 3,
      sessions_total: 3,
      total_sessions: 10,
      occurrence_rate: 0.3,
      occurrence_rate_percent: 30,
      lead_score: 30,
      size: 2,
      page: 0,
    }));
    expect(result.data.sessions).toHaveLength(2);
    expect(result.data.sessions[0]).toEqual(expect.objectContaining({
      session_id: 'session-3',
      system_id: 'system-3',
    }));
  });
});

import { describe, expect, it } from 'vitest';
import normalizeModule from '../../../../src/services/admob/landers/normalize.js';

const { normalizeLanderPayload } = normalizeModule;

describe('admob lander normalization', () => {
  it('normalizes the finalized AdMob lander payload into the SQL contract', () => {
    const normalized = normalizeLanderPayload({
      ad_id: '393b2a99a0d23d76912d7dbf',
      platform: '12',
      post_owner: 'Acme Logistics',
      destinations: 'https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336',
      html_path: '/pas-dev/stream/admob/whiteHatAd/202608/393b2a99a0d23d76912d7dbf.zip',
      screen_shot: '/pas-dev/stream/admob/whiteHatAd/202608/393b2a99a0d23d76912d7dbf.png',
      html_content: '<html><body><h1>lander</h1></body></html>',
      domain_registered_date: null,
      domain_age: 0,
      country_iso: ['IN'],
      outgoing_url: [
        {
          start_url: 'https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336',
          redirect_urls: [],
          destination_url: 'https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336',
        },
      ],
      redirects: ['https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336'],
      source_app: 'crex',
      whatsapp: [
        {
          domain: 'wa.link',
          url: 'https://wa.link/reddylive2',
          phone: '918810993624',
          button: 'Book delivery link',
          message: 'HI, I NEED INFO AND I:D',
          fisrt_detected: '2024-06-05T12:00:00Z',
          last_detected: '2024-06-05T12:00:00Z',
          state: 'IN',
          city: 'IN',
          countrty: 'IN',
        },
        {
          domain: 'wa.link',
          url: 'https://wa.link/reddylive2',
          phone: '918810993624',
          message: 'HI, I NEED INFO AND I:D',
          fisrt_detected: '2024-06-05T12:00:00Z',
          last_detected: '2024-06-05T12:00:00Z',
          state: 'IN',
          city: 'IN',
          countrty: 'IN',
        },
      ],
      campaign_id: '24144585336',
      created: '2024-06-05T12:00:00Z',
      updated: '2024-06-05T12:00:00Z',
    });

    expect(normalized.ad_id).toBe('393b2a99a0d23d76912d7dbf');
    expect(normalized.platform).toBe(12);
    expect(normalized.lander_status).toBe(1);
    expect(normalized.post_owner).toBe('Acme Logistics');
    expect(normalized.source_app).toBe('crex');
    expect(JSON.parse(normalized.country_iso_json)).toEqual(['IN']);
    expect(JSON.parse(normalized.outgoing_url_json)).toEqual([
      {
        start_url: 'https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336',
        redirect_urls: [],
        destination_url: 'https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336',
      },
    ]);
    expect(JSON.parse(normalized.redirects_json)).toEqual([
      'https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336',
    ]);
    expect(normalized.campaign_id).toBe('24144585336');
    expect(normalized.whatsapp_rotator_detected).toBe(false);
    expect(normalized.whatsapp_rotator_count).toBe(1);
    expect(normalized.lead_campaign_tag).toBe(null);
    expect(normalized.created).toBe('2024-06-05 12:00:00.000');
    expect(normalized.updated).toBe('2024-06-05 12:00:00.000');
    expect(normalized).not.toHaveProperty('source_website');
    expect(normalized).not.toHaveProperty('whatsapp_details_json');

    const whatsapp = JSON.parse(normalized.whatsapp_json);
    expect(whatsapp).toHaveLength(2);
    expect(whatsapp.some((item) => 'path' in item)).toBe(false);
    expect(whatsapp).toContainEqual(expect.objectContaining({
      domain: 'wa.link',
      phone: '918810993624',
      button: 'Book delivery link',
      message: 'HI, I NEED INFO AND I:D',
      first_detected: '2024-06-05T12:00:00Z',
      last_detected: '2024-06-05T12:00:00Z',
      state: 'IN',
      city: 'IN',
      country: 'IN',
      url: 'https://wa.link/reddylive2',
    }));
  });

  it('accepts the DS path field as a legacy alias for the stored WhatsApp url', () => {
    const normalized = normalizeLanderPayload({
      ad_id: 'ad-path-alias',
      platform: 12,
      destinations: 'https://example.com',
      html_path: '/tmp/lander.zip',
      screen_shot: '/tmp/lander.png',
      html_content: '<html></html>',
      source_app: 'crex',
      whatsapp: [
        {
          domain: 'wa.link',
          path: 'https://wa.link/legacyalias',
          phone: '918810993624',
        },
      ],
    });

    expect(JSON.parse(normalized.whatsapp_json)).toEqual([
      expect.objectContaining({
        domain: 'wa.link',
        phone: '918810993624',
        url: 'https://wa.link/legacyalias',
      }),
    ]);
  });

  it('drops placeholder post_owner values defensively during normalization', () => {
    const normalized = normalizeLanderPayload({
      ad_id: 'ad-owner-placeholder',
      platform: 12,
      post_owner: 'None',
      destinations: 'https://example.com',
      html_path: '/tmp/lander.zip',
      screen_shot: '/tmp/lander.png',
      html_content: '<html></html>',
      source_app: 'crex',
    });

    expect(normalized.post_owner).toBe(null);
  });

  it('infers PAS-maintained WA rotator fields from distinct phone numbers', () => {
    const normalized = normalizeLanderPayload({
      ad_id: 'ad-rotator',
      platform: 12,
      destinations: 'https://example.com',
      html_path: '/tmp/lander.zip',
      screen_shot: '/tmp/lander.png',
      html_content: '<html></html>',
      source_app: 'crex',
      whatsapp: [
        { phone: '918810993624', message: 'A' },
        { phone: '919999999999', message: 'B' },
      ],
    });

    expect(normalized.whatsapp_rotator_detected).toBe(true);
    expect(normalized.whatsapp_rotator_count).toBe(2);
    expect(normalized.lead_campaign_tag).toBe('high-volume-lead-campaign');
  });
});

import { describe, expect, it } from 'vitest';
import normalizeModule from '../../../../src/services/admob/landers/normalize.js';

const { normalizeLanderPayload } = normalizeModule;

describe('admob lander normalization', () => {
  it('keeps the existing lander fields and flattens the WA/VPN enrichment payload', () => {
    const payload = {
      ad_id: 'ad-123',
      status: 2,
      crawled_by: '.net',
      destinations: 'https://example-landing.com/whitehat',
      html_path: 'https://cdn.example.com/lander.html',
      screen_shot: 'https://cdn.example.com/screenshot.png',
      html_content: '<html><body>lander</body></html>',
      domain_registered_date: '2018-03-12',
      domain_age: 0,
      country_iso: ['US'],
      outgoing_url: [
        {
          start_url: 'https://example-landing.com/whitehat',
          redirect_urls: [],
          destination_url: 'https://example-landing.com/whitehat',
        },
      ],
      redirects: ['NA'],
      ad_category: null,
      source_website: 'https://clickza.space/DDD/',
      source_parameters: {
        gad_source: '5',
        gad_campaignid: '24090156948',
        gclid: 'CjwKCAjwvsvTBhBaEiwAmf-3nsdCtFoUW_-rRjJSpCbpGdn2nJJMtCyR8In9AnEuhuFAmquB5-LxHxoCO58QAvD_BwE',
      },
      whatsapp_url: 'https://api.whatsapp.com/send/?phone=%2B919311475239&text=Hello&type=phone_number&app_absent=0',
      whatsapp: {
        domain: 'api.whatsapp.com',
        path: '/send/',
        phone: '+919311475239',
        message: 'Hello',
        parameters: {
          phone: '+919311475239',
          text: 'Hello',
          type: 'phone_number',
          app_absent: '0',
        },
      },
      campaign_id: '24090156948',
      location: {
        without_vpn: {
          ip: '106.51.38.160',
          country: 'India',
          country_code: 'IN',
          region: 'Karnataka',
          region_code: 'KA',
          city: 'Bengaluru',
          zipcode: '560025',
          latitude: '12.9634',
          longitude: '77.5855',
        },
        with_vpn: {
          ip: '185.177.126.136',
          country: 'Netherlands',
          country_code: 'NL',
          region: 'South Holland',
          region_code: 'ZH',
          city: 'Naaldwijk',
          zipcode: '2671',
          latitude: '51.9981',
          longitude: '4.198',
        },
      },
      comparison: {
        location_changed: true,
        country_changed: true,
        city_changed: true,
        zipcode_changed: true,
        whatsapp_data_changed: true,
        campaign_id_changed: false,
      },
      whatsapp_rotator_detected: true,
      whatsapp_rotator_phone_count: 7,
    };

    const normalized = normalizeLanderPayload(payload);

    expect(normalized.ad_id).toBe('ad-123');
    expect(normalized.lander_status).toBe(2);
    expect(normalized.source_website).toBe('https://clickza.space/DDD/');
    expect(JSON.parse(normalized.source_parameters_json)).toEqual(expect.objectContaining({
      gad_source: '5',
      gad_campaignid: '24090156948',
    }));
    expect(normalized.whatsapp_url).toContain('api.whatsapp.com');
    expect(normalized.whatsapp_domain).toBe('api.whatsapp.com');
    expect(normalized.whatsapp_path).toBe('/send/');
    expect(normalized.whatsapp_phone).toBe('+919311475239');
    expect(normalized.whatsapp_message).toBe('Hello');
    expect(JSON.parse(normalized.whatsapp_parameters_json)).toEqual(expect.objectContaining({
      phone: '+919311475239',
      text: 'Hello',
    }));
    expect(normalized.campaign_id).toBe('24090156948');
    expect(JSON.parse(normalized.location_without_vpn_json)).toEqual(expect.objectContaining({
      country: 'India',
      country_code: 'IN',
    }));
    expect(JSON.parse(normalized.location_with_vpn_json)).toEqual(expect.objectContaining({
      country: 'Netherlands',
      country_code: 'NL',
    }));
    expect(JSON.parse(normalized.comparison_json)).toEqual(expect.objectContaining({
      whatsapp_data_changed: true,
      campaign_id_changed: false,
    }));
    expect(JSON.parse(normalized.whatsapp_links_json)).toEqual([
      'https://api.whatsapp.com/send/?phone=%2B919311475239&text=Hello&type=phone_number&app_absent=0',
    ]);
    expect(JSON.parse(normalized.phone_numbers_json)).toEqual(['+919311475239']);
    expect(JSON.parse(normalized.whatsapp_texts_json)).toEqual(['Hello']);
    expect(normalized.whatsapp_rotator_detected).toBe(true);
    expect(normalized.whatsapp_rotator_phone_count).toBe(7);
    expect(normalized.raw_payload_json).toContain('"source_website":"https://clickza.space/DDD/"');
  });

  it('does not infer rotator detection from comparison.whatsapp_data_changed alone', () => {
    const normalized = normalizeLanderPayload({
      ad_id: 'ad-456',
      status: 2,
      crawled_by: '.net',
      destinations: 'https://example-landing.com/whitehat',
      screen_shot: 'https://cdn.example.com/screenshot.png',
      html_content: '<html><body>lander</body></html>',
      whatsapp: {
        phone: '+919311475239',
        message: 'Hello',
      },
      comparison: {
        whatsapp_data_changed: true,
      },
    });

    expect(normalized.whatsapp_rotator_detected).toBe(false);
    expect(normalized.whatsapp_rotator_phone_count).toBe(0);
    expect(JSON.parse(normalized.comparison_json)).toEqual(expect.objectContaining({
      whatsapp_data_changed: true,
    }));
  });
});

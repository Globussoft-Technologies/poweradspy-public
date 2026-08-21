import { describe, expect, it } from 'vitest';
import insertHtmlServiceModule from '../../../../src/services/admob/landers/insertHtmlService.js';

const { validateLanderPayload } = insertHtmlServiceModule;

describe('admob insert_html_content validation', () => {
  it('accepts the finalized AdMob lander payload shape', () => {
    const errors = validateLanderPayload({
      ad_id: '393b2a99a0d23d76912d7dbf',
      platform: 12,
      destinations: 'https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336',
      html_path: '/pas-dev/stream/admob/whiteHatAd/202608/393b2a99a0d23d76912d7dbf.zip',
      screen_shot: '/pas-dev/stream/admob/whiteHatAd/202608/393b2a99a0d23d76912d7dbf.png',
      html_content: '<html><body><h1>lander</h1></body></html>',
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
      ],
      campaign_id: '24144585336',
      created: '2024-06-05T12:00:00Z',
      updated: '2024-06-05T12:00:00Z',
    });

    expect(errors).toEqual([]);
  });

  it('requires platform and source_app in the finalized contract', () => {
    const errors = validateLanderPayload({
      ad_id: 'ad-missing-fields',
      destinations: 'https://example.com',
      html_path: '/tmp/lander.zip',
      screen_shot: '/tmp/lander.png',
      html_content: '<html></html>',
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'platform', reason: 'MISSING_REQUIRED_FIELD' }),
      expect.objectContaining({ field: 'source_app', reason: 'MISSING_REQUIRED_FIELD' }),
    ]));
  });

  it('allows status=3 payloads without HTML artifacts', () => {
    const errors = validateLanderPayload({
      ad_id: 'ad-status-3',
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
      source_app: 'crex',
    });

    expect(errors).toEqual([]);
  });
});

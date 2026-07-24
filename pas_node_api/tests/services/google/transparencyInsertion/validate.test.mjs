import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  validateTransparencyPayload,
  TRANSPARENCY_RULES,
} = require('../../../../src/services/google/transparencyInsertion/validate');

const valid = {
  ad_id: 'CR14607596898010267649',
  advertiser_id: 'AR05119626735096168449',
  ad_url: 'https://adstransparency.google.com/advertiser/AR05119626735096168449/creative/CR14607596898010267649?region=anywhere&platform=SEARCH&format=TEXT',
  post_owner: 'VIVOLTA',
  post_owner_image: null,
  ad_title: null,
  ad_text: null,
  image_url_original: null,
  video_url_original: null,
  othermultimedia: [],
  destination_url: null,
  redirect_url: null,
  country: ['Germany'],
  country_details: [{
    country: 'Germany',
    country_code: 'DE',
    first_seen: '2025-12-12T00:00:00Z',
    last_seen: '2025-12-21T00:00:00Z',
    times_shown: { min: 0, max: 1000, operator: 'range' },
  }],
  region_code: 'IN',
  type: 'TEXT',
  first_seen: null,
  last_seen: '2025-12-21T00:00:00Z',
  impressions: { min: 0, max: 1000, operator: 'range' },
  post_date: null,
  network: 'google',
  subnetwork: 'SEARCH',
  source: 'desktop',
  platform: 18,
  system_id: 'scraper-worker-1',
  version: '3.2.0',
};

describe('Google Transparency contract validation', () => {
  it('accepts the documented contract payload', () => {
    expect(validateTransparencyPayload(valid)).toEqual({ code: 200 });
  });

  it('requires all fields and rejects unknown fields with 422', () => {
    const { version, ...missing } = valid;
    const out = validateTransparencyPayload({ ...missing, unexpected: true });
    expect(out.code).toBe(422);
    expect(out.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'version' }),
      expect.objectContaining({ field: 'unexpected' }),
    ]));
  });

  it('allows post_date to be omitted for platform 18', () => {
    const { post_date, ...withoutPostDate } = valid;
    expect(validateTransparencyPayload(withoutPostDate)).toEqual({ code: 200 });
  });

  it('allows validation for a supplied field to be disabled explicitly', () => {
    const rules = {
      ...TRANSPARENCY_RULES,
      redirect_url: 'disabled',
    };
    expect(validateTransparencyPayload({ ...valid, redirect_url: 'not-a-url' }, rules))
      .toEqual({ code: 200 });
  });

  it('accepts an explicit null post_owner from the storage contract', () => {
    expect(validateTransparencyPayload({ ...valid, post_owner: null })).toEqual({ code: 200 });
  });

  it('rejects payload-level NAS storage directives because policy is server-owned', () => {
    const out = validateTransparencyPayload({
      ...valid,
      store: { image: true, video: false },
    });
    expect(out.errors).toContainEqual({
      field: 'store',
      message: 'is not allowed by contract 3.2.0',
    });
  });

  it('accepts nullable country delivery dates and impressions', () => {
    const country_details = [{
      ...valid.country_details[0],
      first_seen: null,
      last_seen: null,
      times_shown: null,
    }];
    expect(validateTransparencyPayload({ ...valid, country_details })).toEqual({ code: 200 });
  });

  it('rejects the superseded country first_shown/last_shown names', () => {
    const country_details = [{
      country: 'Germany',
      country_code: 'DE',
      first_shown: '12 Dec 2025',
      last_shown: '21 Dec 2025',
      times_shown: null,
    }];
    const out = validateTransparencyPayload({ ...valid, country_details });
    expect(out.code).toBe(422);
    expect(out.errors).toContainEqual(expect.objectContaining({
      field: 'country_details[0]',
      message: expect.stringContaining('first_seen'),
    }));
  });

  it('requires IDs to match the transparency URL', () => {
    const out = validateTransparencyPayload({ ...valid, ad_id: 'CR999' });
    expect(out.code).toBe(422);
    expect(out.errors).toContainEqual({
      field: 'ad_id',
      message: `does not match ad_url creative segment: received "CR999", expected "${valid.ad_id}"`,
      received: 'CR999',
      expected: valid.ad_id,
      compared_with: 'ad_url creative segment',
    });
  });

  it('reports the exact received and expected creative IDs', () => {
    const received = 'CR9000000000000000002';
    const expected = 'CR90000000000000000002';
    const out = validateTransparencyPayload({
      ...valid,
      ad_id: received,
      ad_url: `https://adstransparency.google.com/advertiser/${valid.advertiser_id}/creative/${expected}`,
    });

    expect(out.errors).toContainEqual({
      field: 'ad_id',
      message: `does not match ad_url creative segment: received "${received}", expected "${expected}"`,
      received,
      expected,
      compared_with: 'ad_url creative segment',
    });
  });

  it('validates impression operator semantics', () => {
    const out = validateTransparencyPayload({
      ...valid,
      impressions: { min: 1, max: 2, operator: 'over' },
    });
    expect(out.code).toBe(422);
    expect(out.errors.some((error) => error.field === 'impressions')).toBe(true);
  });

  it('requires country_details order to match country', () => {
    const out = validateTransparencyPayload({ ...valid, country: ['France'] });
    expect(out.code).toBe(422);
    expect(out.errors.some((error) => error.field === 'country_details')).toBe(true);
  });
});

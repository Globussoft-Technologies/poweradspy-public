import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import insertHtmlServiceModule from '../../../../src/services/admob/landers/insertHtmlService.js';

const require = createRequire(import.meta.url);
const repo = require('../../../../src/services/admob/landers/repository.js');
const insertionRepo = require('../../../../src/services/admob/insertion/repository.js');

const { validateLanderPayload, processItem } = insertHtmlServiceModule;

const originalRepoFns = {
  withTransaction: repo.withTransaction,
  getAdForLanderUpdate: repo.getAdForLanderUpdate,
  backfillPostOwnerIfMissing: repo.backfillPostOwnerIfMissing,
  updateRedirectStatus: repo.updateRedirectStatus,
  upsertLanderContent: repo.upsertLanderContent,
  completeLanderClaim: repo.completeLanderClaim,
  queueEs: repo.queueEs,
  getCompleteAdByInternalId: repo.getCompleteAdByInternalId,
  completeEs: repo.completeEs,
};

const originalInsertionEnsureOwner = insertionRepo.ensureOwner;

afterEach(() => {
  Object.assign(repo, originalRepoFns);
  insertionRepo.ensureOwner = originalInsertionEnsureOwner;
  vi.restoreAllMocks();
});

describe('admob insert_html_content validation', () => {
  it('accepts the finalized AdMob lander payload shape', () => {
    const errors = validateLanderPayload({
      ad_id: 2084,
      platform: 12,
      destinations: 'https://reddydelivery.store/?gad_source=5&gad_campaignid=24144585336',
      html_path: '/pas-dev/stream/admob/whiteHatAd/202608/2084.zip',
      screen_shot: '/pas-dev/stream/admob/whiteHatAd/202608/2084.png',
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

  it('requires platform but not source_app in the finalized contract', () => {
    const errors = validateLanderPayload({
      ad_id: 'ad-missing-fields',
      destinations: 'https://example.com',
      html_path: '/tmp/lander.zip',
      screen_shot: '/tmp/lander.png',
      html_content: '<html></html>',
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'platform', reason: 'MISSING_REQUIRED_FIELD' }),
    ]));
  });

  it('allows status=3 payloads without HTML artifacts', () => {
    const errors = validateLanderPayload({
      ad_id: 'ad-status-3',
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
    });

    expect(errors).toEqual([]);
  });

  it('accepts an optional post_owner field without making it part of the lander-required contract', () => {
    const errors = validateLanderPayload({
      ad_id: 'ad-with-owner',
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
      post_owner: 'Acme Logistics',
    });

    expect(errors).toEqual([]);
  });

  it('rejects placeholder post_owner values before any SQL or ES write is attempted', () => {
    const errors = validateLanderPayload({
      ad_id: 'ad-owner-placeholder',
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
      post_owner: 'N/A',
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'post_owner', reason: 'INVALID_VALUE' }),
    ]));
  });

  it('rejects non-string post_owner values before normalization can stringify them', () => {
    const errors = validateLanderPayload({
      ad_id: 'ad-owner-object',
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
      post_owner: { name: 'Acme Logistics' },
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'post_owner', reason: 'INVALID_TYPE' }),
    ]));
  });
});

describe('admob insert_html_content post_owner backfill', () => {
  it('logs a WhatsApp payload trace so DS mismatches can be compared against the normalized row', async () => {
    repo.withTransaction = vi.fn(async (sql, work) => work({ query: vi.fn(async () => ({ affectedRows: 1 })) }));
    repo.getAdForLanderUpdate = vi.fn(async () => ({ id: 2084, ad_id: 'AD-PUBLIC-2084', post_owner_id: null }));
    repo.backfillPostOwnerIfMissing = vi.fn(async () => ({ updated: false, postOwnerId: null }));
    repo.updateRedirectStatus = vi.fn(async () => {});
    repo.upsertLanderContent = vi.fn(async () => {});
    repo.completeLanderClaim = vi.fn(async () => {});
    repo.queueEs = vi.fn(async () => {});

    const log = { error() {}, warn: vi.fn(), info: vi.fn() };

    const result = await processItem({
      ad_id: 2084,
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
      whatsapp: [
        {
          domain: 'wa.me',
          path: '/+917340407207?text=Hi',
          phone: '917340407207',
          button: 'Chat On WhatsApp',
          message: 'Hi',
          first_detected: '2026-08-26T05:57:21Z',
          last_detected: '2026-08-26T05:57:21Z',
          state: 'IN',
          city: 'IN',
          countrty: 'IN',
        },
      ],
    }, { sql: {} }, log, 'scraper-a');

    expect(result.code).toBe(200);
    expect(log.info).toHaveBeenCalledWith('admob.landers.insertHtml whatsapp trace', expect.objectContaining({
      ad_id: '2084',
      raw_entry_count: 1,
      normalized_entry_count: 1,
      raw_entry_keys: expect.arrayContaining([
        'button',
        'city',
        'countrty',
        'domain',
        'first_detected',
        'last_detected',
        'message',
        'path',
        'phone',
        'state',
      ]),
      normalized_whatsapp_preview: [
        expect.objectContaining({
          button: 'Chat On WhatsApp',
          first_detected: '2026-08-26T05:57:21Z',
          last_detected: '2026-08-26T05:57:21Z',
          country: 'IN',
          url: 'https://wa.me/+917340407207?text=Hi',
        }),
      ],
    }));
    expect(log.warn).not.toHaveBeenCalledWith('admob.landers.insertHtml whatsapp fields dropped', expect.anything());
  });

  it('ignores a lander source_app sent by DS instead of storing or validating it', async () => {
    repo.withTransaction = vi.fn(async (sql, work) => work({ query: vi.fn(async () => ({ affectedRows: 1 })) }));
    repo.getAdForLanderUpdate = vi.fn(async () => ({ id: 700, ad_id: 'AD-700', post_owner_id: null }));
    repo.backfillPostOwnerIfMissing = vi.fn(async () => ({ updated: false, postOwnerId: null }));
    repo.updateRedirectStatus = vi.fn(async () => {});
    repo.upsertLanderContent = vi.fn(async () => {});
    repo.completeLanderClaim = vi.fn(async () => {});
    repo.queueEs = vi.fn(async () => {});

    const result = await processItem({
      ad_id: 700,
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
      source_app: 'hardcoded-crex',
    }, { sql: {} }, { error() {}, info() {}, warn() {} }, 'scraper-a');

    expect(result.code).toBe(200);
    expect(repo.upsertLanderContent).toHaveBeenCalledWith(
      expect.anything(),
      700,
      expect.not.objectContaining({ source_app: expect.anything() }),
    );
  });

  it('fills the actual AdMob ad owner when DS provides post_owner and the ad owner is still missing', async () => {
    repo.withTransaction = vi.fn(async (sql, work) => work({ query: vi.fn(async () => ({ affectedRows: 1 })) }));
    repo.getAdForLanderUpdate = vi.fn(async () => ({ id: 123, ad_id: 'AD-123', post_owner_id: null }));
    repo.backfillPostOwnerIfMissing = vi.fn(async () => ({ updated: true, postOwnerId: 88 }));
    repo.updateRedirectStatus = vi.fn(async () => {});
    repo.upsertLanderContent = vi.fn(async () => {});
    repo.completeLanderClaim = vi.fn(async () => {});
    repo.queueEs = vi.fn(async () => {});

    const result = await processItem({
      ad_id: 123,
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
      post_owner: 'Acme Logistics',
    }, { sql: {} }, { error() {} }, 'scraper-a');

    expect(result.code).toBe(200);
    expect(result.data).toEqual(expect.objectContaining({
      id: 123,
      mysql_saved: true,
      elastic_indexed: false,
      es_retry_queued: true,
      redirect_status: 6,
      skipped_content: true,
    }));
    expect(repo.backfillPostOwnerIfMissing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 123, post_owner_id: null }),
      'Acme Logistics',
    );
  });

  it('rebuilds the AdMob ES document using the internal SQL id carried in the ad_id field', async () => {
    repo.withTransaction = vi.fn(async (sql, work) => work({ query: vi.fn(async () => ({ affectedRows: 1 })) }));
    repo.getAdForLanderUpdate = vi.fn(async () => ({ id: 2084, ad_id: 'AD-PUBLIC-2084', post_owner_id: null }));
    repo.backfillPostOwnerIfMissing = vi.fn(async () => ({ updated: false, postOwnerId: null }));
    repo.updateRedirectStatus = vi.fn(async () => {});
    repo.upsertLanderContent = vi.fn(async () => {});
    repo.completeLanderClaim = vi.fn(async () => {});
    repo.queueEs = vi.fn(async () => {});
    repo.getCompleteAdByInternalId = vi.fn(async () => ({
      id: 2084,
      ad_id: 'AD-PUBLIC-2084',
      type: 'BANNER',
      platform: 19,
      network: 'mob-network',
      source: 'android',
      status: 1,
      last_seen: '2026-08-05 00:00:00',
      countries: [],
      states: [],
      sub_networks: [],
      source_apps: [],
    }));
    repo.completeEs = vi.fn(async () => {});

    const elastic = {
      esMajor: 6,
      index: vi.fn(async () => ({})),
    };

    const result = await processItem({
      ad_id: 2084,
      platform: 12,
      status: 3,
      destinations: 'https://example.com',
    }, { sql: {}, elastic }, { error() {} }, 'scraper-a');

    expect(result.code).toBe(200);
    expect(repo.getCompleteAdByInternalId).toHaveBeenCalledWith({}, 2084);
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      index: 'mob_search_mix',
      id: '2084',
      type: 'doc',
    }));
    expect(repo.completeEs).toHaveBeenCalledWith({}, 2084);
  });

  it('does not overwrite an existing AdMob ad owner when post_owner_id is already present', async () => {
    const tx = { query: vi.fn(async () => ({ affectedRows: 0 })) };
    insertionRepo.ensureOwner = vi.fn(async () => ({ id: 91 }));

    const result = await repo.backfillPostOwnerIfMissing(tx, {
      id: 456,
      post_owner_id: 55,
    }, 'Replacement Owner');

    expect(result).toEqual({
      updated: false,
      postOwnerId: 55,
    });
    expect(insertionRepo.ensureOwner).not.toHaveBeenCalled();
    expect(tx.query).not.toHaveBeenCalled();
  });

  it('creates or reuses a post owner and links it to mob_ads when the owner is missing', async () => {
    const tx = { query: vi.fn(async () => ({ affectedRows: 1 })) };
    insertionRepo.ensureOwner = vi.fn(async () => ({ id: 77 }));

    const result = await repo.backfillPostOwnerIfMissing(tx, {
      id: 789,
      post_owner_id: null,
    }, 'Fresh Owner');

    expect(result).toEqual({
      updated: true,
      postOwnerId: 77,
    });
    expect(insertionRepo.ensureOwner).toHaveBeenCalledWith(tx, {
      post_owner: 'Fresh Owner',
      post_owner_image: null,
    }, true);
    expect(tx.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE mob_ads'), [77, 789]);
  });
});

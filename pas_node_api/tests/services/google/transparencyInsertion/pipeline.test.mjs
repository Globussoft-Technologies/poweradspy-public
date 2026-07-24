import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const repoPath = require.resolve('../../../../src/services/google/transparencyInsertion/repository');
const mediaPath = require.resolve('../../../../src/insertion/helpers/mediaUpload');
const queuePath = require.resolve('../../../../src/insertion/helpers/nasDownloadQueue');
const apiPath = require.resolve('../../../../src/insertion/helpers/apiClients');
const config = require('../../../../src/config');
let originalNasStore;

const repo = {
  withTransaction: vi.fn(async (_sql, fn) => fn({})),
  getAd: vi.fn(),
  ensurePostOwner: vi.fn(async () => 11),
  ensureDomain: vi.fn(async () => 12),
  ensureCountry: vi.fn(async () => ({ countryId: 13, countryOnlyId: 14 })),
  getPostOwnerImage: vi.fn(async () => null),
  ensureLanguage: vi.fn(async () => 7),
  insertAd: vi.fn(async () => 42),
  updateAd: vi.fn(async () => {}),
  upsertVariant: vi.fn(async () => 15),
  upsertTranslation: vi.fn(async () => {}),
  setVariantNasImage: vi.fn(async () => {}),
  setPostOwnerImage: vi.fn(async () => {}),
  upsertMeta: vi.fn(async () => {}),
  upsertTransparency: vi.fn(async () => {}),
  mergeCountryDelivery: vi.fn(async () => []),
};
const media = {
  uploadImage: vi.fn(async () => ({ nas_path: '/pas-prod/stream/gt/image/42.webp' })),
  uploadTransparencyTextImage: vi.fn(async (_url, id) => ({
    nas_path: `/pas-prod/stream/gt/adT/202607/${id}.webp`,
  })),
  uploadMultimedia: vi.fn(async () => ({ ad_image_video: '[]' })),
  uploadPostOwner: vi.fn(async () => ({ post_owner_image: '/pas-prod/stream/gt/postowner/11.jpg' })),
};
const enqueueVideoDownload = vi.fn();
const api = {
  translate: vi.fn(async () => ({
    ok: true,
    data: {
      detected_language: 'de',
      language_name: 'German',
      title: 'Übersetzter Titel',
      text: 'Übersetzter Text',
      newsfeed_description: '',
    },
  })),
};
require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repo };
require.cache[mediaPath] = { id: mediaPath, filename: mediaPath, loaded: true, exports: media };
require.cache[queuePath] = {
  id: queuePath, filename: queuePath, loaded: true, exports: { enqueueVideoDownload },
};
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: api };

const { processTransparencyAd } = require('../../../../src/services/google/transparencyInsertion/pipeline');

function payload(overrides = {}) {
  return {
    ad_id: 'CR14607596898010267649',
    advertiser_id: 'AR05119626735096168449',
    ad_url: 'https://adstransparency.google.com/advertiser/AR05119626735096168449/creative/CR14607596898010267649',
    post_owner: 'VIVOLTA', post_owner_image: null, ad_title: null, ad_text: null,
    image_url_original: null, video_url_original: null, othermultimedia: [],
    destination_url: null, redirect_url: null, country: ['Germany'],
    country_details: [], region_code: 'IN', type: 'TEXT', first_seen: null,
    last_seen: '2025-12-21T00:00:00Z', impressions: null, post_date: null,
    network: 'google', subnetwork: 'SEARCH', source: 'desktop', platform: 18,
    system_id: 'worker-1', version: '3.2.0', ...overrides,
  };
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  originalNasStore = { ...config.insertion.nas.store };
  config.insertion.nas.store.image = true;
  config.insertion.nas.store.video = true;
  for (const fn of Object.values(repo)) if (typeof fn?.mockClear === 'function') fn.mockClear();
  repo.withTransaction.mockImplementation(async (_sql, fn) => fn({}));
  repo.ensurePostOwner.mockResolvedValue(11);
  repo.ensureDomain.mockResolvedValue(12);
  repo.ensureCountry.mockResolvedValue({ countryId: 13, countryOnlyId: 14 });
  repo.getPostOwnerImage.mockResolvedValue(null);
  repo.ensureLanguage.mockResolvedValue(7);
  repo.insertAd.mockResolvedValue(42);
  repo.upsertVariant.mockResolvedValue(15);
  media.uploadImage.mockClear();
  media.uploadTransparencyTextImage.mockClear();
  media.uploadMultimedia.mockClear();
  media.uploadPostOwner.mockClear();
  media.uploadImage.mockResolvedValue({ nas_path: '/pas-prod/stream/gt/image/42.webp' });
  media.uploadPostOwner.mockResolvedValue({ post_owner_image: '/pas-prod/stream/gt/postowner/11.jpg' });
  enqueueVideoDownload.mockClear();
  api.translate.mockReset();
  api.translate.mockResolvedValue({
    ok: true,
    data: {
      detected_language: 'de',
      language_name: 'German',
      title: 'Übersetzter Titel',
      text: 'Übersetzter Text',
      newsfeed_description: '',
    },
  });
  log.warn.mockClear();
  log.error.mockClear();
  log.info.mockClear();
});

afterEach(() => {
  Object.assign(config.insertion.nas.store, originalNasStore);
});

describe('Google Transparency pipeline', () => {
  it('writes shared and transparency rows, then indexes by canonical SQL id', async () => {
    repo.getAd.mockResolvedValue(null);
    const elastic = { indexName: 'google_ads_data_v2', index: vi.fn(async () => ({})) };
    const out = await processTransparencyAd(payload(), { db: { sql: {}, elastic }, log });
    expect(out).toMatchObject({ code: 200, data: { id: 42 } });
    expect(repo.insertAd).toHaveBeenCalledOnce();
    expect(repo.upsertVariant).toHaveBeenCalledOnce();
    expect(repo.upsertTransparency).toHaveBeenCalledOnce();
    expect(repo.ensureLanguage).toHaveBeenCalledWith(expect.anything(), 'de', 'German');
    expect(repo.upsertTranslation).toHaveBeenCalledWith(
      expect.anything(),
      42,
      expect.objectContaining({ detected_language: 'de', text: 'Übersetzter Text' })
    );
    expect(repo.mergeCountryDelivery).toHaveBeenCalledOnce();
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      index: 'google_ads_data_v2', id: '42',
      body: expect.objectContaining({
        platform: 18,
        advertiser_id: payload().advertiser_id,
        language_id: 7,
        lang_detect: 'de',
        ad_text: 'Übersetzter Text',
      }),
    }));
    const traceOutput = log.info.mock.calls.map(([message]) => message).join('\n');
    expect(traceOutput).toContain('TRANSLATION_API_SUCCEEDED');
    expect(traceOutput).toContain('SQL_TRANSLATION_UPSERTED');
    expect(traceOutput).toContain('SQL_TRANSACTION_COMMITTED');
    expect(traceOutput).toContain('ELASTICSEARCH_INDEX_SUCCEEDED');
    expect(traceOutput).toContain('PROCESS_COMPLETED');
  });

  it('uses the update branch idempotently for an existing creative', async () => {
    repo.getAd.mockResolvedValue({ id: 99 });
    const out = await processTransparencyAd(payload(), { db: { sql: {}, elastic: null }, log });
    expect(out).toMatchObject({ code: 200, data: { id: 99 } });
    expect(repo.insertAd).not.toHaveBeenCalled();
    expect(repo.updateAd).toHaveBeenCalledWith(expect.anything(), 99, expect.anything());
  });

  it('uses live-schema-safe owner, country, position, and post-date fallbacks', async () => {
    repo.getAd.mockResolvedValue(null);
    const elastic = { indexName: 'google_ads_data_v2', index: vi.fn(async () => ({})) };
    const testPayload = payload({
      post_owner: null,
      country: [],
      country_details: [],
      subnetwork: 'SHOPPING',
      post_date: null,
    });

    const out = await processTransparencyAd(testPayload, { db: { sql: {}, elastic }, log });

    expect(out.code).toBe(200);
    expect(repo.ensurePostOwner).toHaveBeenCalledWith(
      expect.anything(),
      testPayload.advertiser_id,
      true
    );
    expect(repo.insertAd).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      adPosition: 'FEED',
      countryId: 0,
      countryOnlyId: 0,
      postDateSql: '1000-01-01 00:00:00',
    }));
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        ad_position: 'FEED',
        subnetwork: 'SHOPPING',
        post_date: null,
      }),
    }));
  });

  it('preserves a real stored post_date when a later update sends null', async () => {
    repo.getAd.mockResolvedValue({
      id: 99,
      post_owner_id: 11,
      post_date: '2025-12-01 00:00:00',
    });
    const elastic = {
      indexName: 'google_ads_data_v2',
      search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })),
      index: vi.fn(async () => ({})),
    };

    await processTransparencyAd(payload({ post_date: null }), { db: { sql: {}, elastic }, log });

    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ post_date: '2025-12-01 00:00:00' }),
    }));
  });

  it('queues VIDEO off-request after indexing', async () => {
    repo.getAd.mockResolvedValue(null);
    const elastic = { indexName: 'google_ads_data_v2', index: vi.fn(async () => ({})) };
    const out = await processTransparencyAd(payload({
      type: 'VIDEO',
      video_url_original: 'https://cdn.example/video.mp4',
    }), { db: { sql: {}, elastic }, log });
    expect(out.code).toBe(200);
    expect(enqueueVideoDownload).toHaveBeenCalledWith(expect.objectContaining({
      network: 'google', esIndex: 'google_ads_data_v2', idField: 'id', idValue: 42,
    }));
  });

  it('does not upload IMAGE or owner media again after successful NAS storage', async () => {
    repo.getAd.mockResolvedValue({
      id: 99,
      first_seen: '2025-12-01 00:00:00',
      last_seen: '2025-12-20 00:00:00',
      nas_image_url: '/pas-prod/stream/gt/image/99.webp',
    });
    repo.getPostOwnerImage.mockResolvedValue('/pas-prod/stream/gt/postowner/11.jpg');
    const elastic = {
      indexName: 'google_ads_data_v2',
      search: vi.fn(async () => ({ hits: { hits: [{ _id: '99', _source: {} }] } })),
      index: vi.fn(async () => ({})),
    };
    await processTransparencyAd(payload({
      type: 'IMAGE',
      image_url_original: 'https://cdn.example/image.jpg',
      post_owner_image: 'https://cdn.example/owner.jpg',
    }), { db: { sql: {}, elastic }, log });
    expect(media.uploadImage).not.toHaveBeenCalled();
    expect(media.uploadTransparencyTextImage).not.toHaveBeenCalled();
    expect(media.uploadPostOwner).not.toHaveBeenCalled();
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        image_url: '/pas-prod/stream/gt/image/99.webp',
        post_owner_image: '/pas-prod/stream/gt/postowner/11.jpg',
      }),
    }));
  });

  it('stores a TEXT primary image with the transparency type-aware uploader', async () => {
    repo.getAd.mockResolvedValue(null);
    const elastic = { indexName: 'google_ads_data_v2', index: vi.fn(async () => ({})) };
    await processTransparencyAd(payload({
      type: 'TEXT',
      image_url_original: 'https://cdn.example/text-creative.jpg',
    }), { db: { sql: {}, elastic }, log });
    expect(media.uploadTransparencyTextImage).toHaveBeenCalledWith(
      'https://cdn.example/text-creative.jpg', 42
    );
    expect(repo.setVariantNasImage).toHaveBeenCalledWith(
      {}, 42, '/pas-prod/stream/gt/adT/202607/42.webp'
    );
  });

  it('keeps other multimedia source URLs in SQL and exposes NAS paths in ES', async () => {
    repo.getAd.mockResolvedValue(null);
    const sources = [
      'https://cdn.example/carousel.jpg',
      'https://cdn.example/clip.mp4',
    ];
    media.uploadMultimedia.mockResolvedValueOnce({
      ad_image_video: JSON.stringify([
        '/pas-prod/stream/gt/otherMultiMedia/202607/42_0.jpg',
        '/pas-prod/stream/gt/otherMultiMedia/202607/42_1.mp4',
      ]),
    });
    const elastic = { indexName: 'google_ads_data_v2', index: vi.fn(async () => ({})) };
    await processTransparencyAd(payload({ othermultimedia: sources }), {
      db: { sql: {}, elastic }, log,
    });
    expect(media.uploadMultimedia).toHaveBeenCalledWith(
      sources,
      'TEXT',
      42,
      'google',
      { indexes: [0, 1], store: { image: true, video: true } }
    );
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        othermultimedia: [
          '/pas-prod/stream/gt/otherMultiMedia/202607/42_0.jpg',
          '/pas-prod/stream/gt/otherMultiMedia/202607/42_1.mp4',
        ],
      }),
    }));
  });

  it('reuses successful other-multimedia NAS paths on update', async () => {
    const source = 'https://cdn.example/carousel.jpg';
    const nasPath = '/pas-prod/stream/gt/otherMultiMedia/202607/99_0.jpg';
    repo.getAd.mockResolvedValue({ id: 99, post_owner_id: 11 });
    const elastic = {
      indexName: 'google_ads_data_v2',
      get: vi.fn(async () => ({
        body: {
          _source: {
            othermultimedia: [nasPath],
          },
        },
      })),
      search: vi.fn(),
      index: vi.fn(async () => ({})),
    };

    await processTransparencyAd(payload({ othermultimedia: [source] }), {
      db: { sql: {}, elastic }, log,
    });

    expect(media.uploadMultimedia).not.toHaveBeenCalled();
    expect(elastic.get).toHaveBeenCalledWith({
      index: 'google_ads_data_v2',
      type: 'doc',
      id: '99',
    });
    expect(elastic.search).not.toHaveBeenCalled();
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        othermultimedia: [nasPath],
      }),
    }));
  });

  it('treats an empty translation response as null instead of default English', async () => {
    repo.getAd.mockResolvedValue(null);
    api.translate.mockResolvedValue({
      ok: true,
      data: {
        detected_language: 'en',
        language_name: 'English',
        title: '',
        text: '',
        newsfeed_description: '',
      },
    });
    const elastic = { indexName: 'google_ads_data_v2', index: vi.fn(async () => ({})) };

    await processTransparencyAd(payload(), { db: { sql: {}, elastic }, log });

    expect(repo.ensureLanguage).not.toHaveBeenCalled();
    expect(repo.insertAd).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      languageId: 0,
      languageShouldUpdate: true,
    }));
    expect(repo.upsertTranslation).toHaveBeenCalledWith(expect.anything(), 42, {
      title: '',
      text: '',
      newsfeed_description: '',
    });
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        language_id: 0,
        lang_detect: null,
        ad_title: null,
        ad_text: null,
        news_feed_description: null,
        first_seen: null,
      }),
    }));
    const traceOutput = log.info.mock.calls.map(([message]) => message).join('\n');
    expect(traceOutput).toContain('TRANSLATION_API_EMPTY_RESULT');
    expect(traceOutput).toContain('"raw_detected_language":"en"');
  });

  it('preserves an existing NAS video and does not queue another download', async () => {
    repo.getAd.mockResolvedValue({ id: 99 });
    const elastic = {
      indexName: 'google_ads_data_v2',
      search: vi.fn(async () => ({
        hits: { hits: [{ _id: '99', _source: { nas_video_url: '/pas-prod/stream/gt/video/99.mp4' } }] },
      })),
      index: vi.fn(async () => ({})),
    };
    await processTransparencyAd(payload({
      type: 'VIDEO',
      video_url_original: 'https://cdn.example/video.mp4',
    }), { db: { sql: {}, elastic }, log });
    expect(enqueueVideoDownload).not.toHaveBeenCalled();
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ image_video_url: '/pas-prod/stream/gt/video/99.mp4' }),
    }));
  });

  it('honors server config image=true and video=false without a payload directive', async () => {
    repo.getAd.mockResolvedValue(null);
    const elastic = { indexName: 'google_ads_data_v2', index: vi.fn(async () => ({})) };
    config.insertion.nas.store.image = true;
    config.insertion.nas.store.video = false;

    await processTransparencyAd(payload({
      type: 'VIDEO',
      image_url_original: 'https://cdn.example/poster.jpg',
      video_url_original: 'https://cdn.example/original.mp4',
    }), { db: { sql: {}, elastic }, log });

    expect(media.uploadImage).toHaveBeenCalledWith(
      'https://cdn.example/poster.jpg',
      42,
      'google'
    );
    expect(enqueueVideoDownload).not.toHaveBeenCalled();
    expect(elastic.index).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        image_url_original: 'https://cdn.example/poster.jpg',
        video_url_original: 'https://cdn.example/original.mp4',
        image_video_url: null,
      }),
    }));
    const indexedDoc = elastic.index.mock.calls[0][0].body;
    expect(indexedDoc).not.toHaveProperty('store');
    expect(indexedDoc).not.toHaveProperty('nas_video_url');
  });

  it('rejects invalid input before opening a transaction', async () => {
    const out = await processTransparencyAd(payload({ platform: 17 }), { db: { sql: {}, elastic: null }, log });
    expect(out.code).toBe(422);
    expect(repo.withTransaction).not.toHaveBeenCalled();
  });

  it('returns 503 before SQL writes when required translation is unavailable', async () => {
    api.translate.mockResolvedValue({ ok: false, error: 'translation service down' });
    const out = await processTransparencyAd(payload(), { db: { sql: {}, elastic: null }, log });
    expect(out).toMatchObject({ code: 503, status: 'server_error' });
    expect(repo.withTransaction).not.toHaveBeenCalled();
  });
});

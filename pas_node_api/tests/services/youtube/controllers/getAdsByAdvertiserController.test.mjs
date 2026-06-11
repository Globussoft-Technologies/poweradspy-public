import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const networksPath = require.resolve("../../../../src/config/networks");
require.cache[networksPath] = {
  id: networksPath, filename: networksPath, loaded: true,
  exports: { youtube: { database: { elastic: { index: "yt_idx" } } } },
};

const paramsPath = require.resolve("../../../../src/services/youtube/helpers/paramParser");
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { cleanAdsData: vi.fn((rows) => rows) },
};

const adSearchPath = require.resolve("../../../../src/services/youtube/controllers/adSearchController");
require.cache[adSearchPath] = {
  id: adSearchPath, filename: adSearchPath, loaded: true,
  exports: { AD_DETAIL_SELECT: "*", AD_DETAIL_JOINS: "FROM youtube_ad" },
};

const { getAdsByAdvertiser } = require("../../../../src/services/youtube/controllers/getAdsByAdvertiserController");

const fakeLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
});

function mkDb({ rows = [], esResult = null, esThrows = false } = {}) {
  return {
    sql: { query: vi.fn(async () => [rows]) },
    elastic: esThrows
      ? { search: vi.fn(async () => { throw new Error("es-down"); }) }
      : esResult
      ? { search: vi.fn(async () => esResult) }
      : null,
  };
}

describe("services/youtube/getAdsByAdvertiser", () => {
  it("400 when ad_id missing", async () => {
    const out = await getAdsByAdvertiser({ body: {} }, mkDb(), fakeLogger);
    expect(out.code).toBe(400);
  });

  it("400 when no rows", async () => {
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, mkDb({ rows: [] }), fakeLogger);
    expect(out.message).toBe("No ads found");
  });

  it("happy path returns 200 + total + cleanAdsData", async () => {
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, mkDb({ rows: [{ id: 5 }] }), fakeLogger);
    expect(out.code).toBe(200);
    expect(out.total).toBe(1);
  });

  it("ES enrichment maps new_nas_image_url + reactions.likes + views (.body shape)", async () => {
    const db = mkDb({
      rows: [{ id: 5 }],
      esResult: { body: { hits: { hits: [{ _source: {
        new_nas_image_url: "http://x",
        reactions: { likes: 42 },
        views: 100,
      } }] } } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("http://x");
    expect(out.data[0].likes).toBe(42);
    expect(out.data[0].view).toBe(100);
  });

  it("ES top-level hits shape works", async () => {
    const db = mkDb({
      rows: [{ id: 5 }],
      esResult: { hits: { hits: [{ _source: { new_nas_image_url: "http://y" } }] } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("http://y");
  });

  it("hit.reactions present but no .likes → likes left alone (line 59 false)", async () => {
    const db = mkDb({
      rows: [{ id: 5 }],
      esResult: { hits: { hits: [{ _source: { reactions: {} } }] } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].likes).toBeUndefined();
  });

  it("hit.views undefined → view not assigned (line 61 false)", async () => {
    const db = mkDb({
      rows: [{ id: 5 }],
      esResult: { hits: { hits: [{ _source: { reactions: { likes: 1 } } }] } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].view).toBeUndefined();
  });

  it("ES no hit → fields untouched", async () => {
    const db = mkDb({ rows: [{ id: 5 }], esResult: { hits: { hits: [] } } });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBeUndefined();
  });

  it("ES throws → warn logged with ad_id + error message", async () => {
    const db = mkDb({ rows: [{ id: 5 }], esThrows: true });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      "ES error in YouTube advertiser search",
      expect.objectContaining({ ad_id: 5, error: "es-down" })
    );
  });

  it("no db.elastic → skip ES (line 36 false)", async () => {
    const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("result not nested array → flat fallback (line 27 false)", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 5 }]) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("500 on outer catch", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db"); }) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("ES index falls back to YT_ELASTIC_INDEX env var (line 39 second operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { youtube: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/youtube/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/youtube/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.YT_ELASTIC_INDEX;
    process.env.YT_ELASTIC_INDEX = "env_yt_idx";
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: { search: esSearch } };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("env_yt_idx");
    } finally {
      if (origEnv !== undefined) process.env.YT_ELASTIC_INDEX = origEnv;
      else delete process.env.YT_ELASTIC_INDEX;
      require.cache[networksPath].exports = origExports;
    }
  });

  it("ES index falls back to 'youtube_ads_data' when both config and env missing (line 39 third operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { youtube: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/youtube/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/youtube/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.YT_ELASTIC_INDEX;
    delete process.env.YT_ELASTIC_INDEX;
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: { search: esSearch } };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("youtube_ads_data");
    } finally {
      if (origEnv !== undefined) process.env.YT_ELASTIC_INDEX = origEnv;
      require.cache[networksPath].exports = origExports;
    }
  });
});

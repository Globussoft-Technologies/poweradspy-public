import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const networksPath = require.resolve("../../../../src/config/networks");
require.cache[networksPath] = {
  id: networksPath, filename: networksPath, loaded: true,
  exports: { facebook: { database: { elastic: { index: "fb_idx" } } } },
};

const paramsPath = require.resolve("../../../../src/services/facebook/helpers/paramParser");
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { cleanAdsData: vi.fn((rows) => rows) },
};

const adSearchPath = require.resolve("../../../../src/services/facebook/controllers/adSearchController");
require.cache[adSearchPath] = {
  id: adSearchPath, filename: adSearchPath, loaded: true,
  exports: { AD_DETAIL_SELECT: "*", AD_DETAIL_JOINS: "FROM facebook_ad" },
};

const { getAdsByAdvertiser } = require("../../../../src/services/facebook/controllers/getAdsByAdvertiserController");

const fakeLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
});

function mkDb({ rows = [], urls = [], esResult = null, esThrows = false } = {}) {
  let calls = 0;
  return {
    sql: {
      query: vi.fn(async () => {
        calls++;
        if (calls === 1) return [rows];
        return [urls];
      }),
    },
    elastic: esThrows
      ? { search: vi.fn(async () => { throw new Error("es-down"); }) }
      : esResult
      ? { search: vi.fn(async () => esResult) }
      : null,
  };
}

describe("services/facebook/getAdsByAdvertiser", () => {
  it("400 when ad_id missing", async () => {
    const out = await getAdsByAdvertiser({ body: {} }, mkDb(), fakeLogger);
    expect(out.code).toBe(400);
    expect(out.message).toBe("ad_id is required");
  });

  it("400 when no rows", async () => {
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, mkDb({ rows: [] }), fakeLogger);
    expect(out.message).toBe("No ads found");
  });

  it("happy path: returns 200 with ad data + urlArray", async () => {
    const db = mkDb({ rows: [{ id: 5 }], urls: [{ url: "u" }] });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.message).toBe("Ad data found");
    expect(out.ads_count).toBe(1);
    expect(out.data[0].urlArray).toEqual([{ url: "u" }]);
  });

  it("ES enrichment populates image_video_url + image_url (.body shape only — top-level not supported)", async () => {
    const db = mkDb({
      rows: [{ id: 5 }],
      esResult: { body: { hits: { hits: [{ _source: { new_nas_image_url: "http://img" } }] } } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("http://img");
    expect(out.data[0].image_url).toBe("http://img");
  });

  it("ES no hit → image fields unchanged (line 66 false)", async () => {
    const db = mkDb({ rows: [{ id: 5 }], esResult: { body: { hits: { hits: [] } } } });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBeUndefined();
  });

  it("ES throws → warn logged", async () => {
    const db = mkDb({ rows: [{ id: 5 }], esThrows: true });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES error", { ad_id: 5 });
  });

  it("no db.elastic → skip ES (line 47 false)", async () => {
    const db = mkDb({ rows: [{ id: 5 }] });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("urlsRes not nested → flat fallback (line 44 false)", async () => {
    const db = {
      sql: {
        query: vi.fn()
          .mockResolvedValueOnce([[{ id: 5 }]])
          .mockResolvedValueOnce([{ url: "x" }]),
      },
      elastic: null,
    };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].urlArray).toEqual([{ url: "x" }]);
  });

  it("result[0] not array → flat fallback (line 30 false)", async () => {
    const db = {
      sql: {
        query: vi.fn()
          .mockResolvedValueOnce([{ id: 5 }])
          .mockResolvedValueOnce([[]]),
      },
      elastic: null,
    };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("non-numeric take → 1 fallback", async () => {
    const db = mkDb({ rows: [{ id: 5 }] });
    await getAdsByAdvertiser({ body: { ad_id: 1, take: "x" } }, db, fakeLogger);
    expect(db.sql.query.mock.calls[0][0]).toContain("LIMIT 1");
  });

  it("500 on outer catch", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db"); }) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("ES index falls back to FB_ELASTIC_INDEX env var when networks config has no index (line 50 second operand)", async () => {
    // Mutate the cached networks module so fbNet.database.elastic.index is missing.
    // Re-import the SUT so it picks up the change.
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { facebook: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/facebook/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/facebook/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.FB_ELASTIC_INDEX;
    process.env.FB_ELASTIC_INDEX = "env_fb_idx";
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = {
        sql: { query: vi.fn().mockResolvedValueOnce([[{ id: 5 }]]).mockResolvedValueOnce([[]]) },
        elastic: { search: esSearch },
      };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("env_fb_idx");
    } finally {
      process.env.FB_ELASTIC_INDEX = origEnv;
      require.cache[networksPath].exports = origExports;
    }
  });

  it("ES index falls back to 'search_mix' when both config and env missing (line 50 third operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { facebook: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/facebook/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/facebook/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.FB_ELASTIC_INDEX;
    delete process.env.FB_ELASTIC_INDEX;
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = {
        sql: { query: vi.fn().mockResolvedValueOnce([[{ id: 5 }]]).mockResolvedValueOnce([[]]) },
        elastic: { search: esSearch },
      };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("search_mix");
    } finally {
      if (origEnv !== undefined) process.env.FB_ELASTIC_INDEX = origEnv;
      require.cache[networksPath].exports = origExports;
    }
  });
});

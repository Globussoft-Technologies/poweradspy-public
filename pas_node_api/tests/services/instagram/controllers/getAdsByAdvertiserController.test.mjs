import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const networksPath = require.resolve("../../../../src/config/networks");
require.cache[networksPath] = {
  id: networksPath, filename: networksPath, loaded: true,
  exports: { instagram: { database: { elastic: { index: "ig_idx" } } } },
};

const paramsPath = require.resolve("../../../../src/services/instagram/helpers/paramParser");
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { cleanAdsData: vi.fn((rows) => rows) },
};

const adSearchPath = require.resolve("../../../../src/services/instagram/controllers/adSearchController");
require.cache[adSearchPath] = {
  id: adSearchPath, filename: adSearchPath, loaded: true,
  exports: { AD_DETAIL_SELECT: "*", AD_DETAIL_JOINS: "FROM instagram_ad" },
};

const { getAdsByAdvertiser } = require("../../../../src/services/instagram/controllers/getAdsByAdvertiserController");

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
        if (calls === 1) return [rows]; // outer SELECT
        return [urls]; // instagram_ad_url subquery (nested array shape)
      }),
    },
    elastic: esThrows
      ? { search: vi.fn(async () => { throw new Error("es-down"); }) }
      : esResult
      ? { search: vi.fn(async () => esResult) }
      : null,
  };
}

describe("services/instagram/getAdsByAdvertiser", () => {
  it("400 when ad_id missing", async () => {
    const out = await getAdsByAdvertiser({ body: {} }, mkDb(), fakeLogger);
    expect(out).toEqual({ code: 400, message: "ad_id is required", data: null });
  });

  it("400 when no rows", async () => {
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, mkDb({ rows: [] }), fakeLogger);
    expect(out.message).toBe("No ads found");
  });

  it("happy path: rows + urlArray + ES enrichment", async () => {
    const db = mkDb({
      rows: [{ id: 5 }],
      urls: [{ url: "https://x/y" }],
      esResult: { body: { hits: { hits: [{ _source: { new_nas_image_url: "http://img" } }] } } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].urlArray).toEqual([{ url: "https://x/y" }]);
    expect(out.data[0].image_video_url).toBe("http://img");
    expect(out.data[0].image_url).toBe("http://img");
  });

  it("ES top-level hits shape works", async () => {
    const db = mkDb({
      rows: [{ id: 5 }],
      esResult: { hits: { hits: [{ _source: { new_nas_image_url: "http://y" } }] } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("http://y");
  });

  it("ES no hit → image fields unchanged (line 60 false)", async () => {
    const db = mkDb({ rows: [{ id: 5 }], esResult: { hits: { hits: [] } } });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBeUndefined();
  });

  it("ES throws → warn logged with ad_id + error", async () => {
    const db = mkDb({ rows: [{ id: 5 }], esThrows: true });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      "ES error in Instagram advertiser search",
      expect.objectContaining({ ad_id: 5, error: "es-down" })
    );
  });

  it("no db.elastic → skip ES (line 43 false branch)", async () => {
    const db = mkDb({ rows: [{ id: 5 }] }); // elastic=null
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("urlsRes not nested array → flat fallback (line 40 false)", async () => {
    const db = {
      sql: {
        query: vi.fn()
          .mockResolvedValueOnce([[{ id: 5 }]]) // outer SELECT
          .mockResolvedValueOnce([{ url: "x" }]), // flat array (no nesting)
      },
      elastic: null,
    };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].urlArray).toEqual([{ url: "x" }]);
  });

  it("result not nested array → flat fallback (line 27 false branch)", async () => {
    const db = {
      sql: {
        query: vi.fn()
          .mockResolvedValueOnce([{ id: 5 }]) // flat top-level
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

  it("500 on outer catch when sql.query throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("ES index falls back to IG_ELASTIC_INDEX env var (line 46 second operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { instagram: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/instagram/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/instagram/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.IG_ELASTIC_INDEX;
    process.env.IG_ELASTIC_INDEX = "env_ig_idx";
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: { search: esSearch } };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("env_ig_idx");
    } finally {
      if (origEnv !== undefined) process.env.IG_ELASTIC_INDEX = origEnv;
      else delete process.env.IG_ELASTIC_INDEX;
      require.cache[networksPath].exports = origExports;
    }
  });

  it("ES index falls back to 'instagram_ads_data' when both config and env missing (line 46 third operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { instagram: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/instagram/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/instagram/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.IG_ELASTIC_INDEX;
    delete process.env.IG_ELASTIC_INDEX;
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: { search: esSearch } };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("instagram_ads_data");
    } finally {
      if (origEnv !== undefined) process.env.IG_ELASTIC_INDEX = origEnv;
      require.cache[networksPath].exports = origExports;
    }
  });
});

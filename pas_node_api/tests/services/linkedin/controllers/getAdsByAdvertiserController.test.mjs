import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const networksPath = require.resolve("../../../../src/config/networks");
require.cache[networksPath] = {
  id: networksPath, filename: networksPath, loaded: true,
  exports: { linkedin: { database: { elastic: { index: "li_idx" } } } },
};

const paramsPath = require.resolve("../../../../src/services/linkedin/helpers/paramParser");
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { cleanAdsData: vi.fn((rows) => rows) },
};

const adSearchPath = require.resolve("../../../../src/services/linkedin/controllers/adSearchController");
require.cache[adSearchPath] = {
  id: adSearchPath, filename: adSearchPath, loaded: true,
  exports: { AD_DETAIL_SELECT: "*", AD_DETAIL_JOINS: "FROM linkedin_ad" },
};

const { getAdsByAdvertiser } = require("../../../../src/services/linkedin/controllers/getAdsByAdvertiserController");

function mockDb({ rows = [], esResult = null, esThrows = false } = {}) {
  return {
    sql: { query: vi.fn(async () => [rows]) },
    elastic: esThrows
      ? { search: vi.fn(async () => { throw new Error("es-down"); }) }
      : esResult
      ? { search: vi.fn(async () => esResult) }
      : null,
  };
}

const fakeLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
});

describe("services/linkedin/getAdsByAdvertiser", () => {
  it("400 when ad_id missing", async () => {
    const out = await getAdsByAdvertiser({ body: {} }, mockDb(), fakeLogger);
    expect(out.code).toBe(400);
    expect(out.message).toBe("ad_id is required");
  });

  it("400 when no rows", async () => {
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, mockDb({ rows: [] }), fakeLogger);
    expect(out.message).toBe("No ads found");
  });

  it("happy path returns 200 + total + cleanAdsData", async () => {
    const out = await getAdsByAdvertiser(
      { body: { ad_id: 1, take: 2, skip: 1 } },
      mockDb({ rows: [{ id: 5 }] }),
      fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.total).toBe(1);
  });

  it("ES enrichment populates image_video_url (.body shape)", async () => {
    const db = mockDb({
      rows: [{ id: 5 }],
      esResult: { body: { hits: { hits: [{ _source: { new_nas_image_url: "http://x" } }] } } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("http://x");
  });

  it("ES top-level hits shape", async () => {
    const db = mockDb({
      rows: [{ id: 5 }],
      esResult: { hits: { hits: [{ _source: { new_nas_image_url: "http://y" } }] } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("http://y");
  });

  it("ES no hit → row unchanged", async () => {
    const db = mockDb({ rows: [{ id: 5 }], esResult: { hits: { hits: [] } } });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBeUndefined();
  });

  it("ES throws → warn logged, flow continues", async () => {
    const db = mockDb({ rows: [{ id: 5 }], esThrows: true });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES error in LinkedIn search", { ad_id: 5 });
  });

  it("no db.elastic → skip ES", async () => {
    const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("non-nested array result → fallback (line 18 false)", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 5 }]) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("non-numeric take → 1 fallback", async () => {
    const db = mockDb({ rows: [{ id: 5 }] });
    await getAdsByAdvertiser({ body: { ad_id: 1, take: "x" } }, db, fakeLogger);
    expect(db.sql.query.mock.calls[0][0]).toContain("LIMIT 1");
  });

  it("500 on outer catch", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db"); }) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("ES index falls back to LI_ELASTIC_INDEX env var (line 26 second operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { linkedin: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/linkedin/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/linkedin/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.LI_ELASTIC_INDEX;
    process.env.LI_ELASTIC_INDEX = "env_li_idx";
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: { search: esSearch } };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("env_li_idx");
    } finally {
      process.env.LI_ELASTIC_INDEX = origEnv;
      require.cache[networksPath].exports = origExports;
    }
  });

  it("ES index falls back to 'linkedin_ads_data' when both config and env missing (line 26 third operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { linkedin: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/linkedin/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/linkedin/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.LI_ELASTIC_INDEX;
    delete process.env.LI_ELASTIC_INDEX;
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: { search: esSearch } };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("linkedin_ads_data");
    } finally {
      if (origEnv !== undefined) process.env.LI_ELASTIC_INDEX = origEnv;
      require.cache[networksPath].exports = origExports;
    }
  });
});

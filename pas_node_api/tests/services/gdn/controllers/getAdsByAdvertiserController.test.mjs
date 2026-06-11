import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock collaborators BEFORE the SUT loads
const networksPath = require.resolve("../../../../src/config/networks");
require.cache[networksPath] = {
  id: networksPath, filename: networksPath, loaded: true,
  exports: { gdn: { database: { elastic: { index: "gdn_idx" } } } },
};

const paramsPath = require.resolve("../../../../src/services/gdn/helpers/paramParser");
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { cleanAdsData: vi.fn((rows) => rows) },
};

const adSearchPath = require.resolve("../../../../src/services/gdn/controllers/adSearchController");
require.cache[adSearchPath] = {
  id: adSearchPath, filename: adSearchPath, loaded: true,
  exports: { AD_DETAIL_SELECT: "*", AD_DETAIL_JOINS: "FROM gdn_ad" },
};

const { getAdsByAdvertiser } = require("../../../../src/services/gdn/controllers/getAdsByAdvertiserController");

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

describe("services/gdn/getAdsByAdvertiser", () => {
  it("400 when ad_id missing", async () => {
    const out = await getAdsByAdvertiser({ body: {} }, mockDb(), fakeLogger);
    expect(out).toEqual({ code: 400, message: "ad_id is required", data: null });
  });

  it("400 when no rows found", async () => {
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, mockDb({ rows: [] }), fakeLogger);
    expect(out).toEqual({ code: 400, message: "No ads found", data: null });
  });

  it("happy path: rows returned + cleanAdsData wrapper", async () => {
    const out = await getAdsByAdvertiser(
      { body: { ad_id: 1, take: 2, skip: 1 } },
      mockDb({ rows: [{ id: 5 }] }),
      fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.total).toBe(1);
    expect(out.message).toBe("Ads fetched successfully");
  });

  it("ES enrichment: hit.new_nas_image_url assigned to row.image_video_url", async () => {
    const db = mockDb({
      rows: [{ id: 5 }],
      esResult: { body: { hits: { hits: [{ _source: { new_nas_image_url: "http://img" } }] } } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("http://img");
  });

  it("ES enrichment via top-level hits (no .body wrapper)", async () => {
    const db = mockDb({
      rows: [{ id: 5 }],
      esResult: { hits: { hits: [{ _source: { new_nas_image_url: "http://img2" } }] } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("http://img2");
  });

  it("ES no hit → row unchanged (line 30 false branch)", async () => {
    const db = mockDb({
      rows: [{ id: 5 }],
      esResult: { hits: { hits: [] } },
    });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBeUndefined();
  });

  it("ES throws → inner catch logs warn but flow continues", async () => {
    const db = mockDb({ rows: [{ id: 5 }], esThrows: true });
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES error in GDN search", { ad_id: 5 });
  });

  it("no db.elastic → skip ES enrichment (line 23 false branch)", async () => {
    const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: null };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("db.sql.query returns non-nested array → fallback (line 18 false branch)", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 5 }]) }, // top-level array, not [[]]
      elastic: null,
    };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("default take/skip when omitted from body", async () => {
    const db = mockDb({ rows: [{ id: 5 }] });
    await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    const sql = db.sql.query.mock.calls[0][0];
    expect(sql).toContain("LIMIT 1");
    expect(sql).toContain("OFFSET 0");
  });

  it("take non-numeric → falls back to 1 (line 12 `|| 1`)", async () => {
    const db = mockDb({ rows: [{ id: 5 }] });
    await getAdsByAdvertiser({ body: { ad_id: 1, take: "abc" } }, db, fakeLogger);
    const sql = db.sql.query.mock.calls[0][0];
    expect(sql).toContain("LIMIT 1");
  });

  it("500 on outer catch when db.sql.query throws", async () => {
    const db = {
      sql: { query: vi.fn(async () => { throw new Error("db-down"); }) },
      elastic: null,
    };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.message).toBe("db-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("ES index falls back to GDN_ELASTIC_INDEX env var when networks config has no index (line 26 second operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { gdn: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/gdn/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/gdn/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.GDN_ELASTIC_INDEX;
    process.env.GDN_ELASTIC_INDEX = "env_gdn_idx";
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: { search: esSearch } };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("env_gdn_idx");
    } finally {
      if (origEnv !== undefined) process.env.GDN_ELASTIC_INDEX = origEnv;
      else delete process.env.GDN_ELASTIC_INDEX;
      require.cache[networksPath].exports = origExports;
    }
  });

  it("ES index falls back to 'gdn_ads_data' when both config and env missing (line 26 third operand)", async () => {
    const origExports = require.cache[networksPath].exports;
    require.cache[networksPath].exports = { gdn: { database: { elastic: {} } } };
    delete require.cache[require.resolve("../../../../src/services/gdn/controllers/getAdsByAdvertiserController")];
    const reloaded = require("../../../../src/services/gdn/controllers/getAdsByAdvertiserController");
    const origEnv = process.env.GDN_ELASTIC_INDEX;
    delete process.env.GDN_ELASTIC_INDEX;
    try {
      const esSearch = vi.fn(async () => ({ body: { hits: { hits: [] } } }));
      const db = { sql: { query: vi.fn(async () => [[{ id: 5 }]]) }, elastic: { search: esSearch } };
      await reloaded.getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(esSearch.mock.calls[0][0].index).toBe("gdn_ads_data");
    } finally {
      if (origEnv !== undefined) process.env.GDN_ELASTIC_INDEX = origEnv;
      require.cache[networksPath].exports = origExports;
    }
  });
});

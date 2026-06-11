import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/tiktok/helpers/paramParser");
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { cleanAdsData: vi.fn((rows) => rows) },
};

const { getAdsByAdvertiser } = require("../../../../src/services/tiktok/controllers/getAdsByAdvertiserController");

const fakeLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

beforeEach(() => { fakeLogger.error.mockClear(); });

describe("services/tiktok/getAdsByAdvertiser", () => {
  it("400 when ad_id missing", async () => {
    const out = await getAdsByAdvertiser({ body: {} }, { elastic: {} }, fakeLogger);
    expect(out).toEqual({ code: 400, message: "ad_id is required", data: null });
  });

  it("400 when body undefined → `req.body || {}` fallback fires", async () => {
    const out = await getAdsByAdvertiser({}, { elastic: {} }, fakeLogger);
    expect(out.code).toBe(400);
  });

  it("503 when no db.elastic", async () => {
    const out = await getAdsByAdvertiser({ body: { ad_id: 5 } }, {}, fakeLogger);
    expect(out.code).toBe(503);
  });

  it("400 'No ads found' when ES returns empty hits", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    const out = await getAdsByAdvertiser({ body: { ad_id: 5 } }, db, fakeLogger);
    expect(out.message).toBe("No ads found");
  });

  it("200 with cleanAdsData(docs) on happy path", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { sql_id: 5, ad_title: "T" } }] } })) },
    };
    const out = await getAdsByAdvertiser({ body: { ad_id: 5 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toEqual([{ sql_id: 5, ad_title: "T" }]);
  });

  it("uses result.body.hits fallback when top-level hits missing", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { sql_id: 1 } }] } } })) },
    };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("uses db.elastic.indexName when set (line 30 first || left)", async () => {
    const db = {
      elastic: { indexName: "custom_idx", search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].index).toBe("custom_idx");
  });

  it("falls back to TT_ELASTIC_INDEX env when indexName missing", async () => {
    process.env.TT_ELASTIC_INDEX = "from_env";
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    try {
      await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
      expect(db.elastic.search.mock.calls[0][0].index).toBe("from_env");
    } finally {
      delete process.env.TT_ELASTIC_INDEX;
    }
  });

  it("falls back to 'tiktok_ads' literal when both indexName + env missing", async () => {
    delete process.env.TT_ELASTIC_INDEX;
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].index).toBe("tiktok_ads");
  });

  it("500 on ES throw; logger?.error?. optional-chain still calls", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("500 on ES throw; missing logger does NOT crash (optional-chain noop)", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, undefined);
    expect(out.code).toBe(500);
  });

  it("ES result with hits but no inner .hits → `|| []` fallback fires (line 39 right operand)", async () => {
    // hits exists at the top level but lacks the nested .hits array → optional
    // chain returns undefined → `|| []` fallback. docs.length === 0 → 400.
    const db = { elastic: { search: vi.fn(async () => ({ hits: { /* no .hits */ total: 0 } })) } };
    const out = await getAdsByAdvertiser({ body: { ad_id: 1 } }, db, fakeLogger);
    expect(out.code).toBe(400);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { getAdsCount } = require("../../../../src/services/google/controllers/adCountController");

const fakeLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

beforeEach(() => { fakeLogger.error.mockClear(); });

describe("services/google/controllers/adCountController > getAdsCount", () => {
  it("503 when db.elastic missing", async () => {
    const out = await getAdsCount({}, { elastic: null }, fakeLogger);
    expect(out).toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });

  it("200 with count (total as object)", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { total: { value: 42 } } })) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out).toEqual({ code: 200, data: { count: 42 }, message: "Ad count fetched successfully" });
  });

  it("200 with count (total as number, body.hits fallback)", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { total: 7 } } })) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.data).toEqual({ count: 7 });
  });

  it("500 + logger.error on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("es-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("uses GOOG_ELASTIC_INDEX env when set", async () => {
    process.env.GOOG_ELASTIC_INDEX = "custom_google";
    const db = { elastic: { search: vi.fn(async () => ({ hits: { total: 0 } })) } };
    try {
      await getAdsCount({}, db, fakeLogger);
      expect(db.elastic.search.mock.calls[0][0].index).toBe("custom_google");
    } finally {
      delete process.env.GOOG_ELASTIC_INDEX;
    }
  });

  it("falls back to 'google_ads_data' literal when env missing", async () => {
    delete process.env.GOOG_ELASTIC_INDEX;
    const db = { elastic: { search: vi.fn(async () => ({ hits: { total: 0 } })) } };
    await getAdsCount({}, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].index).toBe("google_ads_data");
  });
});

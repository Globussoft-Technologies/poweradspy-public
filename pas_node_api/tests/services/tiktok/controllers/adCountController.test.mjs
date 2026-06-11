import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { getAdsCount } = require("../../../../src/services/tiktok/controllers/adCountController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  fakeLogger.error.mockClear();
});

describe("services/tiktok/controllers/adCountController > getAdsCount", () => {
  it("503 when db.elastic is missing", async () => {
    const out = await getAdsCount({}, { elastic: null }, fakeLogger);
    expect(out).toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });

  it("200 with count when ES returns total as object (track_total_hits)", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { total: { value: 1234, relation: "eq" } } })) },
    };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toEqual({ count: 1234 });
    expect(out.message).toBe("Ad count fetched successfully");
  });

  it("200 with count when ES returns total as number (line 25 ternary false branch)", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { total: 99 } })) },
    };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.data).toEqual({ count: 99 });
  });

  it("falls back to result.body.hits when result.hits is missing (line 24)", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ body: { hits: { total: { value: 7 } } } })) },
    };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.data).toEqual({ count: 7 });
  });

  it("500 + logged on ES error", async () => {
    const db = {
      elastic: { search: vi.fn(async () => { throw new Error("es-fail"); }) },
    };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.message).toBe("Error occurred while fetching ad count");
    expect(out.error).toBe("es-fail");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("uses TT_ELASTIC_INDEX env var when set", async () => {
    process.env.TT_ELASTIC_INDEX = "custom_tt_idx";
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { total: 0 } })) },
    };
    try {
      await getAdsCount({}, db, fakeLogger);
      expect(db.elastic.search.mock.calls[0][0].index).toBe("custom_tt_idx");
    } finally {
      delete process.env.TT_ELASTIC_INDEX;
    }
  });

  it("falls back to 'tiktok_ads' literal when env var missing", async () => {
    delete process.env.TT_ELASTIC_INDEX;
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { total: 0 } })) },
    };
    await getAdsCount({}, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].index).toBe("tiktok_ads");
  });
});

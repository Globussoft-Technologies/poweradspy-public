import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { getAdsCount } = require("../../../../src/services/facebook/controllers/adCountController");

const fakeLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

beforeEach(() => {
  fakeLogger.error.mockClear();
  process.env.FB_ES_INDEX = "fb_idx";
});

describe("services/facebook/controllers/adCountController > getAdsCount", () => {
  it("503 when db.elastic missing", async () => {
    const out = await getAdsCount({}, { elastic: null }, fakeLogger);
    expect(out).toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });

  it("200 with count when total is object", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { total: { value: 7 } } })) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out).toEqual({ code: 200, data: { count: 7 }, message: "Ad count fetched successfully" });
    expect(db.elastic.search.mock.calls[0][0].index).toBe("fb_idx");
  });

  it("200 with count when total is number (body.hits fallback)", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { total: 42 } } })) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.data).toEqual({ count: 42 });
  });

  it("500 + logged on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-fail"); }) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("es-fail");
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

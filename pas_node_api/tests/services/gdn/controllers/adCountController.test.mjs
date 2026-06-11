import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { getAdsCount } = require("../../../../src/services/gdn/controllers/adCountController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => fakeLogger.error.mockClear());

describe("services/gdn/controllers/adCountController > getAdsCount", () => {
  it("503 when db.elastic missing", async () => {
    const out = await getAdsCount({}, { elastic: null }, fakeLogger);
    expect(out).toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });

  it("200 with count (total as object)", async () => {
    const db = { elastic: { indexName: "gdn", search: vi.fn(async () => ({ hits: { total: { value: 50 } } })) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out).toEqual({ code: 200, data: { count: 50 }, message: "GDN ad count fetched successfully" });
    expect(db.elastic.search.mock.calls[0][0].index).toBe("gdn");
  });

  it("200 with count (total as number, body.hits fallback)", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { total: 7 } } })) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.data).toEqual({ count: 7 });
  });

  it("500 + logger.error on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-fail"); }) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("es-fail");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("falls back to 'gdn_search_mix' when indexName missing", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { total: 0 } })) } };
    await getAdsCount({}, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].index).toBe("gdn_search_mix");
  });
});

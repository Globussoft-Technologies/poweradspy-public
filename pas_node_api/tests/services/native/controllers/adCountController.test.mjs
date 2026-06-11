import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { getAdsCount } = require("../../../../src/services/native/controllers/adCountController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => fakeLogger.error.mockClear());

describe("services/native/controllers/adCountController > getAdsCount", () => {
  it("503 when db.elastic missing", async () => {
    expect(await getAdsCount({}, { elastic: null }, fakeLogger))
      .toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });

  it("200 (total as object)", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { total: { value: 8 } } })) } };
    expect(await getAdsCount({}, db, fakeLogger))
      .toEqual({ code: 200, data: { count: 8 }, message: "Ad count fetched successfully" });
  });

  it("200 (total as number via body.hits)", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { total: 3 } } })) } };
    expect((await getAdsCount({}, db, fakeLogger)).data).toEqual({ count: 3 });
  });

  it("500 + logger.error on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-fail"); }) } };
    const out = await getAdsCount({}, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("es-fail");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("uses NAT_ELASTIC_INDEX env when set", async () => {
    process.env.NAT_ELASTIC_INDEX = "custom_nat";
    const db = { elastic: { search: vi.fn(async () => ({ hits: { total: 0 } })) } };
    try {
      await getAdsCount({}, db, fakeLogger);
      expect(db.elastic.search.mock.calls[0][0].index).toBe("custom_nat");
    } finally {
      delete process.env.NAT_ELASTIC_INDEX;
    }
  });

  it("falls back to 'native_search_mix' literal when env missing", async () => {
    delete process.env.NAT_ELASTIC_INDEX;
    const db = { elastic: { search: vi.fn(async () => ({ hits: { total: 0 } })) } };
    await getAdsCount({}, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].index).toBe("native_search_mix");
  });
});

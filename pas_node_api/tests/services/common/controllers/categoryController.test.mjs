import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const regPath = require.resolve("../../../../src/services/ServiceRegistry");
const serviceRegistry = { getService: vi.fn() };
require.cache[regPath] = {
  id: regPath, filename: regPath, loaded: true, exports: serviceRegistry,
};

const sduiDbPath = require.resolve("../../../../src/services/sdui/db");
const getDB = vi.fn();
require.cache[sduiDbPath] = {
  id: sduiDbPath, filename: sduiDbPath, loaded: true,
  exports: { getDB },
};

const { syncCategory, syncAllCategories } = require(
  "../../../../src/services/common/controllers/categoryController"
);

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

function mkService({ esSearch, log = { info: vi.fn(), error: vi.fn() } } = {}) {
  return { db: { elastic: { search: esSearch } }, log };
}

beforeEach(() => {
  serviceRegistry.getService.mockReset();
  getDB.mockReset();
});

describe("categoryController > syncCategory", () => {
  it("400 when cat_id missing", async () => {
    const res = mkRes();
    await syncCategory({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it("503 when no service with elastic available", async () => {
    serviceRegistry.getService.mockReturnValue(null);
    const res = mkRes();
    await syncCategory({ body: { cat_id: "1" } }, res);
    expect(res.statusCode).toBe(503);
  });

  it("falls through facebook then instagram when gdn / facebook null", async () => {
    serviceRegistry.getService.mockImplementation((slug) => {
      if (slug === "gdn") return null;
      if (slug === "facebook") return null;
      if (slug === "instagram") return mkService({ esSearch: vi.fn(async () => ({ hits: { hits: [] } })) });
      return null;
    });
    const res = mkRes();
    await syncCategory({ body: { cat_id: "1" } }, res);
    expect(res.statusCode).toBe(404); // category not in ES
  });

  it("404 when ES returns no hits", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await syncCategory({ body: { cat_id: "1" } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("404 when sdui_config doc missing (with log.info present)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: { category: "C", cat_id: 1, platforms: ["facebook"], subcategory: [] } }] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, log: { info: vi.fn() } }));
    getDB.mockResolvedValue({
      collection: () => ({ findOne: vi.fn(async () => null), updateOne: vi.fn() }),
    });
    const res = mkRes();
    await syncCategory({ body: { cat_id: "1" } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toContain("sdui_config");
  });

  it("404 when categories filter missing from doc", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: { category: "C", cat_id: 1 } }] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    getDB.mockResolvedValue({
      collection: () => ({ findOne: async () => ({ filters: [] }), updateOne: vi.fn() }),
    });
    const res = mkRes();
    await syncCategory({ body: { cat_id: "1" } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("200 inserts new category (sorted) with subcategories + service log", async () => {
    const updateOne = vi.fn();
    const logInfo = vi.fn();
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      category: "Beta", cat_id: 2, platforms: ["facebook"],
      subcategory: [{ sub_cat: "S1", sub_cat_id: 11, platforms: ["facebook"] }],
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, log: { info: logInfo } }));
    getDB.mockResolvedValue({
      collection: () => ({
        findOne: async () => ({ filters: [{ _id: "categories", options: [{ cat_id: "1", label: "Alpha" }] }] }),
        updateOne,
      }),
    });
    const res = mkRes();
    await syncCategory({ body: { cat_id: "2" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.synced).toBe("inserted");
    expect(updateOne).toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalled();
  });

  it("200 updates existing category", async () => {
    const updateOne = vi.fn();
    const search = vi.fn(async () => ({ body: { hits: { hits: [{ _source: { category: "Existing", cat_id: 5, platforms: [], subcategory: [] } }] } } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    getDB.mockResolvedValue({
      collection: () => ({
        findOne: async () => ({ filters: [{ _id: "categories", options: [{ cat_id: "5", label: "Old" }] }] }),
        updateOne,
      }),
    });
    const res = mkRes();
    await syncCategory({ body: { cat_id: "5" } }, res);
    expect(res.body.synced).toBe("updated");
  });

  it("handles filter with options undefined", async () => {
    const updateOne = vi.fn();
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: { category: "X", cat_id: 9 } }] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    getDB.mockResolvedValue({
      collection: () => ({
        findOne: async () => ({ filters: [{ _id: "categories" /* no options */ }] }),
        updateOne,
      }),
    });
    const res = mkRes();
    await syncCategory({ body: { cat_id: "9" } }, res);
    expect(res.statusCode).toBe(200);
  });

  it("500 on outer throw (with log.error)", async () => {
    const search = vi.fn(async () => { throw new Error("es-down"); });
    const logError = vi.fn();
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, log: { error: logError } }));
    const res = mkRes();
    await syncCategory({ body: { cat_id: "1" } }, res);
    expect(res.statusCode).toBe(500);
    expect(logError).toHaveBeenCalled();
  });

  it("500 path tolerates missing service.log", async () => {
    const search = vi.fn(async () => { throw new Error("es-down"); });
    serviceRegistry.getService.mockReturnValue({ db: { elastic: { search } } /* no log */ });
    const res = mkRes();
    await syncCategory({ body: { cat_id: "1" } }, res);
    expect(res.statusCode).toBe(500);
  });

  it("ES response with no hits.hits at any depth → || [] fallback (line 52)", async () => {
    // esResult.hits exists but its inner .hits is undefined → optional chain
    // returns undefined → the trailing `|| []` fallback fires.
    const search = vi.fn(async () => ({ hits: { /* no .hits property */ total: 0 } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await syncCategory({ body: { cat_id: "1" } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("categoryController > syncAllCategories", () => {
  it("503 when no service with elastic available", async () => {
    serviceRegistry.getService.mockReturnValue(null);
    const res = mkRes();
    await syncAllCategories({}, res);
    expect(res.statusCode).toBe(503);
  });

  it("200 with synced=0 when ES has no categories", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await syncAllCategories({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.synced).toBe(0);
  });

  it("404 when sdui_config doc missing", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: { category: "A", cat_id: 1 } }] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    getDB.mockResolvedValue({ collection: () => ({ findOne: async () => null, updateOne: vi.fn() }) });
    const res = mkRes();
    await syncAllCategories({}, res);
    expect(res.statusCode).toBe(404);
  });

  it("404 when filter missing in doc", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: { category: "A", cat_id: 1 } }] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    getDB.mockResolvedValue({ collection: () => ({ findOne: async () => ({ filters: [] }), updateOne: vi.fn() }) });
    const res = mkRes();
    await syncAllCategories({}, res);
    expect(res.statusCode).toBe(404);
  });

  it("200 re-syncs all categories, dedupes by cat_id (keep most subs), sorts alphabetically", async () => {
    const updateOne = vi.fn();
    const logInfo = vi.fn();
    const search = vi.fn(async () => ({ body: { hits: { hits: [
      { _source: { category: "Bravo", cat_id: 2, platforms: ["facebook"], subcategory: [{ sub_cat: "x", sub_cat_id: 1 }] } },
      // duplicate cat_id with FEWER subs — should be skipped
      { _source: { category: "Bravo", cat_id: 2, platforms: ["facebook"], subcategory: [] } },
      // duplicate cat_id with MORE subs — should win
      { _source: { category: "Bravo", cat_id: 2, platforms: ["facebook", "instagram"], subcategory: [{ sub_cat: "x", sub_cat_id: 1 }, { sub_cat: "y", sub_cat_id: 2 }] } },
      { _source: { category: "Alpha", cat_id: 1 } },
    ]}}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, log: { info: logInfo } }));
    getDB.mockResolvedValue({
      collection: () => ({
        findOne: async () => ({ filters: [{ _id: "categories" }] }),
        updateOne,
      }),
    });
    const res = mkRes();
    await syncAllCategories({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.synced).toBe(2);
    const updatedOptions = updateOne.mock.calls[0][1].$set["filters.0.options"];
    expect(updatedOptions[0].label).toBe("Alpha"); // sorted
    expect(updatedOptions[1].children.length).toBe(2); // most subs won
    expect(logInfo).toHaveBeenCalled();
  });

  it("500 on outer throw + log.error tolerates missing log", async () => {
    const search = vi.fn(async () => { throw new Error("e"); });
    serviceRegistry.getService.mockReturnValue({ db: { elastic: { search } } });
    const res = mkRes();
    await syncAllCategories({}, res);
    expect(res.statusCode).toBe(500);
  });
});

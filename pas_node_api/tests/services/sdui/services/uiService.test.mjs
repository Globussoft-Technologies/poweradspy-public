import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbPath = require.resolve("../../../../src/services/sdui/db");
const getDBSpy = vi.fn();
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB: getDBSpy },
};

function mockDB(elements) {
  return {
    collection(_name) {
      return {
        find: vi.fn(() => ({ toArray: vi.fn(async () => elements) })),
      };
    },
  };
}

let svc;
beforeEach(() => {
  getDBSpy.mockReset();
  const sutPath = require.resolve("../../../../src/services/sdui/services/uiService");
  delete require.cache[sutPath];
  svc = require("../../../../src/services/sdui/services/uiService");
});

describe("services/sdui/services/uiService > processHeaderElement", () => {
  it("search_dropdown → header.search_types", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "e1", section: "header", rank: 1,
        component: "search_dropdown",
        label_ui: "Keyword", unique_identifier: "kw",
        query_value: "kw_field", meta: "m", meta_type: "t",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.search_types).toHaveLength(1);
    expect(cfg.header.search_types[0].api_field).toBe("kw_field");
  });

  it("platform_button → header.platforms", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "e1", section: "header", rank: 1,
        component: "platform_button",
        label_ui: "Facebook", unique_identifier: "fb",
        selected_by_default: true, meta: "icon.svg", meta_type: "svg",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.platforms[0].selected_by_default).toBe(true);
  });

  it("sort_option → header.sorting", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "e1", section: "header", rank: 1,
        component: "sort_option",
        label_ui: "Newest", unique_identifier: "newest",
        default: true, query_sort: "createdAt:desc",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.sorting[0].query_sort).toBe("createdAt:desc");
  });

  it("feature_button → header.features", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "e1", section: "header", rank: 1,
        component: "feature_button",
        label_ui: "Bookmarks", unique_identifier: "bm",
        route: "/bookmarks", meta: "icon", meta_type: "img",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.features[0].route).toBe("/bookmarks");
  });

  it("search_config → header.search_config", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "e1", section: "header", rank: 1,
        component: "search_config",
        placeholder: "Search…", min_length: 2, max_length: 50,
        debounce_ms: 300, autosuggest: true,
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.search_config.placeholder).toBe("Search…");
  });

  it("brand_logo → header.brand", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "e1", section: "header", rank: 1,
        component: "brand_logo",
        label_ui: "PowerAdSpy", meta: "<svg/>", meta_type: "svg",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.brand.name).toBe("PowerAdSpy");
  });

  it("unknown header component is silently ignored (default switch path)", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      { _id: "e1", section: "header", rank: 1, component: "unknown_thing" },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.search_types).toHaveLength(0);
  });
});

describe("services/sdui/services/uiService > processSidebarElement", () => {
  it("filter_group → sidebar_filters entry", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "g1", section: "sidebar_filters", rank: 1,
        component: "filter_group",
        label_ui: "Country", unique_identifier: "country",
        collapsed_by_default: false,
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.sidebar_filters[0].unique_identifier).toBe("country");
    expect(cfg.sidebar_filters[0].filters).toEqual([]);
  });

  it("filter_option attached to matching group", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "g1", section: "sidebar_filters", rank: 1,
        component: "filter_group",
        label_ui: "Country", unique_identifier: "country",
      },
      {
        _id: "o1", section: "sidebar_filters", rank: 2,
        component: "filter_option",
        label_ui: "USA", unique_identifier: "usa", group_identifier: "country",
        query_value: "US",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.sidebar_filters[0].filters[0].query_value).toBe("US");
  });

  it("filter_option whose group_identifier matches nothing is dropped", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "o1", section: "sidebar_filters", rank: 1,
        component: "filter_option",
        label_ui: "Orphan", unique_identifier: "orphan",
        group_identifier: "missing_group",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.sidebar_filters).toEqual([]);
  });

  it("unknown sidebar component is silently ignored", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      { _id: "x", section: "sidebar_filters", rank: 1, component: "weird" },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.sidebar_filters).toEqual([]);
  });
});

describe("services/sdui/services/uiService > loadUIFromMongo", () => {
  it("elements in unknown sections are ignored", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      { _id: "x", section: "footer", rank: 1, component: "something" },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.search_types).toEqual([]);
    expect(cfg.sidebar_filters).toEqual([]);
  });

  it("sorts by section then rank (covers the section-comparator branches)", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      // Out of order: header(rank=2), header(rank=1), sidebar(rank=2), sidebar(rank=1)
      {
        _id: "h2", section: "header", rank: 2,
        component: "platform_button", label_ui: "P2", unique_identifier: "p2",
      },
      {
        _id: "s2", section: "sidebar_filters", rank: 2,
        component: "filter_group", label_ui: "S2", unique_identifier: "s2",
      },
      {
        _id: "h1", section: "header", rank: 1,
        component: "platform_button", label_ui: "P1", unique_identifier: "p1",
      },
      {
        _id: "s1", section: "sidebar_filters", rank: 1,
        component: "filter_group", label_ui: "S1", unique_identifier: "s1",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    expect(cfg.header.platforms.map(p => p.unique_identifier)).toEqual(["p1", "p2"]);
    expect(cfg.sidebar_filters.map(g => g.unique_identifier)).toEqual(["s1", "s2"]);
  });

  it("section comparator: 'header' < 'sidebar_filters' (a > b branch)", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      {
        _id: "s1", section: "sidebar_filters", rank: 1,
        component: "filter_group", label_ui: "S1", unique_identifier: "s1",
      },
      {
        _id: "h1", section: "header", rank: 1,
        component: "platform_button", label_ui: "P1", unique_identifier: "p1",
      },
    ]));
    const cfg = await svc.getUIConfiguration();
    // header processed before sidebar
    expect(cfg.header.platforms).toHaveLength(1);
    expect(cfg.sidebar_filters).toHaveLength(1);
  });
});

describe("services/sdui/services/uiService > getUIConfiguration cache", () => {
  it("caches the result — second call doesn't re-query mongo", async () => {
    getDBSpy.mockResolvedValue(mockDB([]));
    await svc.getUIConfiguration();
    await svc.getUIConfiguration();
    expect(getDBSpy).toHaveBeenCalledTimes(1);
  });
});

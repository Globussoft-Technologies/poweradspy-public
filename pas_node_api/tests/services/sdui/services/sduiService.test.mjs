import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock ../db
const dbPath = require.resolve("../../../../src/services/sdui/db");
const getDBSpy = vi.fn();
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB: getDBSpy },
};

// Mock seed/seedData (avoid pulling in the entire 521-line seed file)
const seedPath = require.resolve("../../../../src/services/sdui/seed/seedData");
const buildSDUIDocumentsSpy = vi.fn(() => [
  { _id: "seed-doc", config_type: "navbar", title: "from-seed" },
]);
require.cache[seedPath] = {
  id: seedPath, filename: seedPath, loaded: true,
  exports: { buildSDUIDocuments: buildSDUIDocumentsSpy },
};

// Mock DatabaseManager so AdMob live-option hydration can be exercised without
// hitting a real SQL/Elastic backend.
const dbManagerPath = require.resolve("../../../../src/database/DatabaseManager");
const getSQLSpy = vi.fn();
const getElasticSpy = vi.fn();
require.cache[dbManagerPath] = {
  id: dbManagerPath, filename: dbManagerPath, loaded: true,
  exports: {
    getSQL: getSQLSpy,
    getElastic: getElasticSpy,
  },
};

function mockDB(docs) {
  return {
    collection() {
      return {
        find: vi.fn(() => ({ toArray: vi.fn(async () => docs) })),
      };
    },
  };
}

function mockAdmobSql() {
  const query = vi.fn(async (sql) => {
    if (sql.includes("FROM mob_source_apps")) {
      return [
        { value: "Cricket App", doc_count: 7 },
        { value: "CREX", doc_count: 39 },
      ];
    }
    if (sql.includes("FROM mob_ad_sub_networks")) {
      return [{ value: "gdn", doc_count: 1 }];
    }
    if (sql.includes("SELECT MIN(source) AS value")) {
      return [{ value: "android", doc_count: 2 }];
    }
    if (sql.includes("SELECT MIN(ad_position) AS value")) {
      return [
        { value: "middle", doc_count: 1 },
        { value: "bottom", doc_count: 1 },
      ];
    }
    if (sql.includes("SELECT MIN(ad_sub_position) AS value")) {
      return [{ value: "bottom", doc_count: 1 }];
    }
    if (sql.includes("SELECT MIN(ad_image_size) AS value")) {
      return [{ value: "300*250", doc_count: 1 }];
    }
    return [];
  });

  getSQLSpy.mockReturnValue({ query });
  return query;
}

let svc;
beforeEach(() => {
  getDBSpy.mockReset();
  buildSDUIDocumentsSpy.mockClear();
  getSQLSpy.mockReset();
  getElasticSpy.mockReset();
  getSQLSpy.mockReturnValue(null);
  getElasticSpy.mockReturnValue(null);
  const sutPath = require.resolve("../../../../src/services/sdui/services/sduiService");
  delete require.cache[sutPath];
  svc = require("../../../../src/services/sdui/services/sduiService");
});

describe("services/sdui/services/sduiService > getSDUIConfig", () => {
  it("groups docs by config_type into searchbar/navbar/sidebar", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      { _id: "a", config_type: "searchbar" },
      { _id: "b", config_type: "navbar" },
      { _id: "c", config_type: "sidebar" },
      { _id: "d", config_type: "sidebar" },
    ]));
    const out = await svc.getSDUIConfig();
    expect(out.searchbar).toHaveLength(1);
    expect(out.navbar).toHaveLength(1);
    expect(out.sidebar).toHaveLength(2);
  });

  it("creates new buckets for unknown config_types", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      { _id: "x", config_type: "footer" },
    ]));
    const out = await svc.getSDUIConfig();
    expect(out.footer).toHaveLength(1);
  });

  it("docs without config_type are skipped", async () => {
    getDBSpy.mockResolvedValue(mockDB([
      { _id: "x" /* no config_type */ },
    ]));
    const out = await svc.getSDUIConfig();
    expect(out.searchbar).toEqual([]);
    expect(out.navbar).toEqual([]);
    expect(out.sidebar).toEqual([]);
  });

  it("falls back to buildSDUIDocuments when DB is empty", async () => {
    getDBSpy.mockResolvedValue(mockDB([]));
    const out = await svc.getSDUIConfig();
    expect(buildSDUIDocumentsSpy).toHaveBeenCalled();
    expect(out.navbar).toHaveLength(1);
    expect(out.navbar[0].title).toBe("from-seed");
  });

  it("falls back to buildSDUIDocuments when DB throws", async () => {
    getDBSpy.mockRejectedValue(new Error("conn-refused"));
    const out = await svc.getSDUIConfig();
    expect(buildSDUIDocumentsSpy).toHaveBeenCalled();
  });
});

describe("services/sdui/services/sduiService > filterConfigByPlatforms", () => {
  it("returns config unchanged when platforms is empty/missing", async () => {
    const config = { searchbar: [{}], navbar: [{}], sidebar: [{}] };
    expect(await svc.filterConfigByPlatforms(config, [])).toBe(config);
    expect(await svc.filterConfigByPlatforms(config, null)).toBe(config);
    expect(await svc.filterConfigByPlatforms(config, undefined)).toBe(config);
  });

  it("uses platforms doc matrix to whitelist sidebar IDs", async () => {
    const config = {
      navbar: [
        {
          _id: "platforms",
          filters: [{ platform_filter_matrix: { facebook: ["sb1", "sb2"], youtube: ["sb3"] } }],
        },
      ],
      sidebar: [
        { _id: "sb1" },
        { _id: "sb2" },
        { _id: "sb3" },
        { _id: "sb4" }, // not whitelisted for facebook or youtube
      ],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook", "youtube"]);
    expect(out.sidebar.map(d => d._id).sort()).toEqual(["sb1", "sb2", "sb3"]);
  });

  it("returns only the approved AdMob sidebar filters", async () => {
    mockAdmobSql();
    const makeFilter = (id, value) => ({
      _id: id,
      platform_applicability: ["google"],
      options: [{ value, platform_applicability: ["google"] }],
    });
    const config = {
      navbar: [{
          _id: "platforms",
          filters: [{ platform_filter_matrix: { admob: ["country", "source", "admob_network", "ad_position", "ad_sub_position", "image_size", "source_app"] } }],
      }],
      sidebar: [
        { _id: "country", filters: [makeFilter("country_filter", "India")] },
        { _id: "source", title: "TRAFFIC SOURCE", filters: [makeFilter("source_filter", "android")] },
        { _id: "ad_position", filters: [makeFilter("ad_position_filter", "TOP")] },
        { _id: "ad_sub_position", filters: [makeFilter("ad_sub_position_filter", "BOTTOM")] },
        { _id: "image_size", filters: [makeFilter("image_size_filter", "300*250")] },
        { _id: "source_app", filters: [makeFilter("source_app_filter", "Cricket App")] },
        { _id: "budget", filters: [makeFilter("budget_filter", "high")] },
      ],
    };

    const out = await svc.filterConfigByPlatforms(config, ["AdMob"]);
    expect(out.sidebar.map((doc) => doc._id)).toEqual([
      "country", "source", "ad_position", "ad_sub_position", "image_size", "source_app", "admob_network",
    ]);
    const source = out.sidebar.find((doc) => doc._id === "source");
    const network = out.sidebar.find((doc) => doc._id === "admob_network");
    expect(source.title).toBe("SOURCE");
    expect(source.filters.map((filter) => filter._id)).toEqual(["source_filter"]);
    expect(network.title).toBe("NETWORK");
    expect(network.filters[0].options[0].value).toBe("gdn");
  });

  it("hydrates AdMob sidebar data when admob is selected with another platform", async () => {
    mockAdmobSql();
    const config = {
      navbar: [{
        _id: "platforms",
        filters: [{
          platform_filter_matrix: {
            facebook: ["fb_doc"],
            admob: ["source_app"],
          },
        }],
      }],
      sidebar: [
        { _id: "fb_doc" },
        {
          _id: "source_app",
          title: "SOURCE APP",
          filters: [{
            _id: "source_app_filter",
            options: [],
          }],
        },
      ],
    };

    const out = await svc.filterConfigByPlatforms(config, ["facebook", "admob"]);
    expect(out.sidebar.map((doc) => doc._id).sort()).toEqual([
      "admob_network",
      "fb_doc",
      "source_app",
    ]);

    const sourceApp = out.sidebar.find((doc) => doc._id === "source_app");
    expect(sourceApp.filters[0].options.length).toBeGreaterThan(0);
  });

  it("uses AdMob live ad_position values without widening other platforms", async () => {
    mockAdmobSql();
    const config = {
      navbar: [{
        _id: "platforms",
        filters: [{
          platform_filter_matrix: {
            facebook: ["fb_doc", "ad_position"],
            admob: ["ad_position"],
          },
        }],
      }],
      sidebar: [
        { _id: "fb_doc" },
        {
          _id: "ad_position",
          title: "AD POSITION",
          filters: [{
            _id: "ad_position_filter",
            options: [
              { _id: "pos_feed", label: "News Feed", value: "FEED", platform_applicability: "all" },
              { _id: "pos_side", label: "Side Column", value: "SIDE", platform_applicability: "all" },
              { _id: "pos_video", label: "Video Feed", value: "VIDEOFEED", platform_applicability: ["facebook"] },
            ],
          }],
        },
      ],
    };

    const out = await svc.filterConfigByPlatforms(config, ["facebook", "admob"]);
    const adPosition = out.sidebar.find((doc) => doc._id === "ad_position");
    const values = adPosition.filters[0].options.map((option) => option.value);

    expect(values).toEqual(expect.arrayContaining(["middle", "bottom"]));
    expect(values).not.toEqual(expect.arrayContaining(["FEED", "SIDE", "VIDEOFEED"]));
    expect(values).not.toContain("instagram");
  });

  it("when matrix is empty, sidebar docs pass through unchanged", async () => {
    const config = {
      navbar: [{ _id: "platforms", filters: [{}] }],
      sidebar: [{ _id: "sb1" }, { _id: "sb2" }],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar).toHaveLength(2);
  });

  it("filters out filter entries whose platform_applicability doesn't match", async () => {
    const config = {
      sidebar: [
        {
          _id: "s1",
          filters: [
            { platform_applicability: ["facebook"], options: [{ id: "o1" }] }, // kept
            { platform_applicability: ["youtube"], options: [{ id: "o2" }] },  // dropped
            { platform_applicability: "all", options: [{ id: "o3" }] },        // kept (common)
            { /* no platform_applicability */ options: [{ id: "o4" }] },       // kept (common)
            { platform_applicability: "facebook", options: [{ id: "o5" }] },   // kept (scalar branch)
          ],
        },
      ],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    const optionIds = out.sidebar[0].filters.flatMap(f => f.options.map(o => o.id));
    expect(optionIds).toEqual(["o1", "o3", "o4", "o5"]);
  });

  it("drops a filter when filter-level applicability excludes the platform even if an option is all", async () => {
    const config = {
      navbar: [
        {
          _id: "platforms",
          filters: [{ _id: "platform_selector", platform_applicability: "all" }],
        },
        {
          _id: "ad_type",
          filters: [{
            _id: "ad_types",
            platform_applicability: ["facebook"],
            options: [
              { id: "o1", platform_applicability: "all" },
              { id: "o2", platform_applicability: ["facebook"] },
            ],
          }],
        },
      ],
    };

    const out = await svc.filterConfigByPlatforms(config, ["youtube"]);
    expect(out.navbar.find((doc) => doc._id === "ad_type")).toBeUndefined();
  });

  it("treats ['all'] as universal during platform filtering", async () => {
    const config = {
      navbar: [
        {
          _id: "sorting",
          filters: [{
            _id: "sort_by",
            options: [
              { id: "o1", platform_applicability: ["all"] },
              { id: "o2", platform_applicability: ["facebook"] },
            ],
          }],
        },
      ],
    };

    const out = await svc.filterConfigByPlatforms(config, ["google"]);
    expect(out.navbar[0].filters[0].options.map((o) => o.id)).toEqual(["o1"]);
  });

  it("filters options within a filter by platform_applicability", async () => {
    const config = {
      sidebar: [
        {
          _id: "s1",
          filters: [{
            platform_applicability: ["facebook"],
            options: [
              { id: "o1", platform_applicability: ["facebook"] }, // kept
              { id: "o2", platform_applicability: ["youtube"] },  // dropped
              { id: "o3" },                                        // kept (common)
            ],
          }],
        },
      ],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters[0].options.map(o => o.id)).toEqual(["o1", "o3"]);
  });

  it("filters nested children by platform_applicability", async () => {
    const config = {
      sidebar: [
        {
          _id: "s1",
          filters: [{
            options: [{
              id: "o1",
              children: [
                { id: "c1", platform_applicability: ["facebook"] }, // kept
                { id: "c2", platform_applicability: ["youtube"] },  // dropped
              ],
            }],
          }],
        },
      ],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters[0].options[0].children.map(c => c.id)).toEqual(["c1"]);
  });

  it("filter with no options key passes through unchanged", async () => {
    const config = {
      sidebar: [{ _id: "s1", filters: [{ /* no options */ id: "f1" }] }],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters[0].id).toBe("f1");
  });

  it("option with no children passes through unchanged", async () => {
    const config = {
      sidebar: [{
        _id: "s1",
        filters: [{
          options: [{ id: "o1" /* no children */ }],
        }],
      }],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters[0].options[0].id).toBe("o1");
  });

  it("drops filters whose options end up empty after filtering", async () => {
    const config = {
      sidebar: [{
        _id: "s1",
        filters: [
          {
            options: [{ platform_applicability: ["youtube"] }], // becomes empty
          },
          {
            options: [{ id: "o2", platform_applicability: ["facebook"] }], // kept
          },
        ],
      }],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters).toHaveLength(1);
  });

  it("drops docs whose filters end up empty after filtering", async () => {
    const config = {
      sidebar: [
        {
          _id: "s1",
          filters: [{
            options: [{ platform_applicability: ["youtube"] }],
          }],
        },
        { _id: "s2" /* no filters at all → kept */ },
      ],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar.map(d => d._id)).toEqual(["s2"]);
  });

  it("docs in non-sidebar types skip the allowedSidebarIds check", async () => {
    const config = {
      navbar: [
        { _id: "platforms", filters: [{ platform_filter_matrix: { facebook: ["sb1"] } }] },
        { _id: "other_navbar", title: "kept" },
      ],
      sidebar: [],
    };
    const out = await svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.navbar.find(d => d._id === "other_navbar")).toBeDefined();
  });
});

describe("services/sdui/services/sduiService > computeETag / computeVersion", () => {
  it("computeETag returns quoted md5 hex", () => {
    const tag = svc.computeETag("hello");
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("computeETag deterministic for same input", () => {
    expect(svc.computeETag("x")).toBe(svc.computeETag("x"));
  });

  it("computeVersion returns a positive number", () => {
    const v = svc.computeVersion("hello");
    expect(typeof v).toBe("number");
    expect(v).toBeGreaterThan(0);
  });

  it("computeVersion deterministic", () => {
    expect(svc.computeVersion("x")).toBe(svc.computeVersion("x"));
  });

  it("computeVersion different inputs differ", () => {
    expect(svc.computeVersion("a")).not.toBe(svc.computeVersion("b"));
  });

  // Line 137 (`if (version < 0) version = -version;`) is unreachable — JS's
  // readUInt32BE produces unsigned values so version is always ≥ 0. Tracked
  // at https://github.com/Globussoft-Technologies/poweradspy/issues/237
});

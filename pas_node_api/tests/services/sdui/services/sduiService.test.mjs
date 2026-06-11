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

function mockDB(docs) {
  return {
    collection() {
      return {
        find: vi.fn(() => ({ toArray: vi.fn(async () => docs) })),
      };
    },
  };
}

let svc;
beforeEach(() => {
  getDBSpy.mockReset();
  buildSDUIDocumentsSpy.mockClear();
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
  it("returns config unchanged when platforms is empty/missing", () => {
    const config = { searchbar: [{}], navbar: [{}], sidebar: [{}] };
    expect(svc.filterConfigByPlatforms(config, [])).toBe(config);
    expect(svc.filterConfigByPlatforms(config, null)).toBe(config);
    expect(svc.filterConfigByPlatforms(config, undefined)).toBe(config);
  });

  it("uses platforms doc matrix to whitelist sidebar IDs", () => {
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
    const out = svc.filterConfigByPlatforms(config, ["facebook", "youtube"]);
    expect(out.sidebar.map(d => d._id).sort()).toEqual(["sb1", "sb2", "sb3"]);
  });

  it("when matrix is empty, sidebar docs pass through unchanged", () => {
    const config = {
      navbar: [{ _id: "platforms", filters: [{}] }],
      sidebar: [{ _id: "sb1" }, { _id: "sb2" }],
    };
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar).toHaveLength(2);
  });

  it("filters out filter entries whose platform_applicability doesn't match", () => {
    const config = {
      sidebar: [
        {
          _id: "s1",
          filters: [
            { platform_applicability: ["facebook"], options: [{ id: "o1" }] }, // kept
            { platform_applicability: ["youtube"], options: [{ id: "o2" }] },  // dropped
            { platform_applicability: "all", options: [{ id: "o3" }] },        // kept (common)
            { /* no platform_applicability */ options: [{ id: "o4" }] },       // kept (common)
            { platform_applicability: "not-an-array", options: [{ id: "o5" }] },// kept (non-array branch)
          ],
        },
      ],
    };
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
    const optionIds = out.sidebar[0].filters.flatMap(f => f.options.map(o => o.id));
    expect(optionIds).toEqual(["o1", "o3", "o4", "o5"]);
  });

  it("filters options within a filter by platform_applicability", () => {
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
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters[0].options.map(o => o.id)).toEqual(["o1", "o3"]);
  });

  it("filters nested children by platform_applicability", () => {
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
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters[0].options[0].children.map(c => c.id)).toEqual(["c1"]);
  });

  it("filter with no options key passes through unchanged", () => {
    const config = {
      sidebar: [{ _id: "s1", filters: [{ /* no options */ id: "f1" }] }],
    };
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters[0].id).toBe("f1");
  });

  it("option with no children passes through unchanged", () => {
    const config = {
      sidebar: [{
        _id: "s1",
        filters: [{
          options: [{ id: "o1" /* no children */ }],
        }],
      }],
    };
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters[0].options[0].id).toBe("o1");
  });

  it("drops filters whose options end up empty after filtering", () => {
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
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar[0].filters).toHaveLength(1);
  });

  it("drops docs whose filters end up empty after filtering", () => {
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
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
    expect(out.sidebar.map(d => d._id)).toEqual(["s2"]);
  });

  it("docs in non-sidebar types skip the allowedSidebarIds check", () => {
    const config = {
      navbar: [
        { _id: "platforms", filters: [{ platform_filter_matrix: { facebook: ["sb1"] } }] },
        { _id: "other_navbar", title: "kept" },
      ],
      sidebar: [],
    };
    const out = svc.filterConfigByPlatforms(config, ["facebook"]);
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

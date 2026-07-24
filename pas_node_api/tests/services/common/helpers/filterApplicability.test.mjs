import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const sduiPath = require.resolve("../../../../src/services/sdui/services/sduiService");
const getSDUIConfig = vi.fn();
require.cache[sduiPath] = {
  id: sduiPath, filename: sduiPath, loaded: true,
  exports: { getSDUIConfig },
};

const sutPath = require.resolve("../../../../src/services/common/helpers/filterApplicability");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  getSDUIConfig.mockReset();
});

describe("filterApplicability > getApplicableNetworks (input shape)", () => {
  it("returns null for non-object input", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks(null)).toBeNull();
    expect(await getApplicableNetworks("string")).toBeNull();
  });

  it("returns null when no body keys are active filters", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ user_id: "u", network: "facebook" })).toBeNull();
  });

  it("inactive values (null, '', 'NA', empty array, all-NA array) skipped", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({
      gender: null, country: "", state: "NA", city: [], type: ["NA", ""],
      verified: false, google_transparency_ads: 0, another_toggle: "false",
      adcategory: undefined,
    })).toBeNull();
  });

  it("disabled Google Transparency toggle does not restrict a Facebook request", async () => {
    getSDUIConfig.mockResolvedValue({
      sidebar: [{
        filters: [{
          _id: "google_transparency_ads",
          query_param: "google_transparency_ads",
          platform_applicability: ["google"],
        }],
      }],
    });
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({
      network: ["facebook"],
      google_transparency_ads: false,
      google_transparency_subnetwork: "NA",
    })).toBeNull();
  });
});

describe("filterApplicability > static filter networks (no SDUI required)", () => {
  it("budget restricts to tiktok only", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ budget: "Low" })).toEqual(["tiktok"]);
  });

  it("adBudget restricts to facebook/instagram/youtube", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    const out = await getApplicableNetworks({ adBudget: [10, 100] });
    expect(out).toEqual(expect.arrayContaining(["facebook", "instagram", "youtube"]));
  });

  it("ad_position is in NON_FILTER_BODY_KEYS → ignored", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ ad_position: ["FEED"] })).toBeNull();
  });

  it("intersection of two static filters narrows further", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    // adBudget = [fb, ig, yt] ∩ domain_date_btn_sort = [fb, ig, yt, gdn, ...] (all but tiktok)
    // → [fb, ig, yt]
    const out = await getApplicableNetworks({ adBudget: [1, 100], domain_date_btn_sort: [1, 2] });
    expect(out).toEqual(expect.arrayContaining(["facebook", "instagram", "youtube"]));
    expect(out).not.toContain("tiktok");
  });

  it("conflicting filters whose intersection is empty → preserves more permissive set", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    // budget=tiktok, adBudget=[fb,ig,yt] → intersection empty → keep adBudget set
    const out = await getApplicableNetworks({ adBudget: [1, 2], budget: "Low" });
    expect(out).not.toContain("tiktok");
  });
});

describe("filterApplicability > SDUI-derived index", () => {
  it("filter with platform_applicability narrows via BODY_TO_SDUI_FILTER_IDS map", async () => {
    getSDUIConfig.mockResolvedValue({
      sidebar: [
        { filters: [
          { _id: "gender_filter", query_param: "gender", platform_applicability: ["Facebook"] },
        ]},
      ],
    });
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ gender: "m" })).toEqual(["facebook"]);
  });

  it("filter via query_param directly (not in BODY_TO_SDUI_FILTER_IDS)", async () => {
    getSDUIConfig.mockResolvedValue({
      sidebar: [
        { filters: [
          { _id: "custom_filter", query_param: "custom_field", platform_applicability: ["instagram"] },
        ]},
      ],
    });
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ custom_field: "x" })).toEqual(["instagram"]);
  });

  it("query_param that's in NON_FILTER_BODY_KEYS is not added", async () => {
    getSDUIConfig.mockResolvedValue({
      sidebar: [
        { filters: [
          { _id: "platform_filter", query_param: "platform", platform_applicability: ["facebook"] },
        ]},
      ],
    });
    const { getApplicableNetworks } = freshSut();
    // platform is in NON_FILTER_BODY_KEYS so it's ignored — no restriction
    expect(await getApplicableNetworks({ platform: "facebook" })).toBeNull();
  });

  it("no platform_applicability → defaults to ALL_NETWORKS (no restriction)", async () => {
    getSDUIConfig.mockResolvedValue({
      sidebar: [
        { filters: [
          { _id: "gender_filter", query_param: "gender" /* no platform_applicability */ },
        ]},
      ],
    });
    const { getApplicableNetworks } = freshSut();
    // bodyKey gets ALL_NETWORKS → length >= ALL_NETWORKS.length → skipped
    expect(await getApplicableNetworks({ gender: "m" })).toBeNull();
  });

  it("platform_applicability = empty array treated as 'all'", async () => {
    getSDUIConfig.mockResolvedValue({
      sidebar: [
        { filters: [
          { _id: "gender_filter", query_param: "gender", platform_applicability: [] },
        ]},
      ],
    });
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ gender: "m" })).toBeNull();
  });

  it("two SDUI filters mapping to same body key → union (more permissive)", async () => {
    getSDUIConfig.mockResolvedValue({
      sidebar: [
        { filters: [
          { _id: "gender_filter", query_param: "g1", platform_applicability: ["Facebook"] },
          { _id: "gender_selector", query_param: "g2", platform_applicability: ["Instagram"] },
        ]},
      ],
    });
    const { getApplicableNetworks } = freshSut();
    const out = await getApplicableNetworks({ gender: "m" });
    expect(out).toEqual(expect.arrayContaining(["facebook", "instagram"]));
  });

  it("section without docs (non-array) skipped", async () => {
    getSDUIConfig.mockResolvedValue({ sidebar: null, navbar: "not-array" });
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ gender: "m" })).toBeNull();
  });

  it("doc without filters array treated as empty", async () => {
    getSDUIConfig.mockResolvedValue({ sidebar: [{}] });
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ gender: "m" })).toBeNull();
  });
});

describe("filterApplicability > cache + error handling", () => {
  it("cache reused within TTL", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks } = freshSut();
    await getApplicableNetworks({ user_id: "u" });
    await getApplicableNetworks({ user_id: "u" });
    expect(getSDUIConfig).toHaveBeenCalledTimes(1);
  });

  it("getSDUIConfig throws on first call → cache stays empty (fail open)", async () => {
    getSDUIConfig.mockRejectedValue(new Error("sdui-down"));
    const { getApplicableNetworks } = freshSut();
    expect(await getApplicableNetworks({ gender: "m" })).toBeNull();
  });

  it("getSDUIConfig throws after successful cache → previous cache preserved", async () => {
    getSDUIConfig.mockResolvedValueOnce({});
    const { getApplicableNetworks, clearCache } = freshSut();
    await getApplicableNetworks({ user_id: "u" });
    // Force cache invalidation but service now fails
    clearCache();
    getSDUIConfig.mockRejectedValueOnce(new Error("sdui-down"));
    expect(await getApplicableNetworks({ gender: "m" })).toBeNull();
  });

  it("clearCache forces refresh", async () => {
    getSDUIConfig.mockResolvedValue({});
    const { getApplicableNetworks, clearCache } = freshSut();
    await getApplicableNetworks({ user_id: "u" });
    clearCache();
    await getApplicableNetworks({ user_id: "u" });
    expect(getSDUIConfig).toHaveBeenCalledTimes(2);
  });
});

describe("filterApplicability > ALL_NETWORKS export", () => {
  it("includes all 11 networks", () => {
    const { ALL_NETWORKS } = freshSut();
    expect(ALL_NETWORKS).toHaveLength(11);
    expect(ALL_NETWORKS).toContain("facebook");
    expect(ALL_NETWORKS).toContain("tiktok");
  });
});

describe("filterApplicability > defensive edge cases", () => {
  it("config null → Object.values(config || {}) falls back to {} (line 114 binary-expr right operand)", async () => {
    getSDUIConfig.mockResolvedValue(null);
    const { getApplicableNetworks } = freshSut();
    // null config → empty {} → no filters → returns null (no restriction)
    expect(await getApplicableNetworks({ gender: "m" })).toBeNull();
  });

  it("two SDUI filters mapping to the same body key → union via line 145 else-if branch", async () => {
    // gender has the BODY_TO_SDUI_FILTER_IDS entry, so multiple SDUI filters
    // can map to bodyKey="gender". First filter restricts to facebook,
    // second to instagram → index['gender'] starts as Set(['facebook'])
    // then else-if at line 145 unions in 'instagram'.
    getSDUIConfig.mockResolvedValue({
      sidebar: [
        { filters: [
          { _id: "gender_filter", query_param: "gender", platform_applicability: ["facebook"] },
          { _id: "gender_filter", query_param: "gender", platform_applicability: ["instagram"] },
        ]},
      ],
    });
    const { getApplicableNetworks } = freshSut();
    const result = await getApplicableNetworks({ gender: "m" });
    expect(result).toEqual(expect.arrayContaining(["facebook", "instagram"]));
    expect(result).toHaveLength(2);
  });

  it("second filter for same body key with no applicability → networks=null falsy branch (line 145 falsy)", async () => {
    // First filter restricts to facebook; second has no platform_applicability
    // (networks=null) → enters else-if at line 145, then the inner `networks`
    // check is FALSY so we don't add anything. Hits the falsy branch.
    getSDUIConfig.mockResolvedValue({
      sidebar: [
        { filters: [
          { _id: "gender_filter", query_param: "gender", platform_applicability: ["facebook"] },
          { _id: "gender_filter", query_param: "gender" /* no applicability */ },
        ]},
      ],
    });
    const { getApplicableNetworks } = freshSut();
    const result = await getApplicableNetworks({ gender: "m" });
    // First filter set the index entry to ['facebook'] and the second's
    // null-networks didn't union anything new.
    expect(result).toEqual(["facebook"]);
  });

  it("rebuild throws after first successful build → keeps stale _cached (line 172 falsy)", async () => {
    // First call populates _cached. Manually expire the TTL and make the
    // second build throw → catch block's `if (!_cached)` is FALSY because
    // _cached is still set from the previous success → falls through and
    // returns the stale cache.
    getSDUIConfig.mockResolvedValueOnce({});
    const { getApplicableNetworks } = freshSut();
    // First call — succeeds, populates _cached = {}
    await getApplicableNetworks({ user_id: "u" });
    // Second call — TTL still valid so it returns the cached value directly.
    // To force a rebuild we need to wait past the TTL, but since CACHE_TTL_MS
    // is module-scoped we can't easily mock it. Instead, simulate by calling
    // again after vi.setSystemTime jump.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000); // 10 min in the future
    getSDUIConfig.mockRejectedValueOnce(new Error("sdui-fail"));
    const out = await getApplicableNetworks({ gender: "m" });
    // Even though the rebuild threw, _cached was preserved so we get no-restriction
    expect(out).toBeNull();
    vi.useRealTimers();
  });
});

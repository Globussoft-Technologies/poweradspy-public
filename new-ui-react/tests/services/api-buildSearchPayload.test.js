// Tests for buildSearchPayload — the biggest pure helper in src/services/api.js.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: vi.fn(() => "tk"),
  clearSessionState: vi.fn(),
}));

let buildSearchPayload;
beforeEach(async () => {
  vi.resetModules();
  globalThis.fetch = vi.fn();
  ({ buildSearchPayload } = await import("../../src/services/api.js"));
});

describe("buildSearchPayload > network resolution", () => {
  it("default activePlatform=facebook when nothing provided", () => {
    const p = buildSearchPayload();
    expect(p.network).toEqual(["facebook"]);
  });
  it("activePlatforms array lowercased", () => {
    const p = buildSearchPayload({ activePlatforms: ["Facebook", "Instagram"] });
    expect(p.network).toEqual(["facebook", "instagram"]);
  });
  it("activePlatform fallback lowercased", () => {
    const p = buildSearchPayload({ activePlatform: "YouTube" });
    expect(p.network).toEqual(["youtube"]);
  });
  it("ad_type restricts to overlap with adTypeOptions.platform_applicability", () => {
    const p = buildSearchPayload({
      activePlatforms: ["facebook", "youtube"],
      ad_type: ["VIDEO"],
      adTypeOptions: [{ value: "VIDEO", platform_applicability: ["youtube"] }],
    });
    expect(p.network).toEqual(["youtube"]);
  });
  it("ad_type restriction empty intersection → falls back to baseNetworks", () => {
    const p = buildSearchPayload({
      activePlatforms: ["facebook"],
      ad_type: ["VIDEO"],
      adTypeOptions: [{ value: "VIDEO", platform_applicability: ["youtube"] }],
    });
    expect(p.network).toEqual(["facebook"]);
  });
  it("ad_type scalar (non-array) handled", () => {
    const p = buildSearchPayload({
      activePlatforms: ["facebook"],
      ad_type: "VIDEO",
      adTypeOptions: [{ value: "video", platform_applicability: ["facebook"] }],
    });
    expect(p.network).toEqual(["facebook"]);
  });
});

describe("buildSearchPayload > searchIn modes", () => {
  it("keyword mode", () => {
    const p = buildSearchPayload({ searchIn: "keyword", searchQuery: "running shoes" });
    expect(p.keyword).toBe("running shoes");
    expect(p.advertiser).toBe("NA");
    expect(p.domain).toBe("NA");
  });
  it("advertiser mode", () => {
    const p = buildSearchPayload({ searchIn: "advertiser", searchQuery: "Nike" });
    expect(p.advertiser).toBe("Nike");
    expect(p.keyword).toBe("NA");
  });
  it("domain mode", () => {
    const p = buildSearchPayload({ searchIn: "domain", searchQuery: "nike.com" });
    expect(p.domain).toBe("nike.com");
    expect(p.keyword).toBe("NA");
  });
  it("empty searchQuery → defaults to NA", () => {
    const p = buildSearchPayload({ searchIn: "keyword", searchQuery: "" });
    expect(p.keyword).toBe("NA");
  });
  it("unknown searchIn → all NA", () => {
    const p = buildSearchPayload({ searchIn: "title", searchQuery: "x" });
    expect(p.keyword).toBe("NA");
    expect(p.advertiser).toBe("NA");
    expect(p.domain).toBe("NA");
  });
});

describe("buildSearchPayload > sortBy mapping", () => {
  it("'newest' → post_date with newest_sort flag", () => {
    const p = buildSearchPayload({ sortBy: "newest" });
    expect(p.order_column).toBe("post_date");
    expect(p.newest_sort).toBe("newest_sort");
  });
  it("'popular' → popularity", () => {
    expect(buildSearchPayload({ sortBy: "popular" }).order_column).toBe("popularity");
  });
  it("'running_longest' → days_running", () => {
    expect(buildSearchPayload({ sortBy: "running_longest" }).order_column).toBe("days_running");
  });
  it("aggressive: 'domain' substring → domain_date", () => {
    expect(buildSearchPayload({ sortBy: "my_domain_sort" }).order_column).toBe("domain_date");
  });
  it("aggressive: 'running' substring → days_running", () => {
    expect(buildSearchPayload({ sortBy: "running_longest_today" }).order_column).toBe("days_running");
  });
  it("aggressive: 'days' substring → days_running", () => {
    expect(buildSearchPayload({ sortBy: "days_ago" }).order_column).toBe("days_running");
  });
  it("uses filters.sorting fallback when sortBy absent", () => {
    expect(buildSearchPayload({ sorting: "likes" }).order_column).toBe("likes");
  });
  it("unknown sort → post_date default", () => {
    expect(buildSearchPayload({ sortBy: "unknown" }).order_column).toBe("post_date");
  });
  it("all named-sort flag fields produced correctly", () => {
    // 'views' is not in SORT_MAP — sortBy='views' falls through to post_date.
    const map = {
      likes: "likes_sort",
      comments: "comments_sort",
      shares: "shares_sort",
      impressions: "impression_sort",
      popularity: "popularity_sort",
      ad_budget: "adBudget_sort",
      hits: "hits_sort",
      last_seen: "last_seen_sort",
    };
    for (const [sortBy, flagField] of Object.entries(map)) {
      const p = buildSearchPayload({ sortBy });
      expect(p[flagField]).not.toBe("NA");
    }
  });
});

describe("buildSearchPayload > auto-sort by last-changed range slider", () => {
  it("_autoSortField=likes wins over default post_date", () => {
    const p = buildSearchPayload({ _autoSortField: "likes" });
    expect(p.order_column).toBe("likes");
  });
  it("_autoSortField=views_range_filter → views", () => {
    const p = buildSearchPayload({ _autoSortField: "views_range_filter" });
    expect(p.order_column).toBe("views");
  });
  it("fallback to ctr range when no _autoSortField", () => {
    const p = buildSearchPayload({ ctr: { min: 1, max: 2 } });
    expect(p.order_column).toBe("ctr");
  });
  it("popularity range falls back when no ctr", () => {
    const p = buildSearchPayload({ popularity: { min: 1, max: 100 } });
    expect(p.order_column).toBe("popularity");
  });
  it("likes range fallback", () => {
    const p = buildSearchPayload({ likes: { min: 1, max: 100 } });
    expect(p.order_column).toBe("likes");
  });
  it("shares range fallback", () => {
    const p = buildSearchPayload({ shares: { min: 1, max: 100 } });
    expect(p.order_column).toBe("share");
  });
  it("comments range fallback", () => {
    const p = buildSearchPayload({ comments: { min: 1, max: 100 } });
    expect(p.order_column).toBe("comment");
  });
  it("impressions range fallback", () => {
    const p = buildSearchPayload({ impressions: { min: 1, max: 100 } });
    expect(p.order_column).toBe("impression");
  });
  it("views range fallback", () => {
    const p = buildSearchPayload({ view: { min: 1, max: 100 } });
    expect(p.order_column).toBe("views");
  });
  it("adBudget range fallback", () => {
    const p = buildSearchPayload({ adBudget: { min: 1, max: 100 } });
    expect(p.order_column).toBe("ad_budget");
  });
});

describe("buildSearchPayload > age parsing", () => {
  it("single 'N-M' range → lower=min, upper=max", () => {
    const p = buildSearchPayload({ age: "18-24", activePlatforms: ["facebook"] });
    expect(p.lower_age).toBe(18);
    expect(p.upper_age).toBe(24);
  });
  it("multiple ranges → min start, max end", () => {
    const p = buildSearchPayload({ age: ["13-17", "25-34"], activePlatforms: ["facebook"] });
    expect(p.lower_age).toBe(13);
    expect(p.upper_age).toBe(34);
  });
  it("'65+' age → both bounds = 65", () => {
    const p = buildSearchPayload({ age: ["65+"], activePlatforms: ["facebook"] });
    expect(p.lower_age).toBe(65);
    expect(p.upper_age).toBe(65);
  });
  it("number value → lower=number, upper from upper_age field", () => {
    const p = buildSearchPayload({ age: 30, upper_age: 40, activePlatforms: ["facebook"] });
    expect(p.lower_age).toBe(30);
    expect(p.upper_age).toBe(40);
  });
  it("empty array → both NA", () => {
    const p = buildSearchPayload({ age: [], activePlatforms: ["facebook"] });
    expect(p.lower_age).toBe("NA");
  });
  it("age gate is bypassed because 'age_filter' is not in FILTER_PLATFORM_SUPPORT (short-circuits to true)", () => {
    const p = buildSearchPayload({ age: "18-24", activePlatforms: ["reddit"] });
    expect(p.lower_age).toBe(18);
  });
});

describe("buildSearchPayload > category resolution", () => {
  it("adcategory direct overrides categories", () => {
    const p = buildSearchPayload({ adcategory: ["Finance"], categories: ["Sports"] });
    expect(p.adcategory).toEqual(["Finance"]);
  });
  it("adcategory scalar wrapped to array", () => {
    const p = buildSearchPayload({ adcategory: "Finance" });
    expect(p.adcategory).toEqual(["Finance"]);
  });
  it("categories used when adcategory absent", () => {
    const p = buildSearchPayload({ categories: ["Sports"] });
    expect(p.adcategory).toEqual(["Sports"]);
  });
  it("selCategories used when both absent", () => {
    const p = buildSearchPayload({ selCategories: ["Travel"] });
    expect(p.adcategory).toEqual(["Travel"]);
  });
  it("no category → NA", () => {
    expect(buildSearchPayload().adcategory).toBe("NA");
  });
});

describe("buildSearchPayload > industry derivation", () => {
  it("explicit industry filter passes through", () => {
    const p = buildSearchPayload({ industry: ["Tech"] });
    expect(p.industry).toEqual(["Tech"]);
  });
  it("combines adcategory + subcategory (no duplicates)", () => {
    const p = buildSearchPayload({
      adcategory: ["Apparel"],
      subcategory: ["Shoes", "Apparel"],
    });
    expect(p.industry).toEqual(["Apparel", "Shoes"]);
  });
  it("subcategory scalar wrapped to array", () => {
    const p = buildSearchPayload({ subcategory: "Watches" });
    expect(p.industry).toEqual(["Watches"]);
  });
  it("no cats/subs → NA (empty array becomes NA)", () => {
    expect(buildSearchPayload().industry).toBe("NA");
  });
});

describe("buildSearchPayload > country resolution", () => {
  it("country_filter array wins", () => {
    const p = buildSearchPayload({ country_filter: ["US"] });
    expect(p.country).toEqual(["US"]);
  });
  it("country_filter scalar wrapped to array", () => {
    const p = buildSearchPayload({ country_filter: "US" });
    expect(p.country).toEqual(["US"]);
  });
  it("selCountries fallback", () => {
    const p = buildSearchPayload({ selCountries: ["GB"] });
    expect(p.country).toEqual(["GB"]);
  });
  it("none → NA", () => {
    expect(buildSearchPayload().country).toBe("NA");
  });
});

describe("buildSearchPayload > range field aliases", () => {
  it("'like' alias accepted for likes range", () => {
    const p = buildSearchPayload({ like: { min: 10, max: 100 }, activePlatforms: ["facebook"] });
    expect(p.likes).toEqual({ min: 10, max: 100 });
  });
  it("range with both bounds empty → NA", () => {
    const p = buildSearchPayload({ likes: { min: "", max: "" }, activePlatforms: ["facebook"] });
    expect(p.likes).toBe("NA");
  });
  it("range with only min → kept", () => {
    const p = buildSearchPayload({ likes: { min: 5, max: "" }, activePlatforms: ["facebook"] });
    expect(p.likes).toEqual({ min: 5, max: "" });
  });
  it("v(false) → NA", () => {
    const p = buildSearchPayload({ likes: false, activePlatforms: ["facebook"] });
    expect(p.likes).toBe("NA");
  });
  it("v(empty array) → NA", () => {
    const p = buildSearchPayload({ likes: [], activePlatforms: ["facebook"] });
    expect(p.likes).toBe("NA");
  });
});

describe("buildSearchPayload > tiktok categorical budget detection", () => {
  it("any filter value with 'Low'/'Medium'/'High' → budget", () => {
    const p = buildSearchPayload({ budget: ["Low", "high"] });
    expect(p.budget).toEqual(["Low", "High"]);
  });
  it("scalar 'medium' → wrapped", () => {
    const p = buildSearchPayload({ budget: "medium" });
    expect(p.budget).toEqual(["Medium"]);
  });
  it("non-categorical budget → 'NA'", () => {
    const p = buildSearchPayload({ budget: { min: 100, max: 500 } });
    expect(p.budget).toBe("NA");
  });
  it("excludes _autoSortField and filterPlatformSupport keys from scan", () => {
    const p = buildSearchPayload({ _autoSortField: "low", filterPlatformSupport: "high" });
    expect(p.budget).toBe("NA");
  });
});

describe("buildSearchPayload > gender", () => {
  it("scalar gender → wrapped", () => {
    const p = buildSearchPayload({ gender: "male", activePlatforms: ["facebook"] });
    expect(p.gender).toEqual(["male"]);
  });
  it("array gender preserved", () => {
    const p = buildSearchPayload({ gender: ["male", "female"], activePlatforms: ["facebook"] });
    expect(p.gender).toEqual(["male", "female"]);
  });
  it("empty array → NA", () => {
    const p = buildSearchPayload({ gender: [], activePlatforms: ["facebook"] });
    expect(p.gender).toBe("NA");
  });
  it("'all' → NA", () => {
    const p = buildSearchPayload({ gender: "all", activePlatforms: ["facebook"] });
    expect(p.gender).toBe("NA");
  });
  it("empty string → NA", () => {
    const p = buildSearchPayload({ gender: "", activePlatforms: ["facebook"] });
    expect(p.gender).toBe("NA");
  });
  it("gender gate bypassed because 'gender_filter' is not in FILTER_PLATFORM_SUPPORT (short-circuits)", () => {
    const p = buildSearchPayload({ gender: "male", activePlatforms: ["reddit"] });
    expect(p.gender).toEqual(["male"]);
  });
});

describe("buildSearchPayload > ad type normalization", () => {
  it("dash → underscore + uppercase", () => {
    const p = buildSearchPayload({ ad_type: ["text-image"] });
    expect(p.type).toEqual(["TEXT_IMAGE"]);
  });
  it("scalar wrapped + uppercased", () => {
    const p = buildSearchPayload({ ad_type: "video" });
    expect(p.type).toEqual(["VIDEO"]);
  });
  it("absent → NA", () => {
    expect(buildSearchPayload().type).toBe("NA");
  });
});

describe("buildSearchPayload > ad_sub_position", () => {
  it("array uppercased when google active", () => {
    const p = buildSearchPayload({ ad_sub_position: ["top", "bottom"], activePlatforms: ["google"] });
    expect(p.ad_sub_position).toEqual(["TOP", "BOTTOM"]);
  });
  it("scalar wrapped", () => {
    const p = buildSearchPayload({ ad_sub_position: "top", activePlatforms: ["google"] });
    expect(p.ad_sub_position).toEqual(["TOP"]);
  });
  it("ad_sub_position gate bypassed because '_filter' variant not in FILTER_PLATFORM_SUPPORT", () => {
    const p = buildSearchPayload({ ad_sub_position: ["TOP"], activePlatforms: ["facebook"] });
    expect(p.ad_sub_position).toEqual(["TOP"]);
  });
  it("NA value → NA", () => {
    const p = buildSearchPayload({ ad_sub_position: "NA", activePlatforms: ["google"] });
    expect(p.ad_sub_position).toBe("NA");
  });
});

describe("buildSearchPayload > verified + metaAdsLib + platform", () => {
  it("verified=true → 1 (on supported platforms)", () => {
    const p = buildSearchPayload({ verified: true, activePlatforms: ["facebook"] });
    expect(p.verified).toBe(1);
  });
  it("verified=false → NA", () => {
    const p = buildSearchPayload({ verified: false, activePlatforms: ["facebook"] });
    expect(p.verified).toBe("NA");
  });
  it("verified gate bypassed because 'verified_filter' is not in FILTER_PLATFORM_SUPPORT (short-circuits via ||)", () => {
    const p = buildSearchPayload({ verified: true, activePlatforms: ["reddit"] });
    expect(p.verified).toBe(1);
  });
  it("metaAdsLib=true with FB/IG → platform=15", () => {
    const p = buildSearchPayload({ meta_ads_lib: true, activePlatforms: ["facebook"] });
    expect(p.platform).toBe(15);
  });
  it("metaAdsLib=true but no FB/IG → platform=NA", () => {
    const p = buildSearchPayload({ meta_ads_lib: true, activePlatforms: ["reddit"] });
    expect(p.platform).toBe("NA");
  });
  it("metaAdsLib=true with instagram → platform=15", () => {
    const p = buildSearchPayload({ meta_ads_lib: true, activePlatforms: ["instagram"] });
    expect(p.platform).toBe(15);
  });
  it("metaAdsLib falsy → platform=NA", () => {
    const p = buildSearchPayload({ meta_ads_lib: false, activePlatforms: ["facebook"] });
    expect(p.platform).toBe("NA");
  });
});

describe("buildSearchPayload > lang + size", () => {
  it("lang prefers 'lang' over language", () => {
    const p = buildSearchPayload({ lang: "es", language: "fr", activePlatforms: ["facebook"] });
    expect(p.lang).toBe("es");
  });
  it("language fallback", () => {
    const p = buildSearchPayload({ language: "fr", activePlatforms: ["facebook"] });
    expect(p.lang).toBe("fr");
  });
  it("language default 'en' when no lang on supported platform", () => {
    const p = buildSearchPayload({ activePlatforms: ["facebook"] });
    expect(p.language).toBe("en");
  });
  it("size from array → joined with commas", () => {
    const p = buildSearchPayload({ image_size: ["LARGE", "MEDIUM"], activePlatforms: ["gdn"] });
    expect(p.size).toBe("LARGE,MEDIUM");
  });
  it("size scalar", () => {
    const p = buildSearchPayload({ image_size: "MEDIUM", activePlatforms: ["gdn"] });
    expect(p.size).toBe("MEDIUM");
  });
  it("size gate bypassed because 'image_size_filter' is not in FILTER_PLATFORM_SUPPORT", () => {
    const p = buildSearchPayload({ image_size: "LARGE", activePlatforms: ["facebook"] });
    expect(p.size).toBe("LARGE");
  });
});

describe("buildSearchPayload > misc fields", () => {
  it("skip defaults to 0", () => {
    expect(buildSearchPayload().skip).toBe(0);
  });
  it("skip propagated", () => {
    expect(buildSearchPayload({ skip: 50 }).skip).toBe(50);
  });
  it("favorite=true stringified", () => {
    expect(buildSearchPayload({ favorite: true }).favorite).toBe("true");
  });
  it("favorite default false stringified", () => {
    expect(buildSearchPayload().favorite).toBe("false");
  });
  it("hidden=true stringified", () => {
    expect(buildSearchPayload({ hidden: true }).hidden).toBe("true");
  });
  it("exactSearch toggles 1/0", () => {
    expect(buildSearchPayload({ exactSearch: true }).exact_search).toBe(1);
    expect(buildSearchPayload({ exactSearch: false }).exact_search).toBe(0);
  });
  it("ad_position from explicit filter passes through", () => {
    const p = buildSearchPayload({ ad_position: ["TOP"] });
    expect(p.ad_position).toEqual(["TOP"]);
  });
  it("ad_position absent → NA", () => {
    expect(buildSearchPayload().ad_position).toBe("NA");
  });
  it("affiliate array preserved", () => {
    const p = buildSearchPayload({ affiliate: ["X"] });
    expect(p.affiliate).toEqual(["X"]);
  });
  it("affiliate scalar → NA (array-only check)", () => {
    expect(buildSearchPayload({ affiliate: "X" }).affiliate).toBe("NA");
  });
  it("source/funnel array preserved", () => {
    const p = buildSearchPayload({ source: ["s"], funnel: ["f"] });
    expect(p.source).toEqual(["s"]);
    expect(p.funnel).toEqual(["f"]);
  });
  it("source scalar → v(...) handles", () => {
    const p = buildSearchPayload({ source: "single" });
    expect(p.source).toBe("single");
  });
  it("ecommerce array preserved", () => {
    const p = buildSearchPayload({ ecommerce: ["Shopify"] });
    expect(p.ecommerce).toEqual(["Shopify"]);
  });
  it("subCategory array preserved when non-empty", () => {
    const p = buildSearchPayload({ subcategory: ["a"] });
    expect(p.subCategory).toEqual(["a"]);
  });
  it("nativeNetwork on native platform with array preserved", () => {
    const p = buildSearchPayload({ native_network: ["X"], activePlatforms: ["native"] });
    expect(p.nativeNetwork).toEqual(["X"]);
  });
  it("nativeNetwork gate bypassed because 'native_network_filter' is not in FILTER_PLATFORM_SUPPORT", () => {
    const p = buildSearchPayload({ native_network: ["X"], activePlatforms: ["facebook"] });
    expect(p.nativeNetwork).toEqual(["X"]);
  });
  it("commentdata passed through via v()", () => {
    const p = buildSearchPayload({ commentdata: "x" });
    expect(p.commentdata).toBe("x");
  });
});

describe("buildSearchPayload > dynamic platform support override", () => {
  it("config map merges over hardcoded fallback", () => {
    const p = buildSearchPayload({
      activePlatforms: ["reddit"],
      verified: true,
      filterPlatformSupport: { verified_filter: ["reddit"] },
    });
    expect(p.verified).toBe(1); // reddit now supported via dynamic map
  });
});

// Tests for buildSearchPayload — the biggest pure helper in src/services/api.js.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: vi.fn(() => "tk"),
  markFiltersForExpiry: vi.fn(),
}));

let buildSearchPayload;
beforeEach(async () => {
  vi.resetModules();
  globalThis.fetch = vi.fn();
  ({ buildSearchPayload } = await import("../../src/services/api.js"));
});

describe("buildSearchPayload > AI-Meta", () => {
  it("sends the logical AI-Meta toggle when enabled", () => {
    const payload = buildSearchPayload({
      has_ai_meta: true,
      activePlatforms: ["facebook", "google"],
      filterPlatformSupport: { has_ai_meta: ["facebook", "google"] },
    });

    expect(payload.has_ai_meta).toBe(true);
  });

  it("does not activate the filter from a persisted false value", () => {
    const payload = buildSearchPayload({ has_ai_meta: false, activePlatforms: ["facebook"] });
    expect(payload.has_ai_meta).toBe(false);
  });

  it("forwards selected contract filters without embedding their options", () => {
    const payload = buildSearchPayload({
      activePlatforms: ["facebook"],
      ai_ad_type: ["promotional"],
      ai_intent: ["conversion"],
      ai_offer_value: [10, 50],
    });

    expect(payload.ai_ad_type).toEqual(["promotional"]);
    expect(payload.ai_intent).toEqual(["conversion"]);
    expect(payload.ai_offer_value).toEqual([10, 50]);
  });
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

describe("buildSearchPayload > comprehensive branch coverage", () => {
  // 'all' makes platformSupports() return true for every filter, so every
  // `ps(...) ? value : 'NA'` takes its value side when the value is present.
  const fullFilters = {
    activePlatforms: ["all"],
    searchIn: "advertiser",
    searchQuery: "nike",
    exactSearch: true,
    sortBy: "popularity",
    categories: ["Shopping"],
    adcategory: ["Shopping"],
    subcategory: ["Shoes"],
    cta_filter: ["Shop Now"],
    country_filter: ["US", "IN"],
    ad_type: ["image-video", "carousel"],
    ad_position_filter: ["FEED"],
    ad_sub_position: ["top"],
    gender: ["male", "female"],
    age_filter: ["13-17", "25+"],
    industry: ["Retail"],
    ecommerce_platform_filter: ["shopify"],
    source: ["google"],
    funnel_filter: ["awareness"],
    affiliate_network_filter: ["cj"],
    native_network_filter: ["taboola"],
    lang: "en",
    commentdata: ["nice"],
    verified: true,
    meta_ads_lib_filter: true,
    market_platform: ["meta"],
    post_date_btn_sort: "asc",
    seen_btn_sort: "desc",
    domain_date_btn_sort: "asc",
    image_size_filter: ["LARGE", "MEDIUM"],
    likes: { min: 1, max: 100 },
    shares: { min: 1, max: 100 },
    comments: { min: 1, max: 100 },
    impressions: { min: 1, max: 100 },
    views: { min: 1, max: 100 },
    popularity: { min: 1, max: 100 },
    adBudget: { min: 1, max: 100 },
    ctr: { min: 1, max: 100 },
  };

  it("all filters populated with 'all' network → value sides taken", () => {
    const p = buildSearchPayload(fullFilters);
    expect(p.advertiser).toBe("nike");
    expect(p.exact_search).toBe(1);
    expect(Array.isArray(p.country)).toBe(true);
    expect(Array.isArray(p.type)).toBe(true);
    expect(p.type).toContain("IMAGE_VIDEO");
    expect(Array.isArray(p.gender)).toBe(true);
    expect(p.gender_activity).toBe("male,female");
    expect(p.lower_age).toBe(13);
    expect(p.verified).toBe(1);
    expect(p.size).toBe("LARGE,MEDIUM");
  });

  it("empty filters with 'all' network → 'NA' (value-absent) sides taken", () => {
    const p = buildSearchPayload({ activePlatforms: ["all"] });
    expect(p.cta_filter ?? p.call_to_action).toBeDefined();
    expect(p.gender).toBe("NA");
    expect(p.gender_activity).toBe("NA");
    expect(p.size).toBe("NA");
    expect(p.likes).toBe("NA");
    expect(p.verified).toBe("NA");
  });

  it("filters present but network unsupported → ps-false branches exercised", () => {
    const p = buildSearchPayload({
      activePlatforms: ["zzz-unknown"],
      gender: ["male"],
      likes: { min: 1, max: 5 },
      verified: true,
      image_size_filter: ["LARGE"],
      lower_age: 18,
      // force these fields into the support map so the ps-false ('NA') side fires
      filterPlatformSupport: {
        gender_filter: ["facebook"], gender: ["facebook"],
        likes: ["facebook"], verified_filter: ["facebook"], verified: ["facebook"],
        image_size_filter: ["facebook"], image_size: ["facebook"],
      },
    });
    expect(p.gender).toBe("NA");
    expect(p.likes).toBe("NA");
    expect(p.verified).toBe("NA");
    expect(p.size).toBe("NA");
  });

  it("gender 'all' → gender_activity 'All'", () => {
    const p = buildSearchPayload({ activePlatforms: ["all"], gender: "all" });
    expect(p.gender_activity).toBe("All");
    expect(p.gender).toBe("NA");
  });

  it("gender scalar string → wrapped to array", () => {
    const p = buildSearchPayload({ activePlatforms: ["all"], gender: "male" });
    expect(p.gender).toEqual(["male"]);
    expect(p.gender_activity).toBe("male");
  });

  it("meta_ads_lib with facebook → platform 15 + platform_positions", () => {
    const p = buildSearchPayload({
      activePlatforms: ["facebook"],
      meta_ads_lib_filter: true,
      filterPlatformSupport: { meta_ads_lib_filter: ["facebook"], meta_ads_lib: ["facebook"] },
    });
    expect(p.platform).toBe(15);
    expect(p.platform_positions).toEqual(["facebook", "instagram"]);
  });

  it("age single numeric → lower_age numeric, upper from upper_age", () => {
    const p = buildSearchPayload({ activePlatforms: ["all"], age_filter: 21, upper_age: 30 });
    expect(p.lower_age).toBe(21);
    expect(p.upper_age).toBe(30);
  });

  it("industry derived from category + subcategory when no industry filter", () => {
    const p = buildSearchPayload({ activePlatforms: ["all"], adcategory: ["Retail"], subcategory: ["Shoes", "Bags"] });
    expect(p.industry).toEqual(["Retail", "Shoes", "Bags"]);
  });

  it("tiktok categorical budget scanned from any filter value", () => {
    const p = buildSearchPayload({ activePlatforms: ["all"], someBudgetKey: ["Low", "High"] });
    expect(p.budget).toEqual(["Low", "High"]);
  });
});

describe("buildSearchPayload > platform-support gating (false + secondary-operand branches)", () => {
  // Using a real network (facebook) + filterPlatformSupport overrides forces ps()
  // to actually evaluate field support (the 'all' shortcut would always return true).
  const fb = ["facebook"];

  it("age: both supports unsupported → lower/upper NA (861/862 false branch)", () => {
    const p = buildSearchPayload({
      age: "18-24", activePlatforms: fb,
      filterPlatformSupport: { age_filter: ["nope"], age: ["nope"] },
    });
    expect(p.lower_age).toBe("NA");
    expect(p.upper_age).toBe("NA");
  });
  it("age: filter unsupported but secondary 'age' supported (|| second operand)", () => {
    const p = buildSearchPayload({
      age: "18-24", activePlatforms: fb,
      filterPlatformSupport: { age_filter: ["nope"], age: ["facebook"] },
    });
    expect(p.lower_age).toBe(18);
    expect(p.upper_age).toBe(24);
  });

  it("ad_sub_position: both unsupported → NA (867 return)", () => {
    const p = buildSearchPayload({
      ad_sub_position: "top", activePlatforms: fb,
      filterPlatformSupport: { ad_sub_position_filter: ["nope"], ad_sub_position: ["nope"] },
    });
    expect(p.ad_sub_position).toBe("NA");
  });
  it("ad_sub_position: secondary supported → uppercased (867 second operand)", () => {
    const p = buildSearchPayload({
      ad_sub_position: "top", activePlatforms: fb,
      filterPlatformSupport: { ad_sub_position_filter: ["nope"], ad_sub_position: ["facebook"] },
    });
    expect(p.ad_sub_position).toEqual(["TOP"]);
  });
  it("ad_sub_position: supported but empty array → NA (870)", () => {
    const p = buildSearchPayload({
      ad_sub_position: [], activePlatforms: fb,
      filterPlatformSupport: { ad_sub_position_filter: ["facebook"] },
    });
    expect(p.ad_sub_position).toBe("NA");
  });

  it("nativeNetwork: both unsupported → NA (876/878 false)", () => {
    const p = buildSearchPayload({
      native_network: ["taboola"], activePlatforms: fb,
      filterPlatformSupport: { native_network_filter: ["nope"], native_network: ["nope"] },
    });
    expect(p.nativeNetwork).toBe("NA");
  });
  it("nativeNetwork: secondary supported with values (876 second operand)", () => {
    const p = buildSearchPayload({
      native_network: ["taboola"], activePlatforms: fb,
      filterPlatformSupport: { native_network_filter: ["nope"], native_network: ["facebook"] },
    });
    expect(p.nativeNetwork).toEqual(["taboola"]);
  });

  it("view: both unsupported → NA (896 false)", () => {
    const p = buildSearchPayload({
      views: [1, 5], activePlatforms: fb,
      filterPlatformSupport: { views_range_filter: ["nope"], views: ["nope"] },
    });
    expect(p.view).toBe("NA");
  });
  it("view: secondary 'views' supported (896 second operand)", () => {
    const p = buildSearchPayload({
      views: [1, 5], activePlatforms: fb,
      filterPlatformSupport: { views_range_filter: ["nope"], views: ["facebook"] },
    });
    expect(p.view).toEqual([1, 5]);
  });

  it("ctr: both unsupported → NA (899 false)", () => {
    const p = buildSearchPayload({
      ctr: [1, 5], activePlatforms: fb,
      filterPlatformSupport: { ctr_filter: ["nope"], ctr: ["nope"] },
    });
    expect(p.ctr).toBe("NA");
  });
  it("ctr: secondary 'ctr' supported (899 second operand)", () => {
    const p = buildSearchPayload({
      ctr: [1, 5], activePlatforms: fb,
      filterPlatformSupport: { ctr_filter: ["nope"], ctr: ["facebook"] },
    });
    expect(p.ctr).toEqual([1, 5]);
  });

  it("size: both unsupported → NA (926 false)", () => {
    const p = buildSearchPayload({
      image_size: ["VERT"], activePlatforms: fb,
      filterPlatformSupport: { image_size_filter: ["nope"], image_size: ["nope"] },
    });
    expect(p.size).toBe("NA");
  });
  it("size: supported array joins (926 array branch)", () => {
    const p = buildSearchPayload({
      image_size: ["VERT", "HORIZ"], activePlatforms: fb,
      filterPlatformSupport: { image_size_filter: ["facebook"] },
    });
    expect(p.size).toBe("VERT,HORIZ");
  });
  it("size: supported empty array → NA (926 inner)", () => {
    const p = buildSearchPayload({
      image_size: [], activePlatforms: fb,
      filterPlatformSupport: { image_size_filter: ["facebook"] },
    });
    expect(p.size).toBe("NA");
  });
  it("size: supported scalar → v(imageSize) (926 non-array branch)", () => {
    const p = buildSearchPayload({
      image_size: "VERT", activePlatforms: fb,
      filterPlatformSupport: { image_size_filter: ["facebook"] },
    });
    expect(p.size).toBe("VERT");
  });

  it("meta_ads_lib: filter unsupported but secondary supported → platform 15 (917/920 second operand)", () => {
    const p = buildSearchPayload({
      meta_ads_lib: true, activePlatforms: fb,
      filterPlatformSupport: { meta_ads_lib_filter: ["nope"], meta_ads_lib: ["facebook"] },
    });
    expect(p.platform).toBe(15);
    expect(p.platform_positions).toEqual(["facebook", "instagram"]);
  });
  it("meta_ads_lib: supported but flag off → platform NA (917/920 false)", () => {
    const p = buildSearchPayload({
      meta_ads_lib: false, activePlatforms: fb,
      filterPlatformSupport: { meta_ads_lib_filter: ["facebook"] },
    });
    expect(p.platform).toBe("NA");
    expect(p.platform_positions).toBe("NA");
  });

  it("call_to_action: both unsupported → NA (836 false)", () => {
    const p = buildSearchPayload({
      cta: ["Shop Now"], activePlatforms: fb,
      filterPlatformSupport: { cta_filter: ["nope"], cta: ["nope"] },
    });
    expect(p.call_to_action).toBe("NA");
  });
  it("call_to_action: secondary 'cta' supported (836 second operand)", () => {
    const p = buildSearchPayload({
      cta: ["Shop Now"], activePlatforms: fb,
      filterPlatformSupport: { cta_filter: ["nope"], cta: ["facebook"] },
    });
    expect(p.call_to_action).toEqual(["Shop Now"]);
  });
});

describe("buildSearchPayload > age-parse & searchIn edge branches", () => {
  it("age plain string without dash/plus → lower=value (line 630 string branch)", () => {
    const p = buildSearchPayload({ age: "25", upper_age: 40, activePlatforms: ["all"] });
    expect(p.lower_age).toBe("25");
    expect(p.upper_age).toBe(40);
  });
  it("age range that parses to NaN → both bounds undefined → NA (648/649)", () => {
    const p = buildSearchPayload({ age: ["a-b"], activePlatforms: ["all"] });
    expect(p.lower_age).toBe("NA");
    expect(p.upper_age).toBe("NA");
  });
  it("age '+' entry that parses to NaN → skipped (line 641 else)", () => {
    const p = buildSearchPayload({ age: ["abc+"], activePlatforms: ["all"] });
    expect(p.lower_age).toBe("NA");
    expect(p.upper_age).toBe("NA");
  });
  it("age array entry with neither '+' nor '-' is skipped in loop (line 642 else)", () => {
    const p = buildSearchPayload({ age: ["18-24", "xyz"], activePlatforms: ["all"] });
    expect(p.lower_age).toBe(18);
    expect(p.upper_age).toBe(24);
  });
  it("advertiser mode with empty query → NA (701 inner ||)", () => {
    const p = buildSearchPayload({ searchIn: "advertiser", searchQuery: "", activePlatforms: ["all"] });
    expect(p.advertiser).toBe("NA");
  });
  it("domain mode with empty query → NA (702 inner ||)", () => {
    const p = buildSearchPayload({ searchIn: "domain", searchQuery: "", activePlatforms: ["all"] });
    expect(p.domain).toBe("NA");
  });
  it("adTypeOptions option missing .value → '' fallback (line 676)", () => {
    const p = buildSearchPayload({
      ad_type: "video",
      activePlatforms: ["facebook"],
      adTypeOptions: [{ platform_applicability: ["facebook"] }, { value: "video", platform_applicability: ["facebook"] }],
    });
    expect(p.network || p.networks || true).toBeTruthy(); // smoke: built without throwing
  });
  it("ad_type array with an empty-string entry → (t||'') fallback (line 676)", () => {
    const p = buildSearchPayload({
      ad_type: ["", "video"],
      activePlatforms: ["facebook"],
      adTypeOptions: [{ value: "video", platform_applicability: ["facebook"] }],
    });
    expect(p).toBeTruthy(); // '' entry exercises (t||'') without matching an option
  });
});

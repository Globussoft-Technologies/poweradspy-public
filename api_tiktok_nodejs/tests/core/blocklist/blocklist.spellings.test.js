import { describe, it, expect } from "vitest";
import { compactName, compactNormalized, normalizeName } from "../../../core/blocklist/blocklist.normalize.js";
import { buildSnapshot, evaluate } from "../../../core/blocklist/blocklist.match.js";

// One advertiser written many ways must be caught by one entry.

describe("blocklist spellings > compactName", () => {
  it("makes the spacing, case and punctuation variants of one name equal", () => {
    const variants = [
      "Twinkling Tree", "twinkling tree", "TwinklingTree", "twinklingtree",
      "Twinkling-Tree", "twinkling_tree", "Twinkling.Tree", "  Twinkling   Tree  ", "TWINKLING  TREE!",
    ];
    for (const v of variants) expect(compactName(v)).toBe("twinklingtree");
  });

  it("ignores Latin accents", () => {
    expect(compactName("Café Crème")).toBe("cafecreme");
    expect(compactName("Cafe Creme")).toBe("cafecreme");
  });

  it("keeps digits and non-Latin letters, and keeps marks that are part of a letter", () => {
    expect(compactName("Shop 24x7")).toBe("shop24x7");
    expect(compactName("कमल")).toBe("कमल");
    expect(compactName("कमल")).not.toBe(compactName("कामल"));
  });

  it("does not make different names equal", () => {
    expect(compactName("Twinkling Trees")).not.toBe(compactName("Twinkling Tree"));
    expect(compactName("Tree Twinkling")).not.toBe(compactName("Twinkling Tree"));
  });

  it("returns an empty string for anything that is not a usable name", () => {
    for (const v of [null, undefined, "", "   ", "!!! --- ___", {}, [], NaN]) expect(compactName(v)).toBe("");
  });

  it("accepts a number, and compactNormalized agrees with compactName", () => {
    expect(compactName(123456789)).toBe("123456789");
    expect(compactNormalized(normalizeName("Twinkling-Tree"))).toBe("twinklingtree");
    expect(compactNormalized(undefined)).toBe("");
    expect(compactNormalized(5)).toBe("");
  });
});

describe("blocklist spellings > buildSnapshot", () => {
  it("indexes advertiser and page entries under their compact name, without inflating the count", () => {
    const snap = buildSnapshot([
      { id: 1, entry_type: "advertiser", value: "Twinkling Tree" },
      { id: 2, entry_type: "page", value: "Blue-Moon Shop" },
      { id: 3, entry_type: "ad_id", value: "999" },
    ]);
    expect(snap.count).toBe(3);
    expect(snap.byFamily.get("advertiser_variant").get("twinklingtree")).toEqual({ id: 1, entryType: "advertiser" });
    expect(snap.byFamily.get("advertiser_variant").get("bluemoonshop")).toEqual({ id: 2, entryType: "page" });
  });

  it("leaves out names shorter than the minimum (they still match exactly) and uses the configured minimum", () => {
    const short = buildSnapshot([{ id: 1, entry_type: "advertiser", value: "a b" }]);
    expect(short.byFamily.get("advertiser_variant")).toBeUndefined();
    expect(short.byFamily.get("advertiser").get("a b")).toBeTruthy();

    const rows = [{ id: 1, entry_type: "advertiser", value: "ab c" }];
    expect(buildSnapshot(rows, { compactMinLength: 3 }).byFamily.get("advertiser_variant").get("abc")).toBeTruthy();
    expect(buildSnapshot(rows, { compactMinLength: 4 }).byFamily.get("advertiser_variant")).toBeUndefined();
  });

  it("ignores a missing or invalid minimum and uses the default of 4", () => {
    const rows = [{ id: 1, entry_type: "advertiser", value: "abc" }];
    for (const bad of [undefined, null, 0, -1, 2.5, "3", NaN]) {
      expect(buildSnapshot(rows, { compactMinLength: bad }).byFamily.get("advertiser_variant")).toBeUndefined();
    }
  });

  it("only advertiser and page entries get a compact index", () => {
    const snap = buildSnapshot([
      { id: 1, entry_type: "url", value: "https://cdn.site.com/some-long-name.jpg" },
      { id: 2, entry_type: "domain", value: "twinkling-tree.com" },
      { id: 3, entry_type: "ad_id", value: "abcdef" },
    ]);
    expect(snap.byFamily.get("advertiser_variant")).toBeUndefined();
  });
});

describe("blocklist spellings > evaluate", () => {
  const snap = buildSnapshot([{ id: 7, entry_type: "advertiser", value: "Twinkling Tree" }]);
  const ad = (name) => ({ adIds: [], advertisers: [normalizeName(name)], urls: [], domains: [] });

  it("an exact name is matched by the exact rule first; another spelling by the variant rule", () => {
    expect(evaluate(ad("Twinkling Tree"), snap, {})).toMatchObject({ rule: "advertiser", entry: { id: 7 } });
    for (const name of ["TwinklingTree", "twinkling-tree", "TWINKLING_TREE", "Twinkling.Tree"]) {
      expect(evaluate(ad(name), snap, {})).toMatchObject({ rule: "advertiserVariant", entry: { id: 7, entryType: "advertiser" } });
    }
  });

  it("does not match a different name", () => {
    for (const name of ["Twinkling Trees", "Twinkling", "Tree", "Winkling Tree", ""]) {
      expect(evaluate(ad(name), snap, {})).toBeNull();
    }
  });

  it("can be switched off on its own, and is off when the advertiser rule is off", () => {
    expect(evaluate(ad("TwinklingTree"), snap, { advertiserVariant: false })).toBeNull();
    expect(evaluate(ad("Twinkling Tree"), snap, { advertiserVariant: false })).toMatchObject({ rule: "advertiser" });
    expect(evaluate(ad("TwinklingTree"), snap, { advertiser: false })).toBeNull();
    expect(evaluate(ad("Twinkling Tree"), snap, { advertiser: false })).toBeNull();
  });

  it("is on when the rule flags are missing", () => {
    expect(evaluate(ad("TwinklingTree"), snap, undefined)).toMatchObject({ rule: "advertiserVariant" });
    expect(evaluate(ad("TwinklingTree"), snap, { adId: true, advertiser: true })).toMatchObject({ rule: "advertiserVariant" });
  });

  it("an empty list matches nothing", () => {
    expect(evaluate(ad("TwinklingTree"), buildSnapshot([]), {})).toBeNull();
  });
});

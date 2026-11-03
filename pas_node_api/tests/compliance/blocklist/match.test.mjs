import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);

const { buildSnapshot, buildImageHashes } = require("../../../src/compliance/blocklist/match");
const { parseHash } = require("../../../src/compliance/imagematch/matcher");

const SHA = "a".repeat(64);
// The 256-bit perceptual hash of the image-hashing service: 64 hex characters (a real answer).
const PHASH = "460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304";
const ALGO = "sscd-simhash-v1";

describe("match > buildImageHashes", () => {
  it("builds { id, sha256, phash (8 words), algo } from the database rows", () => {
    const out = buildImageHashes([{ id: 5, image_sha256: SHA, image_phash: PHASH, image_phash_algo: "SSCD-SimHash-v1" }]);
    expect(out).toEqual([{ id: 5, sha256: SHA, phash: parseHash(PHASH), algo: ALGO }]);
    expect(out[0].phash).toBeInstanceOf(Uint32Array);
    expect(out[0].phash).toHaveLength(8);
  });

  it("keeps every bit of the 256-bit hash", () => {
    const [h] = buildImageHashes([{ id: 1, image_sha256: SHA, image_phash: `ffffffff${"0".repeat(55)}1`, image_phash_algo: ALGO }]);
    expect(h.phash[0]).toBe(0xffffffff);
    expect(h.phash[7]).toBe(1);
    expect([...h.phash].slice(1, 7).every((w) => w === 0)).toBe(true);
  });

  it("accepts the hash in upper case and with spaces", () => {
    const [h] = buildImageHashes([{ id: 1, image_sha256: SHA, image_phash: `  ${PHASH.toUpperCase()} `, image_phash_algo: ALGO }]);
    expect(h.phash).toEqual(parseHash(PHASH));
  });

  it("lowercases and trims the sha256, and skips rows without a valid 64-hex one", () => {
    const out = buildImageHashes([
      { id: 1, image_sha256: `  ${SHA.toUpperCase()} `, image_phash: PHASH, image_phash_algo: ALGO },
      { id: 2, image_sha256: "abc" },
      { id: 3, image_sha256: null },
      { id: 4 },
      null,
      { id: 5, image_sha256: "z".repeat(64) },
    ]);
    expect(out.map((h) => h.id)).toEqual([1]);
    expect(out[0].sha256).toBe(SHA);
  });

  it("an unusable perceptual hash becomes null, leaving the exact match", () => {
    // includes the decimal 64-bit hashes of the old design, which are not 64 hex characters
    for (const bad of [null, undefined, "", "12x", "-1", "18446744073709551615", "5", PHASH.slice(1), `${PHASH}0`, {}, 5n]) {
      const [h] = buildImageHashes([{ id: 1, image_sha256: SHA, image_phash: bad, image_phash_algo: ALGO }]);
      expect(h.phash).toBeNull();
      expect(h.algo).toBeNull();
      expect(h.sha256).toBe(SHA); // the exact match is kept
    }
  });

  it("returns frozen entries and an empty list for no input", () => {
    const [h] = buildImageHashes([{ id: 1, image_sha256: SHA, image_phash: PHASH, image_phash_algo: "d" }]);
    expect(Object.isFrozen(h)).toBe(true);
    expect(buildImageHashes(undefined)).toEqual([]);
    expect(buildImageHashes([])).toEqual([]);
  });
});

describe("match > buildSnapshot still ignores image_hash rows", () => {
  it("counts them as ignored and never matches on them", () => {
    const snap = buildSnapshot([
      { id: 1, entry_type: "ad_id", value: "1" },
      { id: 2, entry_type: "image_hash", value: SHA },
    ]);
    expect(snap.count).toBe(1);
    expect(snap.ignored).toBe(1);
  });
});

describe("advertiser spelling variants", () => {
const { compactName, compactNormalized, normalizeName } = require("../../../src/compliance/blocklist/normalize");
const { buildSnapshot, evaluate } = require("../../../src/compliance/blocklist/match");
const { extract, resolveFields } = require("../../../src/compliance/blocklist/extract");

// One advertiser written many ways must be caught by one entry.

describe("spellings > compactName", () => {
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
    expect(compactName("कमल") ).toBe("कमल");
    // the vowel sign is part of the name: these are two different names
    expect(compactName("कमल")).not.toBe(compactName("कामल"));
  });

  it("does not make different names equal", () => {
    expect(compactName("Twinkling Trees")).not.toBe(compactName("Twinkling Tree"));
    expect(compactName("Tree Twinkling")).not.toBe(compactName("Twinkling Tree"));
  });

  it("returns an empty string for anything that is not a usable name", () => {
    for (const v of [null, undefined, "", "   ", "!!! --- ___", {}, [], NaN]) expect(compactName(v)).toBe("");
  });

  it("accepts a number (some networks send a numeric advertiser id)", () => {
    expect(compactName(123456789)).toBe("123456789");
  });

  it("compactNormalized on an already normalized name gives the same as compactName", () => {
    const n = normalizeName("Twinkling-Tree");
    expect(compactNormalized(n)).toBe(compactName("Twinkling-Tree"));
    expect(compactNormalized(undefined)).toBe("");
    expect(compactNormalized(5)).toBe("");
  });
});

describe("spellings > buildSnapshot", () => {
  it("indexes each advertiser or page entry under its compact name, without inflating the count", () => {
    const snap = buildSnapshot([
      { id: 1, entry_type: "advertiser", value: "Twinkling Tree" },
      { id: 2, entry_type: "page", value: "Blue-Moon Shop" },
      { id: 3, entry_type: "ad_id", value: "999" },
    ]);
    expect(snap.count).toBe(3);
    expect(snap.byFamily.get("advertiser_variant").get("twinklingtree")).toEqual({ id: 1, entryType: "advertiser" });
    expect(snap.byFamily.get("advertiser_variant").get("bluemoonshop")).toEqual({ id: 2, entryType: "page" });
    expect(snap.byFamily.get("advertiser_variant").size).toBe(2);
  });

  it("leaves out names shorter than the minimum, but they still match exactly", () => {
    const snap = buildSnapshot([{ id: 1, entry_type: "advertiser", value: "a b" }]);
    expect(snap.byFamily.get("advertiser_variant")).toBeUndefined();
    expect(snap.byFamily.get("advertiser").get("a b")).toBeTruthy();
  });

  it("uses the configured minimum", () => {
    const rows = [{ id: 1, entry_type: "advertiser", value: "ab c" }]; // compact: abc (3)
    expect(buildSnapshot(rows, { compactMinLength: 3 }).byFamily.get("advertiser_variant").get("abc")).toBeTruthy();
    expect(buildSnapshot(rows, { compactMinLength: 4 }).byFamily.get("advertiser_variant")).toBeUndefined();
  });

  it("ignores a missing or invalid minimum and uses the default of 4", () => {
    const rows = [{ id: 1, entry_type: "advertiser", value: "abc" }];
    for (const bad of [undefined, null, 0, -1, 2.5, "3", NaN]) {
      expect(buildSnapshot(rows, { compactMinLength: bad }).byFamily.get("advertiser_variant")).toBeUndefined();
    }
    expect(buildSnapshot(rows).byFamily.get("advertiser_variant")).toBeUndefined();
  });

  it("only advertiser and page entries get a compact index", () => {
    const snap = buildSnapshot([
      { id: 1, entry_type: "url", value: "https://cdn.site.com/some-long-name.jpg" },
      { id: 2, entry_type: "domain", value: "twinkling-tree.com" },
      { id: 3, entry_type: "ad_id", value: "abcdef" },
    ]);
    expect(snap.byFamily.get("advertiser_variant")).toBeUndefined();
  });

  it("when two entries share a compact name the first one wins", () => {
    const snap = buildSnapshot([
      { id: 1, entry_type: "advertiser", value: "Twinkling Tree" },
      { id: 2, entry_type: "advertiser", value: "Twinkling-Tree" },
    ]);
    expect(snap.byFamily.get("advertiser_variant").get("twinklingtree").id).toBe(1);
    expect(snap.count).toBe(2); // two distinct exact entries
  });
});

describe("spellings > evaluate", () => {
  const snap = buildSnapshot([{ id: 7, entry_type: "advertiser", value: "Twinkling Tree" }]);
  const ad = (name) => ({ adIds: [], advertisers: [normalizeName(name)], urls: [], domains: [] });

  it("an exact name is still matched by the exact rule first", () => {
    const hit = evaluate(ad("Twinkling Tree"), snap, {});
    expect(hit).toMatchObject({ rule: "advertiser", entry: { id: 7 } });
  });

  it("another spelling of the name is matched by the variant rule", () => {
    for (const name of ["TwinklingTree", "twinkling-tree", "TWINKLING_TREE", "Twinkling.Tree"]) {
      expect(evaluate(ad(name), snap, {})).toMatchObject({ rule: "advertiserVariant", entry: { id: 7, entryType: "advertiser" } });
    }
  });

  it("does not match a different name", () => {
    for (const name of ["Twinkling Trees", "Twinkling", "Tree", "Winkling Tree", ""]) {
      expect(evaluate(ad(name), snap, {})).toBeNull();
    }
  });

  it("can be switched off on its own, leaving the exact rule", () => {
    expect(evaluate(ad("TwinklingTree"), snap, { advertiserVariant: false })).toBeNull();
    expect(evaluate(ad("Twinkling Tree"), snap, { advertiserVariant: false })).toMatchObject({ rule: "advertiser" });
  });

  it("is off when the advertiser rule is off", () => {
    expect(evaluate(ad("TwinklingTree"), snap, { advertiser: false })).toBeNull();
    expect(evaluate(ad("Twinkling Tree"), snap, { advertiser: false })).toBeNull();
  });

  it("is on when the rule flags are missing (a config without the new flag)", () => {
    expect(evaluate(ad("TwinklingTree"), snap, undefined)).toMatchObject({ rule: "advertiserVariant" });
    expect(evaluate(ad("TwinklingTree"), snap, { adId: true, advertiser: true })).toMatchObject({ rule: "advertiserVariant" });
  });

  it("checks every advertiser field of the ad", () => {
    const fields = resolveFields("facebook", {});
    const x = extract({ post_owner: "Someone Else", advertiser_name: "TwinklingTree" }, fields, 200);
    expect(evaluate(x, snap, {})).toMatchObject({ rule: "advertiserVariant" });
  });

  it("an empty list does no work and matches nothing", () => {
    const empty = buildSnapshot([]);
    expect(evaluate(ad("TwinklingTree"), empty, {})).toBeNull();
  });

  it("an ad with a numeric advertiser id matches an id entry only exactly", () => {
    const s = buildSnapshot([{ id: 9, entry_type: "advertiser", value: "123456789" }]);
    expect(evaluate(ad("123456789"), s, {})).toMatchObject({ rule: "advertiser" });
    expect(evaluate(ad("1234 56789"), s, {})).toMatchObject({ rule: "advertiserVariant" }); // spacing only; digits unchanged
    expect(evaluate(ad("123456780"), s, {})).toBeNull();
  });
});

// The settings are built in src/config/index.js; load the real module in a fresh process.
const root = path.resolve(import.meta.dirname, "../../..");
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "blocklist-spelling-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function loadConfig(fileConfig) {
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(fileConfig ?? {}));
  const out = execFileSync(
    process.execPath,
    ["-e", "console.log(JSON.stringify(require('./src/config').compliance.blocklist))"],
    { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, PAS_NODE_API_CONFIG_PATH: file, BLOCKLIST_ENABLED: "" } }
  );
  return JSON.parse(out.trim().split("\n").pop());
}

describe("spellings > config", () => {
  it("defaults: variant rule on, minimum 4", () => {
    const c = loadConfig({});
    expect(c.rules.advertiserVariant).toBe(true);
    expect(c.compactMinLength).toBe(4);
    expect(c.enabled).toBe(false); // the whole blocklist is still off by default
  });

  it("can be switched off, and the minimum is clamped to 2..20", () => {
    expect(loadConfig({ compliance: { blocklist: { rules: { advertiserVariant: false } } } }).rules.advertiserVariant).toBe(false);
    expect(loadConfig({ compliance: { blocklist: { compactMinLength: 6 } } }).compactMinLength).toBe(6);
    expect(loadConfig({ compliance: { blocklist: { compactMinLength: 1 } } }).compactMinLength).toBe(2);
    expect(loadConfig({ compliance: { blocklist: { compactMinLength: 99 } } }).compactMinLength).toBe(20);
    expect(loadConfig({ compliance: { blocklist: { compactMinLength: "abc" } } }).compactMinLength).toBe(4);
  });
});
});

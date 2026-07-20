import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { getDisplayableMediaFilter } = require(
  "../../../../src/services/common/helpers/displayableMediaFilters"
);

// Recursively collect every `wildcard` clause in a filter tree as
// { field, value } pairs, regardless of nesting depth.
function collectWildcards(node, acc = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectWildcards(n, acc));
    return acc;
  }
  if (node && typeof node === "object") {
    if (node.wildcard) {
      const field = Object.keys(node.wildcard)[0];
      const raw = node.wildcard[field];
      acc.push({ field, value: raw && raw.value !== undefined ? raw.value : raw });
    }
    for (const key of Object.keys(node)) {
      if (key !== "wildcard") collectWildcards(node[key], acc);
    }
  }
  return acc;
}

const NETWORKS = [
  "facebook", "instagram", "linkedin", "youtube", "google",
  "gdn", "pinterest", "quora", "reddit", "native", "tiktok",
];

describe("common/helpers/displayableMediaFilters > getDisplayableMediaFilter", () => {
  // The bug this guards: blocked-media wildcards were running against the
  // analyzed text field instead of the whole-value `.keyword` sub-field, so
  // they matched differently than the live *QueryBuilder.js gates. Every
  // wildcard must target `.keyword` — the single deliberate exception is
  // tiktok's `video_url` (kept analyzed to mirror its builder).
  it("every wildcard targets a .keyword sub-field (except tiktok video_url)", () => {
    for (const net of NETWORKS) {
      const wildcards = collectWildcards(getDisplayableMediaFilter(net));
      for (const { field } of wildcards) {
        if (field === "video_url") {
          expect(net).toBe("tiktok");
          continue;
        }
        expect(field.endsWith(".keyword"), `${net}: wildcard on "${field}" must use .keyword`).toBe(true);
      }
    }
  });

  it("youtube: 7 .keyword wildcards incl a *DefaultImage* thumbnail_url exclusion + empty ad_type guard", () => {
    const f = getDisplayableMediaFilter("youtube");
    const wc = collectWildcards(f);
    expect(wc).toHaveLength(7);
    expect(wc.every((w) => w.field.endsWith(".keyword"))).toBe(true);
    expect(wc.some((w) => w.field === "thumbnail_url.keyword" && /DefaultImage/i.test(w.value))).toBe(true);
    // The always-applied empty-ad_type exclusion clause (mirrors the builder).
    const json = JSON.stringify(f);
    expect(json).toContain('"ad_type.keyword"');
  });

  it("linkedin: 7 .keyword wildcards, 2 *DefaultImage* exclusions, ad_video gated on .keyword", () => {
    const wc = collectWildcards(getDisplayableMediaFilter("linkedin"));
    expect(wc).toHaveLength(7);
    expect(wc.every((w) => w.field.endsWith(".keyword"))).toBe(true);
    expect(wc.filter((w) => /DefaultImage/i.test(w.value))).toHaveLength(2);
    expect(wc.some((w) => w.field === "ad_video.keyword")).toBe(true);
  });

  it("reddit: Thumbnail video wildcards use the .keyword sub-field", () => {
    const wc = collectWildcards(getDisplayableMediaFilter("reddit"));
    expect(wc).toHaveLength(3);
    expect(wc.every((w) => w.field === "Thumbnail.keyword")).toBe(true);
  });

  it("tiktok: video_cover gated on .keyword (3) while video_url stays analyzed (3)", () => {
    const wc = collectWildcards(getDisplayableMediaFilter("tiktok"));
    expect(wc.filter((w) => w.field === "video_cover.keyword")).toHaveLength(3);
    expect(wc.filter((w) => w.field === "video_url")).toHaveLength(3);
  });

  it("bing has no displayable-media filter", () => {
    expect(getDisplayableMediaFilter("bing")).toBeNull();
  });

  // Regression: the google clause previously term-matched `new_nas_image_url.keyword`
  // for the "is empty string" check, but that sub-field doesn't exist on this
  // (already-keyword-typed) field in the real ES mapping — the live
  // GoogleSearchQueryBuilder.js term-matches the plain field. The mismatch made
  // an empty-string new_nas_image_url IMAGE ad silently pass the filter instead of
  // being excluded (an `exists`-but-blank ad slipping through undetected).
  it("google's empty-new_nas_image_url check term-matches the plain field, not .keyword", () => {
    const json = JSON.stringify(getDisplayableMediaFilter("google"));
    expect(json).toContain('"term":{"new_nas_image_url":""}');
    expect(json).not.toContain('"new_nas_image_url.keyword":""');
  });
});

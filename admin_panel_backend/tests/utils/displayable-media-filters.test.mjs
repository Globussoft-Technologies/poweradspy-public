import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { getDisplayableMediaFilter } = require("../../utils/displayable-media-filters");

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

// This mirror MUST stay identical to the pas_node_api copy at
// pas_node_api/src/services/common/helpers/displayableMediaFilters.js, which
// in turn mirrors each network's live *QueryBuilder.js gate. These assertions
// guard the 2026-06-15 sync fix (blocked-media wildcards must use the
// whole-value `.keyword` sub-field; youtube/linkedin must exclude DefaultImage).
describe("utils/displayable-media-filters > getDisplayableMediaFilter", () => {
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
    expect(JSON.stringify(f)).toContain('"ad_type.keyword"');
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
});

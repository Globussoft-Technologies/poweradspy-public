import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_NETWORKS,
  parseArgs,
  parseExpectedCounts,
  sourceMatchesOwner,
} = require("../../scripts/delete-post-owner-ads");

describe("delete-post-owner-ads safety parsing", () => {
  it("defaults to dry-run across all 11 searchable networks", () => {
    const opts = parseArgs(["--post-owner", "TwinklingTree"]);
    expect(opts.apply).toBe(false);
    expect(opts.networks).toEqual(DEFAULT_NETWORKS);
    expect(opts.networks).toContain("tiktok");
  });

  it("parses a restricted network list and exact expected counts", () => {
    const opts = parseArgs([
      "--post-owner", "TwinklingTree",
      "--networks", "facebook,google",
      "--apply",
      "--confirm", "DELETE_POST_OWNER_ADS:TwinklingTree",
      "--expected-counts", "facebook=221,google=23",
      "--concurrency", "2",
    ]);
    expect(opts).toMatchObject({
      apply: true,
      networks: ["facebook", "google"],
      expectedCounts: { facebook: 221, google: 23 },
      concurrency: 2,
    });
  });

  it("rejects malformed or duplicate expected counts", () => {
    expect(() => parseExpectedCounts("facebook=abc")).toThrow();
    expect(() => parseExpectedCounts("facebook=1,facebook=2")).toThrow();
    expect(() => parseExpectedCounts("unknown=1")).toThrow();
  });

  it("rejects unknown arguments and unsafe concurrency", () => {
    expect(() => parseArgs(["--post-owner", "x", "--wat"])).toThrow("Unknown argument");
    expect(() => parseArgs(["--post-owner", "x", "--concurrency", "5"])).toThrow();
  });

  it("checks ES source owner with exact normalized matching", () => {
    const fields = ["facebook_ad_post_owners.post_owner_name"];
    expect(sourceMatchesOwner(
      { "facebook_ad_post_owners.post_owner_name": "  TWINKLINGTREE " },
      fields,
      "twinklingtree"
    )).toBe(true);
    expect(sourceMatchesOwner(
      { facebook_ad_post_owners: { post_owner_name: "TwinklingTree Store" } },
      fields,
      "twinklingtree"
    )).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { getPermittedSavedPlatforms } from "../../../src/components/ads/SavedAdsPage.jsx";

describe("SavedAdsPage > plan-safe network selection", () => {
  const allNetworks = [
    "facebook", "instagram", "youtube", "google", "gdn", "linkedin",
    "reddit", "quora", "pinterest", "tiktok", "native",
  ];

  it("All includes only networks enabled for the selected billing plan", () => {
    expect(getPermittedSavedPlatforms(allNetworks, [
      "facebook", "instagram", "youtube", "google", "gdn", "pinterest", "native",
    ])).toEqual([
      "facebook", "instagram", "youtube", "google", "gdn", "pinterest", "native",
    ]);
  });

  it("matches network names case-insensitively", () => {
    expect(getPermittedSavedPlatforms(["Facebook", "LinkedIn"], ["facebook"])).toEqual(["Facebook"]);
  });

  it("preserves the legacy all-network behavior only when no access list was supplied", () => {
    expect(getPermittedSavedPlatforms(allNetworks, undefined)).toEqual(allNetworks);
    expect(getPermittedSavedPlatforms(allNetworks, [])).toEqual([]);
  });
});

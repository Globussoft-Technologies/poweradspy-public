import { describe, expect, it } from "vitest";
import { getDisplayableMediaFilter } from "../../utils/displayableMediaFilters.js";

describe("displayableMediaFilters", () => {
  it("returns a google filter that keeps the transparency platform 18 exception", () => {
    const json = JSON.stringify(getDisplayableMediaFilter("google"));
    expect(json).toContain('"platform":18');
  });

  it("returns a displayable-media array for the networks the competitor service counts", () => {
    expect(getDisplayableMediaFilter("facebook")).toEqual(expect.any(Array));
    expect(getDisplayableMediaFilter("instagram")).toEqual(expect.any(Array));
    expect(getDisplayableMediaFilter("google")).toEqual(expect.any(Array));
  });
});

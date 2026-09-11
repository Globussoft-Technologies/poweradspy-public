import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getAdCountries } = require("../../../../src/services/facebook/insertion/repository");

describe("services/facebook/insertion/repository > getAdCountries", () => {
  it("uses the update-backed *_only relation without querying the legacy relation", async () => {
    const sql = {
      query: vi.fn(async (query) => {
        if (/FROM facebook_ad_countries_only/.test(query)) return [{ country: "Canada" }];
        if (/FROM facebook_ad_countries/.test(query)) return [{ country: "Legacy country" }];
        return [];
      }),
    };

    await expect(getAdCountries(sql, 42)).resolves.toEqual(["Canada"]);
    expect(sql.query).toHaveBeenCalledTimes(1);
  });

  it("falls back to the legacy relation for older ads", async () => {
    const sql = {
      query: vi.fn(async (query) => {
        if (/FROM facebook_ad_countries_only/.test(query)) return [];
        if (/FROM facebook_ad_countries/.test(query)) return [{ country: "United States" }];
        return [];
      }),
    };

    await expect(getAdCountries(sql, 42)).resolves.toEqual(["United States"]);
    expect(sql.query).toHaveBeenCalledTimes(2);
  });
});

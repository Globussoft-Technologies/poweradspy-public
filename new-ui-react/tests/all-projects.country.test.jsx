import { describe, expect, it } from "vitest";
import {
  getAllCountryClickCountries,
  getCountryInfo,
  getDisplayCountries,
} from "../src/components/all-projects/AllProjects.jsx";

describe("AllProjects country helpers", () => {
  it("drops unsupported country spellings while keeping handled countries", () => {
    const countries = getDisplayCountries([
      "Latvia",
      "Turkiye",
      "not available",
      { name: "Turkey", code: "tr" },
      { name: "Réunion", code: "re" },
    ]);

    expect(countries).toEqual(["Latvia", "Turkey"]);
  });

  it("keeps the global reach state even when different labels are used", () => {
    const countries = getDisplayCountries(["Global Reach", "all", "Worldwide"]);

    expect(countries).toHaveLength(1);
    expect(getCountryInfo(countries[0])).toMatchObject({
      isGlobal: true,
      n: "Global Reach",
    });
  });

  it("uses the raw bucket list for the All Countries click-through", () => {
    const countries = getAllCountryClickCountries(
      ["India"],
      { india: 3, all: 2, turkiye: 1, "not available": 4 },
    );

    const normalized = countries.map((country) => String(country).toLowerCase());
    expect(normalized).toEqual(expect.arrayContaining(["india", "all"]));
    expect(normalized).not.toContain("turkiye");
  });
});

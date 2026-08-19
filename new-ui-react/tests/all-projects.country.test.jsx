import { describe, expect, it } from "vitest";
import {
  getAllCountryClickCountries,
  getCountryInfo,
  getDisplayCountries,
  getProjectMonitoredCount,
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

describe("getProjectMonitoredCount", () => {
  it("uses persisted monitoring when competitors are just raw ids", () => {
    expect(
      getProjectMonitoredCount({
        competitors: ["c1", "c2", "c3"],
        monitoring: ["c2"],
      }),
    ).toBe(1);
  });

  it("uses hydrated competitor flags when the rows are actually objects", () => {
    expect(
      getProjectMonitoredCount({
        competitors: [
          { id: "c1", isMonitored: true },
          { id: "c2", isMonitored: false },
        ],
        monitoring: ["stale-value"],
      }),
    ).toBe(1);
  });

  it("falls back to the persisted monitoring length when hydrated rows are absent", () => {
    expect(
      getProjectMonitoredCount({
        competitors: [],
        monitoring: ["c1", "c2"],
        initialMonitoredCount: 99,
      }),
    ).toBe(2);
  });
});

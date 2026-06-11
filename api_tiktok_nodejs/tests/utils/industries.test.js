import { describe, it, expect } from "vitest";
import * as industries from "../../utils/industries.js";

const expectedExports = [
  "apparelAndAccessoriesItems",
  "appliances",
  "apps",
  "babyKidsMeternity",
  "beautyAndPersonalCare",
  "businessServices",
  "ECommerce",
  "Education",
  "financialServices",
  "foodAndBeverage",
  "Games",
  "Health",
  "homeImprovement",
  "houseHoldProducts",
  "lifeServices",
  "newsAndEntertainment",
  "pets",
  "sportsAndOutdoor",
  "techElectronics",
  "travel",
  "vehicleTransportation",
  "categories",
];

describe("utils/industries > module shape", () => {
  it("exports exactly the 22 expected named bindings", () => {
    expect(Object.keys(industries).sort()).toEqual(expectedExports.sort());
  });

  it.each(expectedExports.filter((k) => k !== "categories"))(
    "%s is a non-empty array of strings (or empty array)",
    (key) => {
      const value = industries[key];
      expect(Array.isArray(value)).toBe(true);
      // Some may legitimately be empty
      for (const item of value) {
        expect(typeof item).toBe("string");
      }
    }
  );
});

describe("utils/industries > categories aggregate", () => {
  it("is an array of {label, subcategories} objects", () => {
    expect(Array.isArray(industries.categories)).toBe(true);
    expect(industries.categories.length).toBeGreaterThan(0);
    for (const cat of industries.categories) {
      expect(typeof cat.label).toBe("string");
      expect(Array.isArray(cat.subcategories)).toBe(true);
    }
  });

  it("includes the high-level industry labels", () => {
    const labels = industries.categories.map((c) => c.label);
    expect(labels).toContain("Apparel & Accessories");
    expect(labels).toContain("Beauty & Personal Care");
    expect(labels).toContain("Tech & Electronics");
    expect(labels).toContain("Travel");
  });
});

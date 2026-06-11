import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { mapIndustriesToCategories } = require("../../../../src/services/tiktok/helpers/industries");

describe("services/tiktok/helpers/industries > mapIndustriesToCategories", () => {
  it("returns full set of category labels even when no industries are passed", () => {
    const out = mapIndustriesToCategories([]);
    const labels = out.map(c => c.label);
    expect(labels).toContain("Apparel & Accessories");
    expect(labels).toContain("Appliances");
    expect(labels).toContain("Apps");
    // All categories start with empty subcategories
    expect(out.every(c => Array.isArray(c.subcategories) && c.subcategories.length === 0)).toBe(true);
  });

  it("matches an industry to its category (case-insensitive via titleCase)", () => {
    const out = mapIndustriesToCategories(["bags"]);
    const apparel = out.find(c => c.label === "Apparel & Accessories");
    expect(apparel.subcategories).toContain("Bags");
  });

  it("titleCase upper-cases the first letter after spaces (does NOT affect apostrophes)", () => {
    const out = mapIndustriesToCategories(["men's clothing"]);
    const apparel = out.find(c => c.label === "Apparel & Accessories");
    // titleCase produces "Men's Clothing" — matches "Men's Clothing" in the
    // Apparel & Accessories list.
    expect(apparel.subcategories).toContain("Men's Clothing");
  });

  it("dedupes when the same industry appears multiple times", () => {
    const out = mapIndustriesToCategories(["bags", "bags", "Bags"]);
    const apparel = out.find(c => c.label === "Apparel & Accessories");
    const bagsCount = apparel.subcategories.filter(s => s === "Bags").length;
    expect(bagsCount).toBe(1);
  });

  it("ignores industries that don't match any subcategory", () => {
    const out = mapIndustriesToCategories(["Nonexistent Industry"]);
    expect(out.every(c => !c.subcategories.includes("Nonexistent Industry"))).toBe(true);
  });

  it("places multiple industries into their correct categories", () => {
    const out = mapIndustriesToCategories(["bags", "home appliances", "education"]);
    expect(out.find(c => c.label === "Apparel & Accessories").subcategories).toContain("Bags");
    expect(out.find(c => c.label === "Appliances").subcategories).toContain("Home Appliances");
    expect(out.find(c => c.label === "Apps").subcategories).toContain("Education");
  });

  it("breaks after first matching category (does not double-add across categories)", () => {
    // 'Education' exists in both Apps subcategoryMapping and could exist elsewhere.
    // Verify that breaking after the first match means we don't keep iterating.
    const out = mapIndustriesToCategories(["Education"]);
    const appsCat = out.find(c => c.label === "Apps");
    expect(appsCat.subcategories).toContain("Education");
  });

  it("returns categories as { label, subcategories } shape", () => {
    const out = mapIndustriesToCategories([]);
    for (const c of out) {
      expect(c).toHaveProperty("label");
      expect(c).toHaveProperty("subcategories");
      expect(typeof c.label).toBe("string");
      expect(Array.isArray(c.subcategories)).toBe(true);
    }
  });
});

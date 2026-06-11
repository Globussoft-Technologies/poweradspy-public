import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { buildSDUIDocuments } = require("../../../../src/services/sdui/seed/seedData");

describe("sdui/seed/seedData > buildSDUIDocuments()", () => {
  const docs = buildSDUIDocuments();

  it("returns an array of documents", () => {
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThan(0);
  });

  it("each doc has _id, config_type, rank, and meta", () => {
    for (const d of docs) {
      expect(typeof d._id).toBe("string");
      expect(typeof d.config_type).toBe("string");
      expect(typeof d.rank).toBe("number");
    }
  });

  it("contains searchbar/navbar/sidebar items", () => {
    const types = new Set(docs.map(d => d.config_type));
    expect(types.has("searchbar")).toBe(true);
    expect(types.has("navbar")).toBe(true);
    expect(types.has("sidebar")).toBe(true);
  });

  it("search_input doc has svg icon and input mode", () => {
    const s = docs.find(d => d._id === "search_input");
    expect(s).toBeDefined();
    expect(s.icon.type).toBe("svg");
    expect(s.display_mode).toBe("input");
  });

  it("ids are unique", () => {
    const ids = docs.map(d => d._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("created_at is the constant ISO string", () => {
    for (const d of docs) {
      if (d.created_at) expect(d.created_at).toBe("2026-03-13T11:33:18.71Z");
    }
  });
});

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { interleave, deduplicate, mergeNetworkResults } = require("../../src/utils/resultMerger");

describe("utils/resultMerger > interleave", () => {
  it("empty input returns []", () => {
    expect(interleave([])).toEqual([]);
  });

  it("round-robin order from two unequal-length arrays", () => {
    expect(interleave([["a", "b", "c", "d"], ["x", "y"]])).toEqual(["a", "x", "b", "y", "c", "d"]);
  });

  it("three arrays — interleaves all", () => {
    expect(interleave([[1, 2], [10, 20, 30], [100]])).toEqual([1, 10, 100, 2, 20, 30]);
  });

  it("all-empty inputs → []", () => {
    expect(interleave([[], [], []])).toEqual([]);
  });

  it("single array → unchanged", () => {
    expect(interleave([[1, 2, 3]])).toEqual([1, 2, 3]);
  });
});

describe("utils/resultMerger > deduplicate", () => {
  it("removes duplicates by network:ad_id, first occurrence wins", () => {
    const input = [
      { network: "fb", ad_id: 1 },
      { network: "ig", ad_id: 1 },
      { network: "fb", ad_id: 1 }, // dup
      { network: "fb", ad_id: 2 },
    ];
    expect(deduplicate(input)).toEqual([
      { network: "fb", ad_id: 1 },
      { network: "ig", ad_id: 1 },
      { network: "fb", ad_id: 2 },
    ]);
  });

  it("falls back to .id when .ad_id missing", () => {
    const input = [
      { network: "g", id: 7 },
      { network: "g", id: 7 }, // dup via id
    ];
    expect(deduplicate(input)).toEqual([{ network: "g", id: 7 }]);
  });

  it("falls back to .sql_id when both .ad_id and .id missing", () => {
    const input = [
      { network: "tt", sql_id: 99 },
      { network: "tt", sql_id: 99 },
    ];
    expect(deduplicate(input)).toEqual([{ network: "tt", sql_id: 99 }]);
  });

  it("missing network → uses '' prefix in key", () => {
    const input = [
      { ad_id: 1 },
      { ad_id: 1 }, // dup via empty-network + same ad_id
    ];
    expect(deduplicate(input)).toEqual([{ ad_id: 1 }]);
  });

  it("empty input → []", () => {
    expect(deduplicate([])).toEqual([]);
  });
});

describe("utils/resultMerger > mergeNetworkResults", () => {
  it("interleaves and deduplicates in one call", () => {
    const fb = [{ network: "fb", ad_id: 1 }, { network: "fb", ad_id: 2 }];
    const ig = [{ network: "ig", ad_id: 1 }, { network: "fb", ad_id: 1 } /* dup */];
    expect(mergeNetworkResults([fb, ig])).toEqual([
      { network: "fb", ad_id: 1 },
      { network: "ig", ad_id: 1 },
      { network: "fb", ad_id: 2 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  API_ROOT,
  FALLBACK_NETWORK_INDEXES,
  NETWORK_INDEXES,
  getNetworkIndexAliases,
  loadNetworkIndexes,
  resolveNetworkIndex,
} from "../../utils/networkIndexes.js";

describe("networkIndexes", () => {
  it("loads every API-resolved network index", async () => {
    const { createRequire } = await import("module");
    const apiRequire = createRequire(`${API_ROOT}/package.json`);
    const apiNetworks = apiRequire("./src/config/networks");

    Object.keys(FALLBACK_NETWORK_INDEXES).forEach((network) => {
      const networkConfig = apiNetworks[network];
      const database = networkConfig?.database || {};
      const index = database.elastic?.index || database.elastic_tiktok?.index;
      if (index) {
        expect(NETWORK_INDEXES[network]).toBe(index);
      }
    });
    expect(API_ROOT).toMatch(/pas_node_api$/);
  });

  it("falls back to the existing index names when a network is unavailable", () => {
    expect(loadNetworkIndexes({})).toEqual(FALLBACK_NETWORK_INDEXES);
  });

  it("routes legacy names to the configured physical index", () => {
    expect(resolveNetworkIndex(FALLBACK_NETWORK_INDEXES.google)).toBe(NETWORK_INDEXES.google);
    expect(getNetworkIndexAliases("google")).toContain(NETWORK_INDEXES.google);
  });
});

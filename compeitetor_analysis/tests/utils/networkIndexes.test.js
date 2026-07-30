import { describe, expect, it } from "vitest";
import {
  FALLBACK_NETWORK_INDEXES,
  NETWORK_INDEXES,
  getNetworkIndexAliases,
  loadCompetitorConfig,
  loadNetworkIndexes,
  resolveNetworkIndex,
} from "../../utils/networkIndexes.js";

describe("networkIndexes", () => {
  it("loads every competitor-configured network index", () => {
    const competitorConfig = loadCompetitorConfig();
    const configuredIndexes = competitorConfig.ES_INDEXES || competitorConfig.esIndexes || {};

    Object.keys(FALLBACK_NETWORK_INDEXES).forEach((network) => {
      if (configuredIndexes[network]) {
        expect(NETWORK_INDEXES[network]).toBe(configuredIndexes[network]);
      }
    });
    expect(Object.keys(configuredIndexes).length).toBeGreaterThan(0);
  });

  it("falls back to the existing index names when a network is unavailable", () => {
    expect(loadNetworkIndexes({})).toEqual(FALLBACK_NETWORK_INDEXES);
  });

  it("routes legacy names to the configured physical index", () => {
    expect(resolveNetworkIndex(FALLBACK_NETWORK_INDEXES.google)).toBe(NETWORK_INDEXES.google);
    expect(getNetworkIndexAliases("google")).toContain(NETWORK_INDEXES.google);
  });
});

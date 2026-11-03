import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { makeConfig } from "./helpers.mjs";

const { BlocklistService, defaultNetworks } = require("../../../src/compliance/blocklist/service");

// The default list of covered networks comes from the existing networks config, not from the module.

const fakeConfig = {
  user_activity: { enabled: true, database: { mongo: { enabled: true } } },           // no SQL
  facebook: { enabled: true, database: { sql: { enabled: true } }, insertion: { enabled: true } },
  reddit: { enabled: true, database: { sql: { enabled: true } }, insertion: { enabled: false } }, // insertion block, even if switched off
  lonely: { enabled: true, database: { sql: { enabled: true } } },                    // SQL but no insertion block
  offline: { enabled: true, database: { sql: { enabled: false } }, insertion: {} },   // SQL disabled
  tiktok: { enabled: true, database: { sql: { enabled: true } }, insertion: { enabled: true } },
};
const allConnected = () => ({});

describe("networks > defaultNetworks", () => {
  it("is every network with SQL enabled and an insertion block, in config order", () => {
    expect(defaultNetworks(allConnected, fakeConfig)).toEqual(["facebook", "reddit", "tiktok"]);
  });

  it("leaves out a network whose database is not connected", () => {
    expect(defaultNetworks((slug) => (slug === "facebook" ? null : {}), fakeConfig)).toEqual(["reddit", "tiktok"]);
  });

  it("picks up a network added to the config with no code change", () => {
    const more = { ...fakeConfig, newnet: { enabled: true, database: { sql: { enabled: true } }, insertion: { enabled: true } } };
    expect(defaultNetworks(allConnected, more)).toContain("newnet");
  });

  it("is empty (not a crash) for an empty, missing or malformed config", () => {
    expect(defaultNetworks(allConnected, {})).toEqual([]);
    expect(defaultNetworks(allConnected, null === undefined ? {} : { a: null, b: undefined, c: 5 })).toEqual([]);
  });

  it("with the real config, returns only networks that have SQL enabled and an insertion block", () => {
    const real = require("../../../src/config/networks");
    const list = defaultNetworks(allConnected);
    expect(list.length).toBeGreaterThan(0);
    for (const slug of list) {
      expect(real[slug].database.sql.enabled).toBe(true);
      expect(real[slug].insertion).toBeTruthy();
    }
  });
});

describe("networks > used for the 'all' fan-out when nothing is configured", () => {
  it("add() writes an 'all' entry into every default network that is connected", async () => {
    const repository = {
      upsertEntries: vi.fn(async () => ({ affected: 1 })),
      findIds: vi.fn(async () => new Map()),
    };
    // enforcement off, no explicit networks: the list is derived from the networks config
    const connected = new Set(["facebook", "reddit"]);
    const service = new BlocklistService({
      config: makeConfig({ enabled: false, networks: [] }),
      repository,
      getSql: (slug) => (connected.has(slug) ? { db: slug } : null),
      log: { info() {}, warn() {}, error() {} },
    });
    const out = await service.add([{ entryType: "ad_id", value: "1", addedBy: "t" }]);
    const written = out.results.map((r) => r.network);
    expect(written.sort()).toEqual(["facebook", "reddit"]);
  });

  it("an explicit networks list still wins", async () => {
    const repository = { upsertEntries: vi.fn(async () => ({ affected: 1 })), findIds: vi.fn(async () => new Map()) };
    const service = new BlocklistService({
      config: makeConfig({ enabled: false, networks: ["quora"] }),
      repository,
      getSql: () => ({}),
      log: { info() {}, warn() {}, error() {} },
    });
    const out = await service.add([{ entryType: "ad_id", value: "1", addedBy: "t" }]);
    expect(out.results.map((r) => r.network)).toEqual(["quora"]);
  });
});

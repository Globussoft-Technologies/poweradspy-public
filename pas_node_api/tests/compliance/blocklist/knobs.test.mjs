import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { makeConfig } from "./helpers.mjs";

const { BlocklistCache } = require("../../../src/compliance/blocklist/cache");
const { BlocklistService } = require("../../../src/compliance/blocklist/service");
const { buildSnapshot } = require("../../../src/compliance/blocklist/match");
const { extract, resolveFields } = require("../../../src/compliance/blocklist/extract");
const { STATUS } = require("../../../src/compliance/blocklist/constants");

// The three values that used to be hardcoded now come from compliance.blocklist in config.json.

afterEach(() => { vi.restoreAllMocks(); });

const log = () => ({ info() {}, warn: vi.fn(), error() {} });

describe("knobs > refreshJitterPercent", () => {
  const cache = (over) => new BlocklistCache({ repository: {}, getSql: () => ({}), config: makeConfig(over), log: log() });

  it("adds a random 0..percent of the refresh period, never less than the period", () => {
    const base = 30 * 1000;
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(cache({ refreshJitterPercent: 20 }).intervalMs()).toBe(base + base * 0.1);
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(cache({ refreshJitterPercent: 20 }).intervalMs()).toBe(base);
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const high = cache({ refreshJitterPercent: 50 }).intervalMs();
    expect(high).toBeGreaterThan(base);
    expect(high).toBeLessThan(base * 1.5);
  });

  it("0 means no jitter, and a missing or invalid value also means none (never NaN, which would hammer the database)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const base = 30 * 1000;
    expect(cache({ refreshJitterPercent: 0 }).intervalMs()).toBe(base);
    for (const bad of [undefined, null, "abc", NaN, -5]) {
      const c = new BlocklistCache({ repository: {}, getSql: () => ({}), config: { ...makeConfig({}), refreshJitterPercent: bad }, log: log() });
      const ms = c.intervalMs();
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBe(base);
    }
  });

  it("follows refreshSeconds", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(cache({ refreshSeconds: 90 }).intervalMs()).toBe(90 * 1000);
  });
});

describe("knobs > openWarnSeconds", () => {
  function openService(over) {
    const config = makeConfig({ failMode: "open", ...over });
    const state = { status: STATUS.UNAVAILABLE, snapshot: null };
    const cache = { networks: ["reddit"], manages: () => true, get: () => state, summary: () => ({}) };
    const l = log();
    return { service: new BlocklistService({ config, cache, log: l }), warn: l.warn };
  }

  it("logs 'ads are NOT being checked' at most once per configured window, per network", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { service, warn } = openService({ openWarnSeconds: 10 });
    service.guard({ ad_id: "1" }, "reddit");
    expect(warn).toHaveBeenCalledTimes(1);
    now += 5_000;
    service.guard({ ad_id: "2" }, "reddit");
    expect(warn).toHaveBeenCalledTimes(1);   // still inside the 10 s window
    now += 6_000;
    service.guard({ ad_id: "3" }, "reddit");
    expect(warn).toHaveBeenCalledTimes(2);   // 11 s later: warns again
  });

  it("a different window is honoured", () => {
    let now = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { service, warn } = openService({ openWarnSeconds: 300 });
    service.guard({ ad_id: "1" }, "reddit");
    now += 120_000;
    service.guard({ ad_id: "2" }, "reddit");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to 60 s when the setting is missing from the config object", () => {
    let now = 9_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { service, warn } = openService({});
    delete service.config.openWarnSeconds;
    service.guard({ ad_id: "1" }, "reddit");
    now += 59_000;
    service.guard({ ad_id: "2" }, "reddit");
    expect(warn).toHaveBeenCalledTimes(1);
    now += 2_000;
    service.guard({ ad_id: "3" }, "reddit");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("knobs > maxUrlsPerAd", () => {
  const fields = resolveFields("reddit", {});
  const carousel = (n) => ({ other_multimedia: Array.from({ length: n }, (_, i) => `https://x.com/${i}.jpg`).join("||") });

  it("cuts the URLs checked from one ad at the configured limit", () => {
    expect(extract(carousel(10), fields, 3).urls).toHaveLength(3);
    expect(extract(carousel(10), fields, 100).urls).toHaveLength(10);
  });

  it("uses a safe limit when none is given or the value is invalid", () => {
    for (const bad of [undefined, null, 0, -1, 1.5, "3", NaN]) {
      expect(extract(carousel(500), fields, bad).urls).toHaveLength(200);
    }
  });

  it("through the service: a blocked URL beyond the limit is not seen, within it is", () => {
    const rows = [{ id: 1, entry_type: "url", value: "https://x.com/7.jpg" }];
    const make = (maxUrlsPerAd) => {
      const state = { status: STATUS.READY, snapshot: buildSnapshot(rows) };
      const cache = { networks: ["reddit"], manages: () => true, get: () => state, summary: () => ({}) };
      return new BlocklistService({ config: makeConfig({ maxUrlsPerAd }), cache, log: log() });
    };
    expect(make(5).guard(carousel(10), "reddit")).toBeNull();                       // url #7 is past the limit
    expect(make(10).guard(carousel(10), "reddit")).toMatchObject({ code: 422 });    // inside the limit
  });
});

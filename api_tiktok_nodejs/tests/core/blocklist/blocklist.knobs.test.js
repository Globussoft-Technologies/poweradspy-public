import { describe, it, expect, vi, afterEach } from "vitest";
import { BlocklistCache } from "../../../core/blocklist/blocklist.cache.js";
import { Blocklist, buildSettings } from "../../../core/blocklist/blocklist.service.js";
import { extract, resolveFields } from "../../../core/blocklist/blocklist.extract.js";
import { buildSnapshot } from "../../../core/blocklist/blocklist.match.js";
import { STATUS } from "../../../core/blocklist/blocklist.constants.js";

// The three values that used to be hardcoded now come from compliance.blocklist in the config.

afterEach(() => { vi.restoreAllMocks(); });
const log = () => ({ info() {}, warn: vi.fn(), error() {} });

describe("knobs > settings", () => {
  it("default to the values the code used to hardcode, and are clamped", () => {
    expect(buildSettings(undefined, {})).toMatchObject({ refreshJitterPercent: 20, openWarnSeconds: 60, maxUrlsPerAd: 200 });
    expect(buildSettings({ refreshJitterPercent: 0, openWarnSeconds: 120, maxUrlsPerAd: 50 }))
      .toMatchObject({ refreshJitterPercent: 0, openWarnSeconds: 120, maxUrlsPerAd: 50 });
    expect(buildSettings({ refreshJitterPercent: 500, openWarnSeconds: 1, maxUrlsPerAd: 0 }))
      .toMatchObject({ refreshJitterPercent: 50, openWarnSeconds: 5, maxUrlsPerAd: 1 });
    expect(buildSettings({ refreshJitterPercent: "x", openWarnSeconds: null, maxUrlsPerAd: {} }))
      .toMatchObject({ refreshJitterPercent: 20, openWarnSeconds: 60, maxUrlsPerAd: 200 });
  });
});

describe("knobs > refreshJitterPercent", () => {
  const cache = (over) => new BlocklistCache({ repository: {}, config: { ...buildSettings({ enabled: true }), ...over }, log: log() });

  it("adds a random 0..percent of the refresh period, never less than the period", () => {
    const base = 30 * 1000;
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(cache({ refreshJitterPercent: 20 }).intervalMs()).toBe(base + base * 0.1);
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(cache({ refreshJitterPercent: 20 }).intervalMs()).toBe(base);
  });

  it("0, missing or invalid means no jitter (never NaN, which would hammer the database)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    for (const bad of [0, undefined, null, "abc", NaN, -5]) {
      const ms = cache({ refreshJitterPercent: bad }).intervalMs();
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBe(30 * 1000);
    }
  });
});

describe("knobs > openWarnSeconds", () => {
  it("logs 'ads are NOT being checked' at most once per configured window", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const l = log();
    const state = { status: STATUS.UNAVAILABLE, snapshot: null };
    const bl = new Blocklist({ config: buildSettings({ enabled: true, failMode: "open", openWarnSeconds: 10 }), cache: { get: () => state, summary: () => ({}) }, log: l });
    bl.guard({ ad_id: "1" });
    now += 5_000;
    bl.guard({ ad_id: "2" });
    expect(l.warn).toHaveBeenCalledTimes(1);
    now += 6_000;
    bl.guard({ ad_id: "3" });
    expect(l.warn).toHaveBeenCalledTimes(2);
  });
});

describe("knobs > maxUrlsPerAd", () => {
  const fields = resolveFields({ listUrls: ["other_multimedia"] });
  const carousel = (n) => ({ other_multimedia: Array.from({ length: n }, (_, i) => `https://x.com/${i}.jpg`).join("||") });

  it("cuts the URLs checked from one ad at the configured limit, with a safe fallback", () => {
    expect(extract(carousel(10), fields, 3).urls).toHaveLength(3);
    expect(extract(carousel(10), fields, 100).urls).toHaveLength(10);
    for (const bad of [undefined, null, 0, -1, 1.5, "3", NaN]) expect(extract(carousel(500), fields, bad).urls).toHaveLength(200);
  });

  it("through the check: a blocked URL beyond the limit is not seen, within it is", () => {
    const rows = [{ id: 1, entry_type: "url", value: "https://x.com/7.jpg" }];
    const make = (maxUrlsPerAd) => {
      const state = { status: STATUS.READY, snapshot: buildSnapshot(rows) };
      const config = buildSettings({ enabled: true, maxUrlsPerAd, fields: { listUrls: ["other_multimedia"] } });
      return new Blocklist({ config, cache: { get: () => state, summary: () => ({}) }, log: log() });
    };
    expect(make(5).guard(carousel(10))).toBeNull();
    expect(make(10).guard(carousel(10))).toMatchObject({ statusCode: 422 });
  });
});

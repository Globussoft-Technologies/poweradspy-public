import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const axiosPath = require.resolve("axios");
const axiosGetSpy = vi.fn();
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { get: axiosGetSpy },
};

let mod;
beforeEach(() => {
  // Re-import so _ipCache starts empty each test
  const sutPath = require.resolve("../../src/utils/geoip");
  delete require.cache[sutPath];
  mod = require("../../src/utils/geoip");
  axiosGetSpy.mockReset();
});

describe("utils/geoip > getClientIp", () => {
  it("prefers cf-connecting-ip", () => {
    expect(mod.getClientIp({ headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" } })).toBe("1.1.1.1");
  });

  it("falls back to first IP of x-forwarded-for (comma-separated)", () => {
    expect(mod.getClientIp({ headers: { "x-forwarded-for": "3.3.3.3, 4.4.4.4" } })).toBe("3.3.3.3");
  });

  it("falls back to x-real-ip", () => {
    expect(mod.getClientIp({ headers: { "x-real-ip": "5.5.5.5" } })).toBe("5.5.5.5");
  });

  it("falls back to req.ip", () => {
    expect(mod.getClientIp({ headers: {}, ip: "6.6.6.6" })).toBe("6.6.6.6");
  });

  it("returns null when nothing available", () => {
    expect(mod.getClientIp({ headers: {} })).toBeNull();
  });
});

describe("utils/geoip > detectCountry + getCountryName", () => {
  it("returns full country name from cf-ipcountry", () => {
    const out = mod.detectCountry({ headers: { "cf-ipcountry": "IN" } });
    expect(out).toBe("India");
  });

  it("falls back to x-country-code when cf-ipcountry is 'XX' (anonymous)", () => {
    const out = mod.detectCountry({ headers: { "cf-ipcountry": "XX", "x-country-code": "US" } });
    expect(out).toBe("United States");
  });

  it("falls back to x-country-code when cf-ipcountry is 'T1' (Tor)", () => {
    const out = mod.detectCountry({ headers: { "cf-ipcountry": "T1", "x-country-code": "FR" } });
    expect(out).toBe("France");
  });

  it("falls back to x-geoip-country", () => {
    const out = mod.detectCountry({ headers: { "x-geoip-country": "DE" } });
    expect(out).toBe("Germany");
  });

  it("returns null when no country header present", () => {
    expect(mod.detectCountry({ headers: {} })).toBeNull();
  });

  it("getCountryName returns null for falsy code", () => {
    expect(mod.detectCountry({ headers: { "x-country-code": "" } })).toBeNull();
  });

  it("getCountryName falls back to raw code when Intl throws (invalid code)", () => {
    // Use an obviously-invalid region code so Intl.DisplayNames throws.
    const out = mod.detectCountry({ headers: { "x-country-code": "ZZZ" } });
    expect(out).toBe("ZZZ");
  });
});

describe("utils/geoip > getLocation", () => {
  it("returns null when no IP", async () => {
    expect(await mod.getLocation()).toBeNull();
    expect(axiosGetSpy).not.toHaveBeenCalled();
  });

  it("fetches and caches country from ip-api.com", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { country: "India" } });
    const out = await mod.getLocation("8.8.8.8");
    expect(out).toBe("India");
    // Second call hits cache, no extra HTTP
    const out2 = await mod.getLocation("8.8.8.8");
    expect(out2).toBe("India");
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
  });

  it("missing data.country → null fallback (line 69 `|| null`)", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: {} });
    expect(await mod.getLocation("9.9.9.9")).toBeNull();
  });

  it("axios throws → cached null returned + future calls also null without retry", async () => {
    axiosGetSpy.mockRejectedValueOnce(new Error("timeout"));
    expect(await mod.getLocation("7.7.7.7")).toBeNull();
    // Second call hits the cached null without calling axios
    expect(await mod.getLocation("7.7.7.7")).toBeNull();
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
  });

  it("evicts oldest entry when cache exceeds IP_CACHE_MAX (10000)", async () => {
    // Fill cache past 10000 entries
    axiosGetSpy.mockImplementation(async (url) => {
      const m = url.match(/json\/(\S+)/);
      return { data: { country: `c-${m[1]}` } };
    });
    for (let i = 0; i < 10001; i++) {
      await mod.getLocation(`ip-${i}`);
    }
    // First-inserted should have been evicted; re-querying it triggers a new
    // axios call (vs the cached path used by the most recent entries)
    const callsBefore = axiosGetSpy.mock.calls.length;
    await mod.getLocation("ip-0");
    expect(axiosGetSpy.mock.calls.length).toBe(callsBefore + 1);
  });
});

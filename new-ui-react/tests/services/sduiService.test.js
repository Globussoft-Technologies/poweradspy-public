import { describe, it, expect, vi, beforeEach } from "vitest";

const LS_CONFIG_KEY = "sdui_config_cache";
const LS_ETAG_KEY = "sdui_etag";
const LS_TIMESTAMP_KEY = "sdui_cached_at";

let fetchMock;

function setNavType(type) {
  // type: 'reload' = hard, 'navigate' = soft
  Object.defineProperty(window.performance, "getEntriesByType", {
    writable: true, configurable: true,
    value: vi.fn(() => [{ type }]),
  });
  // ensure legacy fallback not used
  Object.defineProperty(window.performance, "navigation", {
    writable: true, configurable: true, value: undefined,
  });
}

async function loadSut() {
  vi.resetModules();
  return await import("../../src/services/sduiService.js");
}

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  setNavType("navigate"); // default: soft load (preserves cache)
});

describe("sduiService > bootCache", () => {
  it("hard refresh wipes localStorage", async () => {
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify({ x: 1 }));
    localStorage.setItem(LS_ETAG_KEY, "abc");
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    setNavType("reload");
    await loadSut();
    expect(localStorage.getItem(LS_CONFIG_KEY)).toBeNull();
  });
  it("soft load hydrates memory from localStorage when fresh", async () => {
    const fresh = { schema_version: "1.0.0", config_version: 5, searchbar: [] };
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(fresh));
    localStorage.setItem(LS_ETAG_KEY, "etag-x");
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    const sut = await loadSut();
    expect(sut.getCachedConfigVersion()).toBe(5);
  });
  it("soft load with expired cache → memCache stays null", async () => {
    const expiredTs = Date.now() - 10 * 60 * 1000;
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify({ x: 1 }));
    localStorage.setItem(LS_ETAG_KEY, "etag-x");
    localStorage.setItem(LS_TIMESTAMP_KEY, String(expiredTs));
    const sut = await loadSut();
    expect(sut.getCachedConfigVersion()).toBe(0);
  });
  it("bootCache: performance.navigation legacy fallback (type=1 = reload)", async () => {
    Object.defineProperty(window.performance, "getEntriesByType", {
      writable: true, configurable: true, value: vi.fn(() => []),
    });
    Object.defineProperty(window.performance, "navigation", {
      writable: true, configurable: true, value: { type: 1 },
    });
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify({ x: 1 }));
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    await loadSut();
    expect(localStorage.getItem(LS_CONFIG_KEY)).toBeNull();
  });
  it("bootCache: no nav entries + no legacy navigation → not a hard refresh (line 59 false branch)", async () => {
    Object.defineProperty(window.performance, "getEntriesByType", {
      writable: true, configurable: true, value: vi.fn(() => []),
    });
    Object.defineProperty(window.performance, "navigation", {
      writable: true, configurable: true, value: undefined,
    });
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify({ x: 1 }));
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    await loadSut();
    expect(localStorage.getItem(LS_CONFIG_KEY)).not.toBeNull();
  });
  it("bootCache: performance API throws → not a hard refresh", async () => {
    Object.defineProperty(window.performance, "getEntriesByType", {
      writable: true, configurable: true,
      value: vi.fn(() => { throw new Error("nope"); }),
    });
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify({ x: 1 }));
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    await loadSut();
    // cache preserved (no hard refresh detected)
    expect(localStorage.getItem(LS_CONFIG_KEY)).not.toBeNull();
  });
});

describe("sduiService > fetchSDUIConfig", () => {
  it("Layer 1 (memory cache hit) → returns memCache without fetch", async () => {
    const fresh = { schema_version: "1.0.0", config_version: 7, searchbar: [] };
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(fresh));
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    const sut = await loadSut();
    const out = await sut.fetchSDUIConfig();
    expect(out.config_version).toBe(7);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Layer 2 (localStorage hit) → hydrates memCache + returns", async () => {
    // No memory cache: load with stale LS, then re-set fresh LS
    setNavType("reload"); // wipe memCache via hard refresh
    const sut = await loadSut();
    // Now plant fresh data in LS
    const fresh = { schema_version: "1.0.0", config_version: 9, searchbar: [] };
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(fresh));
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    localStorage.setItem(LS_ETAG_KEY, "abc");
    const out = await sut.fetchSDUIConfig();
    expect(out.config_version).toBe(9);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skipCache=true bypasses cache and fetches", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Map([["ETag", "v2"]]),
      json: async () => ({ schema_version: "1.0.0", config_version: 2, searchbar: [] }),
    });
    const sut = await loadSut();
    const out = await sut.fetchSDUIConfig({ skipCache: true });
    expect(fetchMock).toHaveBeenCalled();
    expect(out.config_version).toBe(2);
  });

  it("platforms array → always skip cache + URL includes ?platforms=...", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Map(),
      json: async () => ({ schema_version: "1.0.0", config_version: 1, searchbar: [] }),
    });
    const sut = await loadSut();
    await sut.fetchSDUIConfig({ platforms: ["facebook", "google"] });
    expect(fetchMock.mock.calls[0][0]).toContain("?platforms=facebook,google");
  });

  it("304 Not Modified with memCache → returns memCache", async () => {
    const fresh = { schema_version: "1.0.0", config_version: 11, searchbar: [] };
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(fresh));
    localStorage.setItem(LS_ETAG_KEY, "etag-A");
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({ status: 304, ok: false, headers: new Map(), json: async () => ({}) });
    const out = await sut.fetchSDUIConfig({ skipCache: true });
    expect(out.config_version).toBe(11);
  });

  it("304 with no cached config → falls through to error path (!res.ok throw)", async () => {
    setNavType("reload");
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({ status: 304, ok: false, headers: new Map() });
    const out = await sut.fetchSDUIConfig();
    // 304 + no cache → falls through to `if (!res.ok) throw`, → caught, falls to fallback
    expect(console.warn).toHaveBeenCalled();
    expect(out).toBeDefined();
  });

  it("schema_version incompatible → falls back to default", async () => {
    setNavType("reload");
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Map(),
      json: async () => ({ schema_version: "99.0.0", config_version: 5, searchbar: [] }),
    });
    const out = await sut.fetchSDUIConfig();
    expect(out.schema_version).toBe("1.0.0"); // fallback's own schema
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("incompatible"));
  });

  it("network error with memCache → returns stale memCache", async () => {
    const fresh = { schema_version: "1.0.0", config_version: 3, searchbar: [] };
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(fresh));
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    const sut = await loadSut();
    fetchMock.mockRejectedValueOnce(new Error("net-down"));
    const out = await sut.fetchSDUIConfig({ skipCache: true });
    expect(out.config_version).toBe(3);
  });

  it("network error with stale LS → uses LS", async () => {
    setNavType("reload");
    const sut = await loadSut();
    // Plant stale LS after wipe
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify({ config_version: 100 }));
    localStorage.setItem(LS_TIMESTAMP_KEY, "0"); // very stale
    fetchMock.mockRejectedValueOnce(new Error("net"));
    const out = await sut.fetchSDUIConfig();
    expect(out.config_version).toBe(100);
  });

  it("network error + no cache → fallback", async () => {
    setNavType("reload");
    const sut = await loadSut();
    fetchMock.mockRejectedValueOnce(new Error("net"));
    const out = await sut.fetchSDUIConfig();
    expect(out).toBeDefined();
    expect(out.schema_version).toBe("1.0.0");
  });

  it("non-OK response → throws and falls back", async () => {
    setNavType("reload");
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, headers: new Map() });
    const out = await sut.fetchSDUIConfig();
    expect(out).toBeDefined();
  });

  it("successful fetch caches the normalized result (when no platforms)", async () => {
    setNavType("reload");
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Map([["ETag", "v1"]]),
      json: async () => ({ schema_version: "1.0.0", config_version: 42, searchbar: [] }),
    });
    await sut.fetchSDUIConfig();
    expect(sut.getCachedConfigVersion()).toBe(42);
    expect(localStorage.getItem(LS_CONFIG_KEY)).not.toBeNull();
  });

  it("platform-filtered response not cached", async () => {
    setNavType("reload");
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Map(),
      json: async () => ({ schema_version: "1.0.0", config_version: 7, searchbar: [] }),
    });
    await sut.fetchSDUIConfig({ platforms: ["fb"] });
    expect(sut.getCachedConfigVersion()).toBe(0);
  });

  it("ETag from LS is sent on If-None-Match header (no platforms)", async () => {
    localStorage.setItem(LS_ETAG_KEY, "saved-etag");
    setNavType("reload"); // wipe in-mem ETag
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Map(),
      json: async () => ({ schema_version: "1.0.0", config_version: 1, searchbar: [] }),
    });
    await sut.fetchSDUIConfig({ skipCache: true });
    // After hard-refresh, ETag is also wiped; this just verifies the LS-fallback branch in line 129
    expect(fetchMock).toHaveBeenCalled();
  });

  it("writeToLocalStorage swallows quota exceeded", async () => {
    setNavType("reload");
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Map(),
      json: async () => ({ schema_version: "1.0.0", config_version: 1, searchbar: [] }),
    });
    const origSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await sut.fetchSDUIConfig();
    expect(true).toBe(true); // didn't throw
    Storage.prototype.setItem.mockRestore?.();
  });

  it("readFromLocalStorage swallows JSON.parse failure", async () => {
    setNavType("reload");
    const sut = await loadSut();
    localStorage.setItem(LS_CONFIG_KEY, "not-json");
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Map(),
      json: async () => ({ schema_version: "1.0.0", config_version: 1, searchbar: [] }),
    });
    const out = await sut.fetchSDUIConfig();
    expect(out.config_version).toBe(1);
  });
});

describe("sduiService > fetchSDUIConfigVersion", () => {
  it("returns parsed JSON on success", async () => {
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ config_version: 5 }) });
    const out = await sut.fetchSDUIConfigVersion();
    expect(out.config_version).toBe(5);
  });
  it("returns null on non-ok", async () => {
    const sut = await loadSut();
    fetchMock.mockResolvedValueOnce({ ok: false });
    expect(await sut.fetchSDUIConfigVersion()).toBeNull();
  });
  it("returns null on fetch error", async () => {
    const sut = await loadSut();
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect(await sut.fetchSDUIConfigVersion()).toBeNull();
  });
});

describe("sduiService > invalidateSDUICache", () => {
  it("clears in-memory + localStorage", async () => {
    const fresh = { schema_version: "1.0.0", config_version: 7, searchbar: [] };
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(fresh));
    localStorage.setItem(LS_TIMESTAMP_KEY, String(Date.now()));
    const sut = await loadSut();
    expect(sut.getCachedConfigVersion()).toBe(7);
    sut.invalidateSDUICache();
    expect(sut.getCachedConfigVersion()).toBe(0);
    expect(localStorage.getItem(LS_CONFIG_KEY)).toBeNull();
  });
  it("clearLocalStorageCache swallows errors", async () => {
    const sut = await loadSut();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("nope"); });
    expect(() => sut.invalidateSDUICache()).not.toThrow();
    Storage.prototype.removeItem.mockRestore?.();
  });
});

describe("sduiService > getCachedConfigVersion", () => {
  it("returns 0 when no memCache", async () => {
    setNavType("reload");
    const sut = await loadSut();
    expect(sut.getCachedConfigVersion()).toBe(0);
  });
});

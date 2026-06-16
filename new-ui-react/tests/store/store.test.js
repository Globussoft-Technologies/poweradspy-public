import { describe, it, expect, vi, beforeEach } from "vitest";

// Pre-mock redux-persist to avoid actual side effects + simplify
vi.mock("redux-persist", async () => {
  const actual = await vi.importActual("redux-persist");
  return {
    ...actual,
    persistStore: vi.fn((store) => ({ store, purge: vi.fn() })),
  };
});

async function loadStoreWithLocation(url, lsContent) {
  vi.resetModules();
  Object.defineProperty(window, "location", {
    writable: true, configurable: true,
    value: { ...window.location, search: url, href: `http://x${url}` },
  });
  if (lsContent !== undefined) localStorage.setItem("persist:root", lsContent);
  return await import("../../src/store/store.js");
}

beforeEach(() => {
  localStorage.clear();
});

describe("store/store > URL-strip behavior at import time", () => {
  it("no advertiser query → localStorage untouched", async () => {
    await loadStoreWithLocation("", JSON.stringify({ activePage: '"saved"' }));
    expect(JSON.parse(localStorage.getItem("persist:root")).activePage).toBe('"saved"');
  });
  it("advertiser query present → activePage reset to 'ads'", async () => {
    await loadStoreWithLocation(
      "?advertiser=AcmeBrand",
      JSON.stringify({ activePage: '"saved"', showSavedAdsPage: "true" }),
    );
    const after = JSON.parse(localStorage.getItem("persist:root"));
    expect(after.activePage).toBe('"ads"');
    expect(after.showSavedAdsPage).toBe("false");
  });
  it("advertiser query but no persisted state → no-op (try/catch swallows)", async () => {
    await loadStoreWithLocation("?advertiser=Foo");
    expect(localStorage.getItem("persist:root")).toBeNull();
  });
  it("advertiser query + malformed persisted JSON → catch swallows", async () => {
    await loadStoreWithLocation("?advertiser=Foo", "not-valid-json");
    // No throw; the malformed value remains
    expect(localStorage.getItem("persist:root")).toBe("not-valid-json");
  });
});

describe("store/store > one-time activeTab cleanup at import time", () => {
  it("strips stale activeTab from persist:root (lines 28-30)", async () => {
    await loadStoreWithLocation(
      "",
      JSON.stringify({ activeTab: '"Newest"', activePage: '"ads"' }),
    );
    const after = JSON.parse(localStorage.getItem("persist:root"));
    expect("activeTab" in after).toBe(false);
    expect(after.activePage).toBe('"ads"');
  });
  it("no activeTab present → persist:root untouched (28 else)", async () => {
    await loadStoreWithLocation("", JSON.stringify({ activePage: '"ads"' }));
    const after = JSON.parse(localStorage.getItem("persist:root"));
    expect(after).toEqual({ activePage: '"ads"' });
  });
});

describe("store/store > exports", () => {
  it("exports store with ui reducer + dispatch/getState", async () => {
    const mod = await loadStoreWithLocation("");
    expect(mod.store).toBeDefined();
    expect(typeof mod.store.dispatch).toBe("function");
    expect(typeof mod.store.getState).toBe("function");
    expect(mod.store.getState().ui).toBeDefined();
  });
  it("exports persistor", async () => {
    const mod = await loadStoreWithLocation("");
    expect(mod.persistor).toBeDefined();
  });
});

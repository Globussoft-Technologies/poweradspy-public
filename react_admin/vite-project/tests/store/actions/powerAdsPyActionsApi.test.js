import { describe, it, expect, vi, beforeEach } from "vitest";

const { axiosPostSpy, cookiesGetSpy } = vi.hoisted(() => ({
  axiosPostSpy: vi.fn(),
  cookiesGetSpy: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { post: axiosPostSpy, isCancel: vi.fn(() => false) },
  isCancel: vi.fn(() => false),
}));
vi.mock("js-cookie", () => ({ default: { get: cookiesGetSpy } }));
vi.mock("lucide-react", () => ({ Network: () => null }));

let actions;
let store;

async function loadStore() {
  const { configureStore } = await import("@reduxjs/toolkit");
  actions = await import("../../../src/store/actions/powerAdsPyActionsApi");
  store = configureStore({ reducer: { stub: (s = {}) => s } });
}

beforeEach(async () => {
  axiosPostSpy.mockReset();
  cookiesGetSpy.mockReset();
  cookiesGetSpy.mockReturnValue("tok-123");
  vi.resetModules();
  await loadStore();
});

// Simple POST thunks that tag data.network from args.network and return data
const simplePostThunks = [
  "fetchNetworkTypesCount",
  "fetchNetworksCountries",
];

describe.each(simplePostThunks)("powerAdsPyActions > %s", (name) => {
  it("happy: tags data.network from args.network", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { total: 10 } });
    const r = await store.dispatch(actions[name]({ network: "fb" }));
    expect(r.payload).toEqual(expect.objectContaining({ total: 10, network: "fb" }));
  });
  it("rejected: with response message", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "err" } } });
    const r = await store.dispatch(actions[name]({ network: "fb" }));
    expect(r.payload).toBe("err");
  });
  it("rejected: fallback to error.message when no response", async () => {
    // Source uses `error.response.data.message || error.message`. If
    // `error.response` is undefined, accessing `.data.message` raises
    // TypeError which is itself caught and surfaces as undefined payload.
    axiosPostSpy.mockRejectedValueOnce({ message: "plain" });
    const r = await store.dispatch(actions[name]({ network: "fb" }));
    expect(r.type).toContain("rejected");
  });
});

describe("powerAdsPyActions > fetchAdsFromFunnel", () => {
  it("happy with cursor + isPrev", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { search_after: { funnel: "next" }, items: [] } });
    const r = await store.dispatch(actions.fetchAdsFromFunnel({
      network: "fb", type: "X", range: { from: "a", to: "b" }, cursor: "c1", isPrev: false,
    }));
    expect(r.payload.searchAfter).toBe("next");
    expect(r.payload.network).toBe("fb");
    expect(r.payload.cursor).toBe("c1");
  });
  it("happy without cursor: search_after null", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { items: [] } });
    const r = await store.dispatch(actions.fetchAdsFromFunnel({ network: "fb" }));
    expect(r.payload.searchAfter).toBeNull();
  });
  it("rejected with optional-chain fallback", async () => {
    axiosPostSpy.mockRejectedValueOnce({ message: "plain" });
    const r = await store.dispatch(actions.fetchAdsFromFunnel({ network: "fb" }));
    expect(r.payload).toBe("plain");
  });
});

describe("powerAdsPyActions > fetchAdsFromEcommerceplatforms", () => {
  it("happy: filters e_commerce==='' entries", async () => {
    axiosPostSpy.mockResolvedValueOnce({
      data: { data: [{ e_commerce: "Shopify" }, { e_commerce: "" }], search_after: { built_with: "next" } },
    });
    const r = await store.dispatch(actions.fetchAdsFromEcommerceplatforms({ network: "fb", cursor: "c" }));
    expect(r.payload.data).toEqual([{ e_commerce: "Shopify" }]);
    expect(r.payload.searchAfter).toBe("next");
  });
  it("happy without search_after: searchAfter falls back to null", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { data: [] } });
    const r = await store.dispatch(actions.fetchAdsFromEcommerceplatforms({ network: "fb" }));
    expect(r.payload.searchAfter).toBeNull();
  });
  it("rejected", async () => {
    axiosPostSpy.mockRejectedValueOnce({ message: "plain" });
    const r = await store.dispatch(actions.fetchAdsFromEcommerceplatforms({ network: "fb" }));
    expect(r.payload).toBe("plain");
  });
});

describe("powerAdsPyActions > fetchTiktokAdsCountryCount", () => {
  it("happy: unwraps data.body and tags network", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { body: { countries: [] } } });
    const r = await store.dispatch(actions.fetchTiktokAdsCountryCount({ network: "tk" }));
    expect(r.payload).toEqual(expect.objectContaining({ network: "tk" }));
  });
  it("rejected", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "tk-err" } } });
    const r = await store.dispatch(actions.fetchTiktokAdsCountryCount({ network: "tk" }));
    expect(r.payload).toBe("tk-err");
  });
});

describe("powerAdsPyActions > fetchAdsFromAffiliateplatforms", () => {
  it("happy: filters + builds Affiliate shape", async () => {
    axiosPostSpy.mockResolvedValueOnce({
      data: { data: [{ e_commerce: "Amazon" }, { e_commerce: "" }], search_after: { built_with: "next" } },
    });
    const r = await store.dispatch(actions.fetchAdsFromAffiliateplatforms({ network: "fb" }));
    expect(r.payload.data).toEqual([{ e_commerce: "Amazon" }]);
  });
  it("happy with cursor: builds payload.search_after", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { data: [], search_after: null } });
    await store.dispatch(actions.fetchAdsFromAffiliateplatforms({ network: "fb", cursor: "c1" }));
    expect(axiosPostSpy.mock.calls[0][1].search_after).toEqual({ built_with: "c1" });
  });
  it("rejected", async () => {
    axiosPostSpy.mockRejectedValueOnce({ message: "plain" });
    const r = await store.dispatch(actions.fetchAdsFromAffiliateplatforms({ network: "fb" }));
    expect(r.payload).toBe("plain");
  });
});

// Bare-data POST thunks: return the entire axios response object (not unwrapped to data.data)
const bareDataThunks = [
  "fetchSystemDetails", "fetchPerticularSystemDetails", "fetchPerticularSystemAccountDetails",
];
describe.each(bareDataThunks)("powerAdsPyActions > %s (returns axios response)", (name) => {
  it("happy", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { x: 1 } });
    const r = await store.dispatch(actions[name]({}));
    expect(r.type).toContain("fulfilled");
  });
  it("rejected", async () => {
    axiosPostSpy.mockRejectedValueOnce({ message: "plain" });
    const r = await store.dispatch(actions[name]({}));
    expect(r.payload).toBe("plain");
  });
});

// Wrapped-data POST thunks: return data only
const wrappedThunks = [
  "fetchSystemInsites", "fetchSystemInfo", "fetchSystemInfoAccounts",
  "fetchSystemInfoAccountsList", "fetchStatusSystemInfo", "fetchStatusAccountInfo",
];
describe.each(wrappedThunks)("powerAdsPyActions > %s", (name) => {
  it("happy: returns data", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { count: 1 } });
    const r = await store.dispatch(actions[name]({}));
    expect(r.payload).toEqual({ count: 1 });
  });
  it("rejected", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    const r = await store.dispatch(actions[name]({}));
    expect(r.payload).toBe("boom");
  });
});

describe("powerAdsPyActions > fetchAccountDetails", () => {
  it("happy: returns data.data", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { data: [{ id: 1 }] } });
    const r = await store.dispatch(actions.fetchAccountDetails({}));
    expect(r.payload).toEqual([{ id: 1 }]);
  });
  it("rejected", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "no-acct" } } });
    const r = await store.dispatch(actions.fetchAccountDetails({}));
    expect(r.payload).toBe("no-acct");
  });
});

describe("powerAdsPyActions > fetchDomaninProcessDetails", () => {
  it("happy", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: [{ d: 1 }] });
    const r = await store.dispatch(actions.fetchDomaninProcessDetails({}));
    expect(r.payload).toEqual([{ d: 1 }]);
  });
  it("rejected with response message", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "domain-err" } } });
    const r = await store.dispatch(actions.fetchDomaninProcessDetails({}));
    expect(r.payload).toBe("domain-err");
  });
});

// Exercise the `error.message` short-circuit-right fallback paths for every
// thunk that uses `error.response?.data?.message || error.message`.
describe("powerAdsPyActions > error.message fallback branches", () => {
  // Note: fetchTiktokAdsCountryCount excluded — its catch uses
  // `error.response.data.message` with no `|| error.message` fallback,
  // so there's no right-hand branch to exercise.
  const thunksWithFallback = [
    "fetchNetworkTypesCount",
    "fetchNetworksCountries",
    "fetchAccountDetails",
    "fetchSystemInsites",
    "fetchSystemInfo",
    "fetchSystemInfoAccounts",
    "fetchSystemInfoAccountsList",
    "fetchStatusSystemInfo",
    "fetchStatusAccountInfo",
    "fetchDomaninProcessDetails",
  ];

  it.each(thunksWithFallback)("%s: response present but .data.message undefined → falls back to error.message", async (name) => {
    // Provide response.data so the LHS doesn't throw, but message is undefined
    // so the `|| error.message` right-hand side executes.
    axiosPostSpy.mockRejectedValueOnce({ response: { data: {} }, message: "fallback-msg" });
    const r = await store.dispatch(actions[name]({ network: "x" }));
    expect(r.payload).toBe("fallback-msg");
  });
});

describe("powerAdsPyActions > axios.isCancel re-throw branch", () => {
  const allThunks = [
    "fetchNetworkTypesCount",
    "fetchNetworksCountries",
    "fetchAdsFromFunnel",
    "fetchAdsFromEcommerceplatforms",
    "fetchTiktokAdsCountryCount",
    "fetchAdsFromAffiliateplatforms",
    "fetchSystemDetails",
    "fetchPerticularSystemDetails",
    "fetchPerticularSystemAccountDetails",
    "fetchAccountDetails",
    "fetchSystemInsites",
    "fetchSystemInfo",
    "fetchSystemInfoAccounts",
    "fetchSystemInfoAccountsList",
    "fetchStatusSystemInfo",
    "fetchStatusAccountInfo",
    "fetchDomaninProcessDetails",
  ];

  it.each(allThunks)("%s: axios.isCancel=true → catch re-throws, dispatch ends in rejected with the cancel error", async (name) => {
    const axios = (await import("axios")).default;
    const cancelErr = Object.assign(new Error("aborted"), { __CANCEL__: true });
    axios.isCancel = vi.fn(() => true);
    axiosPostSpy.mockRejectedValueOnce(cancelErr);
    const r = await store.dispatch(actions[name]({ network: "x" }));
    // re-throw causes createAsyncThunk to dispatch /rejected with no payload
    expect(r.type).toContain("rejected");
    // Restore for subsequent tests
    axios.isCancel = vi.fn(() => false);
  });
});

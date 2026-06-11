import { describe, it, expect, vi, beforeEach } from "vitest";

// Build fake action creators that mirror createAsyncThunk's pending/fulfilled/rejected shape.
function makeThunk(typePrefix) {
  return {
    pending: { type: `${typePrefix}/pending` },
    fulfilled: { type: `${typePrefix}/fulfilled` },
    rejected: { type: `${typePrefix}/rejected` },
  };
}

vi.mock("../../../src/store/actions/adsgptActions", () => ({
  fetchAdPositionCount: makeThunk("a/fetchAdPositionCount"),
  fetchAdSourceCount: makeThunk("a/fetchAdSourceCount"),
  fetchAdsCount: makeThunk("a/fetchAdsCount"),
  fetchAdsCountMeta: makeThunk("a/fetchAdsCountMeta"),
  fetchAdsCountPython: makeThunk("a/fetchAdsCountPython"),
  fetchAdsCountScroll: makeThunk("a/fetchAdsCountScroll"),
  fetchAdsGraphCount: makeThunk("a/fetchAdsGraphCount"),
  fetchRangeCounts: makeThunk("a/fetchRangeCounts"),
  fetchAllUsers: makeThunk("a/fetchAllUsers"),
  fetchGeneratedMedia: makeThunk("a/fetchGeneratedMedia"),
  fetchTiktokAdsCount: makeThunk("a/fetchTiktokAdsCount"),
  fetchTiktokAdsGraphCount: makeThunk("a/fetchTiktokAdsGraphCount"),
  fetchTotalAdsCount: makeThunk("a/fetchTotalAdsCount"),
  fetchUserDetails: makeThunk("a/fetchUserDetails"),
  fetchUsersStats: makeThunk("a/fetchUsersStats"),
  fetchUserUsageCost: makeThunk("a/fetchUserUsageCost"),
  fetchUsersWithGeneratedMedia: makeThunk("a/fetchUsersWithGeneratedMedia"),
  fetchGeneratedMediaSpendingReport: makeThunk("a/fetchGeneratedMediaSpendingReport"),
}));

let reducer;
let actions;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../../src/store/reducers/adsgpt");
  reducer = mod.default;
  actions = mod;
});

describe("store/reducers/adsgpt", () => {
  it("returns initial state on @@INIT", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(expect.objectContaining({
      loading: false,
      users: [],
      user: {},
      generatedMedia: [],
      generatedMediaPage: 1,
    }));
  });

  it("updateSearchPositionCount sets searchPositionCount", () => {
    const state = reducer(undefined, actions.updateSearchPositionCount(["X"]));
    expect(state.searchPositionCount).toEqual(["X"]);
  });

  it("updateSearchSourceCount sets searchSourceCount", () => {
    const state = reducer(undefined, actions.updateSearchSourceCount(["Y"]));
    expect(state.searchSourceCount).toEqual(["Y"]);
  });

  const thunks = [
    ["a/fetchAllUsers", "users"],
    ["a/fetchUserDetails", "user"],
    ["a/fetchUsersStats", "userStats"],
    ["a/fetchAdsCount", "searchResultCounts"],
    ["a/fetchAdsCountScroll", "searchResultCountsScroll"],
    ["a/fetchAdsCountPython", "searchResultCountsPython"],
    ["a/fetchAdsCountMeta", "searchResultCountsMeta"],
    ["a/fetchAdSourceCount", "searchSourceCount"],
    ["a/fetchAdPositionCount", "searchPositionCount"],
    ["a/fetchAdsGraphCount", "searchAdsCountGraph"],
    ["a/fetchTiktokAdsCount", "searchResultCountsTiktok"],
    ["a/fetchTiktokAdsGraphCount", "searchAdsCountGraph"],
    ["a/fetchUserUsageCost", "userUsageCost"],
    ["a/fetchUsersWithGeneratedMedia", "users"],
    ["a/fetchGeneratedMediaSpendingReport", "spendingReport"],
  ];

  describe.each(thunks)("%s", (typePrefix, field) => {
    it("pending: loading=true", () => {
      const state = reducer(undefined, { type: `${typePrefix}/pending` });
      expect(state.loading).toBe(true);
    });
    it("fulfilled: loading=false, sets target field", () => {
      const state = reducer({ loading: true }, { type: `${typePrefix}/fulfilled`, payload: "PAYLOAD" });
      expect(state.loading).toBe(false);
      expect(state[field]).toBe("PAYLOAD");
    });
    it("rejected: loading=false, error=payload", () => {
      const state = reducer({ loading: true }, { type: `${typePrefix}/rejected`, payload: "ERR" });
      expect(state.loading).toBe(false);
      expect(state.error).toBe("ERR");
    });
  });

  describe("fetchRangeCounts", () => {
    it("pending resets searchResultRangeCounts to null + clears error", () => {
      const s = reducer({ searchResultRangeCounts: { x: 1 }, error: "old" }, { type: "a/fetchRangeCounts/pending" });
      expect(s.searchResultRangeCounts).toBeNull();
      expect(s.loading).toBe(true);
      expect(s.error).toBeNull();
    });
    it("fulfilled stores payload as searchResultRangeCounts", () => {
      const s = reducer(undefined, { type: "a/fetchRangeCounts/fulfilled", payload: { network: "facebook", data: { newCount: 5, activeCount: 50 } } });
      expect(s.loading).toBe(false);
      expect(s.searchResultRangeCounts).toEqual({ network: "facebook", data: { newCount: 5, activeCount: 50 } });
    });
    it("rejected stores payload as error", () => {
      const s = reducer(undefined, { type: "a/fetchRangeCounts/rejected", payload: "rng-err" });
      expect(s.loading).toBe(false);
      expect(s.error).toBe("rng-err");
    });
  });

  describe("fetchTotalAdsCount", () => {
    it("pending resets state to null and clears error", () => {
      const s = reducer({ searchResultTotalAdsCount: [1], error: "old" }, { type: "a/fetchTotalAdsCount/pending" });
      expect(s.searchResultTotalAdsCount).toBeNull();
      expect(s.error).toBeNull();
    });
    it("fulfilled stores payload", () => {
      const s = reducer(undefined, { type: "a/fetchTotalAdsCount/fulfilled", payload: { x: 1 } });
      expect(s.searchResultTotalAdsCount).toEqual({ x: 1 });
    });
    it("rejected stores error", () => {
      const s = reducer(undefined, { type: "a/fetchTotalAdsCount/rejected", payload: "ERR" });
      expect(s.error).toBe("ERR");
    });
  });

  describe("fetchGeneratedMedia", () => {
    it("pending sets loading", () => {
      const s = reducer(undefined, { type: "a/fetchGeneratedMedia/pending" });
      expect(s.loading).toBe(true);
    });
    it("fulfilled page=1 replaces list", () => {
      const s = reducer(undefined, {
        type: "a/fetchGeneratedMedia/fulfilled",
        payload: { data: [{ a: 1 }], page: 1, hasMore: true, spending: { total: 5 } },
      });
      expect(s.generatedMedia).toEqual([{ a: 1 }]);
      expect(s.generatedMediaPage).toBe(1);
      expect(s.generatedMediaHasMore).toBe(true);
      expect(s.userMediaSpending).toEqual({ total: 5 });
    });
    it("fulfilled page>1 appends to existing list", () => {
      const s = reducer({ generatedMedia: [{ a: 1 }], generatedMediaHasMore: false, generatedMediaPage: 1 },
        { type: "a/fetchGeneratedMedia/fulfilled", payload: { data: [{ b: 2 }], page: 2 } });
      expect(s.generatedMedia).toEqual([{ a: 1 }, { b: 2 }]);
      expect(s.generatedMediaPage).toBe(2);
    });
    it("fulfilled with missing payload defaults to empty + page 1", () => {
      const s = reducer(undefined, { type: "a/fetchGeneratedMedia/fulfilled", payload: undefined });
      expect(s.generatedMedia).toEqual([]);
      expect(s.generatedMediaPage).toBe(1);
    });
    it("rejected stores error", () => {
      const s = reducer(undefined, { type: "a/fetchGeneratedMedia/rejected", payload: "err" });
      expect(s.error).toBe("err");
    });
  });
});

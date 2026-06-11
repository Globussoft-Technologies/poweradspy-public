import { describe, it, expect, vi, beforeEach } from "vitest";

const { axiosGetSpy, axiosPostSpy, cookiesGetSpy } = vi.hoisted(() => ({
  axiosGetSpy: vi.fn(),
  axiosPostSpy: vi.fn(),
  cookiesGetSpy: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    get: axiosGetSpy,
    post: axiosPostSpy,
    isCancel: vi.fn(() => false),
  },
  isCancel: vi.fn(() => false),
}));
vi.mock("js-cookie", () => ({
  default: { get: cookiesGetSpy },
}));

let actions;
let store;

async function loadStore() {
  const { configureStore } = await import("@reduxjs/toolkit");
  actions = await import("../../../src/store/actions/adsgptActions");
  // We don't need real reducers — just dispatch + getState. Use a noop reducer.
  store = configureStore({ reducer: { stub: (s = {}) => s } });
}

beforeEach(async () => {
  axiosGetSpy.mockReset();
  axiosPostSpy.mockReset();
  cookiesGetSpy.mockReset();
  cookiesGetSpy.mockReturnValue("tok-123");
  vi.resetModules();
  await loadStore();
});

describe("adsgptActions > fetchAllUsers", () => {
  it("happy: GET with bearer token, returns data.data", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: [{ id: "u1" }] } });
    const r = await store.dispatch(actions.fetchAllUsers());
    expect(r.type).toBe("adsgpt/fetchAllUsers/fulfilled");
    expect(r.payload).toEqual([{ id: "u1" }]);
    expect(axiosGetSpy.mock.calls[0][1].headers.Authorization).toBe("Bearer tok-123");
  });

  it("rejected when no token", async () => {
    cookiesGetSpy.mockReturnValueOnce(undefined);
    axiosGetSpy.mockResolvedValueOnce({ data: {} });
    // 'No authentication token found!' throws inside the try, then catch
    // accesses error.response.data.message — which is undefined since the
    // thrown error isn't an axios error. This raises a TypeError.
    const r = await store.dispatch(actions.fetchAllUsers());
    expect(r.type).toBe("adsgpt/fetchAllUsers/rejected");
  });

  it("rejected: extracts error.response.data.message", async () => {
    axiosGetSpy.mockRejectedValueOnce({ response: { data: { message: "API err" } } });
    const r = await store.dispatch(actions.fetchAllUsers());
    expect(r.type).toBe("adsgpt/fetchAllUsers/rejected");
    expect(r.payload).toBe("API err");
  });
});

describe("adsgptActions > fetchUserDetails", () => {
  it("happy: GET with userid path arg", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: { id: "u1" } } });
    const r = await store.dispatch(actions.fetchUserDetails("u1"));
    expect(r.payload).toEqual({ id: "u1" });
    expect(axiosGetSpy.mock.calls[0][0]).toContain("/get-user-data/u1");
  });
  it("rejected on error", async () => {
    axiosGetSpy.mockRejectedValueOnce({ response: { data: { message: "err" } } });
    const r = await store.dispatch(actions.fetchUserDetails("u1"));
    expect(r.payload).toBe("err");
  });
  it("rejected when no token", async () => {
    cookiesGetSpy.mockReturnValueOnce(undefined);
    const r = await store.dispatch(actions.fetchUserDetails("u1"));
    expect(r.type).toContain("rejected");
  });
});

describe("adsgptActions > fetchUsersStats", () => {
  it("happy", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: { active: 1 } } });
    const r = await store.dispatch(actions.fetchUsersStats());
    expect(r.payload).toEqual({ active: 1 });
  });
  it("rejected", async () => {
    axiosGetSpy.mockRejectedValueOnce({ response: { data: { message: "stats-fail" } } });
    const r = await store.dispatch(actions.fetchUsersStats());
    expect(r.payload).toBe("stats-fail");
  });
  it("rejected when no token", async () => {
    cookiesGetSpy.mockReturnValueOnce(undefined);
    const r = await store.dispatch(actions.fetchUsersStats());
    expect(r.type).toContain("rejected");
  });
});

// fetchAdsCount, fetchAdsCountScroll, fetchAdsCountPython, fetchAdsCountMeta,
// fetchAdSourceCount, fetchAdPositionCount, fetchAdsGraphCount,
// fetchTiktokAdsCount, fetchTiktokAdsGraphCount, fetchTotalAdsCount —
// all POST-based with payload + axios.post pattern.
const postThunks = [
  "fetchAdsCount", "fetchAdsCountScroll", "fetchAdsCountPython", "fetchAdsCountMeta",
  "fetchAdSourceCount", "fetchAdPositionCount", "fetchAdsGraphCount",
];

describe.each(postThunks)("adsgptActions > %s", (name) => {
  it("happy: POST + tags data.network from payload", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { total: 5 } });
    const r = await store.dispatch(actions[name]({ network: "fb" }));
    expect(r.payload).toEqual(expect.objectContaining({ total: 5, network: "fb" }));
  });
  it("rejected", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    const r = await store.dispatch(actions[name]({ network: "fb" }));
    expect(r.payload).toBe("boom");
  });
});

// Tiktok thunks unwrap data.body and tag inside body
const tiktokThunks = ["fetchTiktokAdsCount", "fetchTiktokAdsGraphCount"];

describe.each(tiktokThunks)("adsgptActions > %s", (name) => {
  it("happy: POST + tags data.body.network, returns data.body", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { body: { total: 5 } } });
    const r = await store.dispatch(actions[name]({ network: "tk" }));
    expect(r.payload).toEqual(expect.objectContaining({ total: 5, network: "tk" }));
  });
  it("rejected", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    const r = await store.dispatch(actions[name]({ network: "tk" }));
    expect(r.payload).toBe("boom");
  });
});

describe("adsgptActions > fetchTotalAdsCount", () => {
  it("happy: returns {network, data} shape", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { x: 1 } });
    const r = await store.dispatch(actions.fetchTotalAdsCount({ network: "yt" }));
    expect(r.payload).toEqual({ network: "yt", data: { x: 1 } });
  });
  it("rejected with response message", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "fail" } } });
    const r = await store.dispatch(actions.fetchTotalAdsCount({ network: "yt" }));
    expect(r.payload).toBe("fail");
  });
  it("rejected with no response uses default 'API request failed'", async () => {
    axiosPostSpy.mockRejectedValueOnce(new Error("nope"));
    const r = await store.dispatch(actions.fetchTotalAdsCount({ network: "yt" }));
    expect(r.payload).toBe("API request failed");
  });
});

describe("adsgptActions > fetchGeneratedMedia", () => {
  it("happy: GET with type/page/limit; returns shaped object", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: [{ a: 1 }], hasMore: true, page: 2, spending: { total: 5 } } });
    const r = await store.dispatch(actions.fetchGeneratedMedia({ userId: "u1", type: "image" }));
    expect(r.payload).toEqual({ data: [{ a: 1 }], hasMore: true, page: 2, spending: { total: 5 } });
  });
  it("happy with date range: from+to appended to URL", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: [] } });
    await store.dispatch(actions.fetchGeneratedMedia({ userId: "u1", type: "image", from: "2025-01-01", to: "2025-01-31" }));
    expect(axiosGetSpy.mock.calls[0][0]).toContain("from=2025-01-01");
  });
  it("happy with missing data: defaults to empty", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: {} });
    const r = await store.dispatch(actions.fetchGeneratedMedia({ userId: "u1", type: "image" }));
    expect(r.payload).toEqual({ data: [], hasMore: false, page: 1, spending: null });
  });
  it("rejected with response message", async () => {
    axiosGetSpy.mockRejectedValueOnce({ response: { data: { message: "media-err" } } });
    const r = await store.dispatch(actions.fetchGeneratedMedia({ userId: "u1", type: "image" }));
    expect(r.payload).toBe("media-err");
  });
  it("rejected with no response uses default", async () => {
    axiosGetSpy.mockRejectedValueOnce(new Error("nope"));
    const r = await store.dispatch(actions.fetchGeneratedMedia({ userId: "u1", type: "image" }));
    expect(r.payload).toBe("Failed to fetch generated media");
  });
});

describe("adsgptActions > fetchUsersWithGeneratedMedia", () => {
  it("happy without date range", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: [{ id: "u1" }] } });
    const r = await store.dispatch(actions.fetchUsersWithGeneratedMedia());
    expect(r.payload).toEqual([{ id: "u1" }]);
  });
  it("happy with date range", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: [] } });
    await store.dispatch(actions.fetchUsersWithGeneratedMedia({ from: "2025-01-01", to: "2025-01-31" }));
    expect(axiosGetSpy.mock.calls[0][0]).toContain("from=2025-01-01");
  });
  it("happy: defaults to empty list when data.data missing", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: {} });
    const r = await store.dispatch(actions.fetchUsersWithGeneratedMedia());
    expect(r.payload).toEqual([]);
  });
  it("rejected with response message", async () => {
    axiosGetSpy.mockRejectedValueOnce({ response: { data: { message: "no-users" } } });
    const r = await store.dispatch(actions.fetchUsersWithGeneratedMedia());
    expect(r.payload).toBe("no-users");
  });
  it("rejected fallback message", async () => {
    axiosGetSpy.mockRejectedValueOnce(new Error("nope"));
    const r = await store.dispatch(actions.fetchUsersWithGeneratedMedia());
    expect(r.payload).toBe("Failed to fetch users with media");
  });
  it("rejected when token missing", async () => {
    cookiesGetSpy.mockReturnValueOnce(undefined);
    const r = await store.dispatch(actions.fetchUsersWithGeneratedMedia());
    expect(r.type).toBe("adsgpt/fetchUsersWithGeneratedMedia/rejected");
  });
});

describe("adsgptActions > fetchUserUsageCost", () => {
  it("happy", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: { total: 100 } } });
    const r = await store.dispatch(actions.fetchUserUsageCost({ userId: "u1", groupBy: "day" }));
    expect(r.payload).toEqual({ total: 100 });
  });
  it("happy with from/to params", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: { total: 0 } } });
    await store.dispatch(actions.fetchUserUsageCost({ userId: "u1", from: "2025-01-01", to: "2025-01-31" }));
    expect(axiosGetSpy.mock.calls[0][1].params).toEqual({ groupBy: "day", from: "2025-01-01", to: "2025-01-31" });
  });
  it("returns undefined when userId missing (early-return)", async () => {
    const r = await store.dispatch(actions.fetchUserUsageCost({ userId: null }));
    expect(r.payload).toBeUndefined();
  });
  it("rejected when token missing", async () => {
    cookiesGetSpy.mockReturnValueOnce(undefined);
    const r = await store.dispatch(actions.fetchUserUsageCost({ userId: "u1" }));
    expect(r.type).toBe("adsgpt/fetchUserUsageCost/rejected");
  });
  it("rejected with response message", async () => {
    axiosGetSpy.mockRejectedValueOnce({ response: { data: { message: "cost-err" } } });
    const r = await store.dispatch(actions.fetchUserUsageCost({ userId: "u1" }));
    expect(r.payload).toBe("cost-err");
  });
  it("rejected with default fallback", async () => {
    axiosGetSpy.mockRejectedValueOnce(new Error("nope"));
    const r = await store.dispatch(actions.fetchUserUsageCost({ userId: "u1" }));
    expect(r.payload).toBe("Failed to fetch usage cost");
  });
});

describe("adsgptActions > fetchGeneratedMediaSpendingReport", () => {
  it("happy without date range", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: [{ user: "u1" }] } });
    const r = await store.dispatch(actions.fetchGeneratedMediaSpendingReport());
    expect(r.payload).toEqual([{ user: "u1" }]);
  });
  it("happy with date range", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: [] } });
    await store.dispatch(actions.fetchGeneratedMediaSpendingReport({ from: "2025-01-01", to: "2025-01-31" }));
    expect(axiosGetSpy.mock.calls[0][0]).toContain("from=2025-01-01");
  });
  it("happy: defaults to empty list when data.data missing", async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: {} });
    const r = await store.dispatch(actions.fetchGeneratedMediaSpendingReport());
    expect(r.payload).toEqual([]);
  });
  it("rejected when token missing", async () => {
    cookiesGetSpy.mockReturnValueOnce(undefined);
    const r = await store.dispatch(actions.fetchGeneratedMediaSpendingReport());
    expect(r.type).toBe("adsgpt/fetchGeneratedMediaSpendingReport/rejected");
  });
  it("rejected with response message", async () => {
    axiosGetSpy.mockRejectedValueOnce({ response: { data: { message: "report-err" } } });
    const r = await store.dispatch(actions.fetchGeneratedMediaSpendingReport());
    expect(r.payload).toBe("report-err");
  });
  it("rejected with default fallback", async () => {
    axiosGetSpy.mockRejectedValueOnce(new Error("nope"));
    const r = await store.dispatch(actions.fetchGeneratedMediaSpendingReport());
    expect(r.payload).toBe("Failed to fetch spending report");
  });
});

describe("adsgptActions > fetchRangeCounts", () => {
  it("happy: POST returns {network, data}", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { data: { newCount: 5, activeCount: 50 } } });
    const r = await store.dispatch(actions.fetchRangeCounts({ network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } }));
    expect(r.type).toBe("adsgpt/fetchRangeCounts/fulfilled");
    expect(r.payload).toEqual({ network: "facebook", data: { newCount: 5, activeCount: 50 } });
  });

  it("happy: data.data missing → undefined data field", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: {} });
    const r = await store.dispatch(actions.fetchRangeCounts({ network: "facebook" }));
    expect(r.payload).toEqual({ network: "facebook", data: undefined });
  });

  it("rejected with response.data.message", async () => {
    axiosPostSpy.mockRejectedValueOnce({ response: { data: { message: "range-err" } } });
    const r = await store.dispatch(actions.fetchRangeCounts({ network: "facebook" }));
    expect(r.payload).toBe("range-err");
  });

  it("rejected with default fallback", async () => {
    axiosPostSpy.mockRejectedValueOnce(new Error("nope"));
    const r = await store.dispatch(actions.fetchRangeCounts({ network: "facebook" }));
    expect(r.payload).toBe("API request failed");
  });
});

describe("adsgptActions > axios.isCancel re-throw branches", () => {
  // Every POST thunk has `if (axios.isCancel(error)) throw error;` in its catch.
  // Flipping isCancel to true exercises the re-throw path.
  const cancellableThunks = [
    "fetchAdsCount", "fetchAdsCountScroll", "fetchAdsCountPython",
    "fetchAdsCountMeta", "fetchAdSourceCount", "fetchAdPositionCount",
    "fetchAdsGraphCount", "fetchRangeCounts", "fetchTotalAdsCount",
    "fetchTiktokAdsCount", "fetchTiktokAdsGraphCount",
  ];

  it.each(cancellableThunks)("%s: axios.isCancel=true → catch re-throws", async (name) => {
    const axios = (await import("axios")).default;
    const cancelErr = Object.assign(new Error("aborted"), { __CANCEL__: true });
    axios.isCancel = vi.fn(() => true);
    axiosPostSpy.mockRejectedValueOnce(cancelErr);
    const r = await store.dispatch(actions[name]({ network: "fb" }));
    expect(r.type).toContain("rejected");
    axios.isCancel = vi.fn(() => false);
  });
});

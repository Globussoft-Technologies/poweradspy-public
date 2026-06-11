import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const regPath = require.resolve("../../../../src/services/ServiceRegistry");
const serviceRegistry = { getService: vi.fn() };
require.cache[regPath] = {
  id: regPath, filename: regPath, loaded: true, exports: serviceRegistry,
};

const commonSearchPath = require.resolve("../../../../src/services/common/controllers/commonSearchController");
const searchAllNetworks = vi.fn();
require.cache[commonSearchPath] = {
  id: commonSearchPath, filename: commonSearchPath, loaded: true,
  exports: { searchAllNetworks },
};

const sutPath = require.resolve("../../../../src/services/common/controllers/dashboardShareController");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

let mockCollection;
function mkFbService({ mongoMissing = false } = {}) {
  if (mongoMissing) return { db: {} };
  return { db: { mongo: { collection: vi.fn(() => mockCollection) } } };
}

beforeEach(() => {
  serviceRegistry.getService.mockReset();
  searchAllNetworks.mockReset();
  mockCollection = {
    createIndex: vi.fn(async () => "ok"),
    insertOne: vi.fn(async () => ({ insertedId: "id" })),
    findOne: vi.fn(),
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("dashboardShareController > createDashboardShare", () => {
  it("400 when uiState or searchPayload missing", async () => {
    const { createDashboardShare } = freshSut();
    const res = mkRes();
    await createDashboardShare({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("200 happy path returns token + persists state", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createDashboardShare } = freshSut();
    const res = mkRes();
    await createDashboardShare({ body: { uiState: { tab: "x" }, searchPayload: { q: "y" } }, user: { id: "u" } }, res);
    expect(res.body.token).toMatch(/^[a-f0-9]{32}$/);
    expect(mockCollection.insertOne).toHaveBeenCalled();
    expect(mockCollection.insertOne.mock.calls[0][0].created_by).toBe("u");
  });
  it("created_by null when no user", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createDashboardShare } = freshSut();
    await createDashboardShare({ body: { uiState: {}, searchPayload: {} } }, mkRes());
    expect(mockCollection.insertOne.mock.calls[0][0].created_by).toBeNull();
  });
  it("created_by falls back to user.user_id", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createDashboardShare } = freshSut();
    await createDashboardShare({ body: { uiState: {}, searchPayload: {} }, user: { user_id: "alt" } }, mkRes());
    expect(mockCollection.insertOne.mock.calls[0][0].created_by).toBe("alt");
  });
  it("500 when mongo missing", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService({ mongoMissing: true }));
    const { createDashboardShare } = freshSut();
    const res = mkRes();
    await createDashboardShare({ body: { uiState: {}, searchPayload: {} } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("500 when insertOne rejects", async () => {
    mockCollection.insertOne.mockRejectedValue(new Error("dup"));
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createDashboardShare } = freshSut();
    const res = mkRes();
    await createDashboardShare({ body: { uiState: {}, searchPayload: {} } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("dashboardShareController > getCollection index errors", () => {
  it("createIndex code 85 swallowed silently", async () => {
    const err = new Error("dup"); err.code = 85;
    mockCollection.createIndex.mockRejectedValueOnce(err);
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createDashboardShare } = freshSut();
    await createDashboardShare({ body: { uiState: {}, searchPayload: {} } }, mkRes());
    expect(console.warn).not.toHaveBeenCalled();
  });
  it("createIndex other errors warned", async () => {
    mockCollection.createIndex.mockRejectedValueOnce(new Error("err"));
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createDashboardShare } = freshSut();
    await createDashboardShare({ body: { uiState: {}, searchPayload: {} } }, mkRes());
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("dashboardShareController > getDashboardShare", () => {
  it("400 when no token", async () => {
    const { getDashboardShare } = freshSut();
    const res = mkRes();
    await getDashboardShare({ params: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("404 when no doc", async () => {
    mockCollection.findOne.mockResolvedValue(null);
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { getDashboardShare } = freshSut();
    const res = mkRes();
    await getDashboardShare({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("410 when expired", async () => {
    mockCollection.findOne.mockResolvedValue({ expires_at: new Date(Date.now() - 1000) });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { getDashboardShare } = freshSut();
    const res = mkRes();
    await getDashboardShare({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(410);
  });
  it("200 returns uiState + expires_at", async () => {
    const exp = new Date(Date.now() + 60000);
    mockCollection.findOne.mockResolvedValue({ uiState: { tab: "x" }, expires_at: exp });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { getDashboardShare } = freshSut();
    const res = mkRes();
    await getDashboardShare({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.uiState).toEqual({ tab: "x" });
  });
  it("500 when mongo missing (getCollection throws)", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService({ mongoMissing: true }));
    const { getDashboardShare } = freshSut();
    const res = mkRes();
    await getDashboardShare({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("dashboardShareController > guestSearch", () => {
  it("400 when no token", async () => {
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("non-offset path: limit reached when skip >= 11", async () => {
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 11 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.guestLimitReached).toBe(true);
  });
  it("offset (>20) path: limit reached when skip >= 99", async () => {
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 99 } }, res);
    expect(res.body.message).toContain("Guest limit reached");
  });
  it("404 when doc not found", async () => {
    mockCollection.findOne.mockResolvedValue(null);
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 0 } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("410 when expired", async () => {
    mockCollection.findOne.mockResolvedValue({ expires_at: new Date(Date.now() - 1000) });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 0 } }, res);
    expect(res.statusCode).toBe(410);
  });
  it("happy path: calls searchAllNetworks with reconstructed payload", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000),
      searchPayload: { q: "x" },
      created_by: "owner",
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockImplementation(async (req, res) => {
      res.status(200).json({ data: [], meta: { total: {} } });
    });
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 0 } }, res);
    expect(searchAllNetworks).toHaveBeenCalled();
    expect(res.body.meta.guestLimitReached).toBe(false);
    expect(res.body.meta.guestMaxAds).toBe(100);
  });
  it("user_id defaults to 281 when stored payload + created_by both missing", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000),
      searchPayload: {},
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockImplementation(async (req, res) => {
      expect(req.body.user_id).toBe(281);
      res.status(200).json({ data: [] });
    });
    const { guestSearch } = freshSut();
    await guestSearch({ body: { token: "tk", skip: 0 }, ip: "1.1.1.1" }, mkRes());
  });
  it("user_id from created_by when stored payload missing user_id", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000),
      searchPayload: {},
      created_by: "owner",
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockImplementation(async (req, res) => {
      expect(req.body.user_id).toBe("owner");
      res.status(200).json({ data: [] });
    });
    const { guestSearch } = freshSut();
    await guestSearch({ body: { token: "tk", skip: 0 } }, mkRes());
  });
  it("user_id from stored payload wins", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000),
      searchPayload: { user_id: "stored" },
      created_by: "owner",
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockImplementation(async (req, res) => {
      expect(req.body.user_id).toBe("stored");
      res.status(200).json({ data: [] });
    });
    const { guestSearch } = freshSut();
    await guestSearch({ body: { token: "tk", skip: 0 } }, mkRes());
  });
  it("500 when searchAllNetworks does not respond", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000), searchPayload: {},
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockResolvedValue(); // doesn't call res.status
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 0 } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("non-200 status passed through", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000), searchPayload: {},
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockImplementation(async (req, res) => {
      res.status(503).json({ message: "err" });
    });
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 0 } }, res);
    expect(res.statusCode).toBe(503);
  });
  it("response without meta → no meta annotation", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000), searchPayload: {},
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockImplementation(async (req, res) => {
      res.status(200).json({ data: [] }); // no meta
    });
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 0 } }, res);
    expect(res.body.meta).toBeUndefined();
  });
  it("offset next-page limit reached annotation", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000), searchPayload: {},
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockImplementation(async (req, res) => {
      res.status(200).json({ data: [], meta: { total: {} } });
    });
    const { guestSearch } = freshSut();
    const res = mkRes();
    // skip = 90 → isOffset true → nextSkip = 99 → nextLimitReached = true
    await guestSearch({ body: { token: "tk", skip: 90 } }, res);
    expect(res.body.meta.guestLimitReached).toBe(true);
  });
  it("500 when mongo missing", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService({ mongoMissing: true }));
    const { guestSearch } = freshSut();
    const res = mkRes();
    await guestSearch({ body: { token: "tk", skip: 0 } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("invalid skip parses to 0 (Number('foo') NaN || 0)", async () => {
    mockCollection.findOne.mockResolvedValue({
      expires_at: new Date(Date.now() + 60000), searchPayload: {},
    });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    searchAllNetworks.mockImplementation(async (req, res) => {
      expect(req.body.skip).toBe(0);
      res.status(200).json({ data: [] });
    });
    const { guestSearch } = freshSut();
    await guestSearch({ body: { token: "tk", skip: "foo" } }, mkRes());
  });
  it("indexEnsured stays true across calls within same SUT load (line 22 false branch)", async () => {
    // First call: indexEnsured starts false → enters createIndex path.
    // Second call (SAME SUT instance, no freshSut between): indexEnsured=true
    // → skips the createIndex block — exercises the false branch.
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const body = { uiState: { searchQuery: "x" }, searchPayload: { q: "a" } };
    const { createDashboardShare } = freshSut();
    await createDashboardShare({ body }, mkRes());
    expect(mockCollection.createIndex).toHaveBeenCalled();
    mockCollection.createIndex.mockClear();
    // Second call on the SAME imported function — indexEnsured is now true
    await createDashboardShare({ body: { ...body, searchPayload: { q: "b" } } }, mkRes());
    expect(mockCollection.createIndex).not.toHaveBeenCalled();
  });
});

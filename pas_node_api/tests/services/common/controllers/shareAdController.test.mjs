import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock ServiceRegistry
const regPath = require.resolve("../../../../src/services/ServiceRegistry");
const serviceRegistry = { getService: vi.fn() };
require.cache[regPath] = {
  id: regPath, filename: regPath, loaded: true, exports: serviceRegistry,
};

// Pre-mock every getAdsByAdvertiser collaborator
const networks = ["facebook","instagram","youtube","pinterest","google","linkedin","reddit","quora","native","gdn","tiktok"];
const handlerMocks = {};
for (const n of networks) {
  const p = require.resolve(`../../../../src/services/${n}/controllers/getAdsByAdvertiserController`);
  const fn = vi.fn(async () => ({ code: 200, data: [{ ad_id: 1 }] }));
  handlerMocks[n] = fn;
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { getAdsByAdvertiser: fn } };
}

const sutPath = require.resolve("../../../../src/services/common/controllers/shareAdController");
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
function mkFbService({ collectionImpl = mockCollection, mongoMissing = false } = {}) {
  if (mongoMissing) return { db: {} };
  return { db: { mongo: { collection: vi.fn(() => collectionImpl) } } };
}

beforeEach(() => {
  serviceRegistry.getService.mockReset();
  for (const fn of Object.values(handlerMocks)) fn.mockReset().mockResolvedValue({ code: 200, data: [{ ad_id: 1 }] });
  mockCollection = {
    createIndex: vi.fn(async () => "ok"),
    insertOne: vi.fn(async () => ({ insertedId: "id1" })),
    findOne: vi.fn(),
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("shareAdController > createShareLink", () => {
  it("400 when ad_id missing", async () => {
    const { createShareLink } = freshSut();
    const res = mkRes();
    await createShareLink({ body: { network: "facebook" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when network missing", async () => {
    const { createShareLink } = freshSut();
    const res = mkRes();
    await createShareLink({ body: { ad_id: 1 } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when network invalid", async () => {
    const { createShareLink } = freshSut();
    const res = mkRes();
    await createShareLink({ body: { ad_id: 1, network: "myspace" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("Invalid network");
  });
  it("200 happy path returns token + expires_at", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createShareLink } = freshSut();
    const res = mkRes();
    await createShareLink({ body: { ad_id: 42, network: "Facebook" }, user: { id: "u1" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toMatch(/^[a-f0-9]{32}$/);
    expect(mockCollection.insertOne).toHaveBeenCalled();
    const inserted = mockCollection.insertOne.mock.calls[0][0];
    expect(inserted.network).toBe("facebook");
    expect(inserted.created_by).toBe("u1");
  });
  it("created_by falls back to user.user_id", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createShareLink } = freshSut();
    const res = mkRes();
    await createShareLink({ body: { ad_id: 1, network: "facebook" }, user: { user_id: "alt" } }, res);
    expect(mockCollection.insertOne.mock.calls[0][0].created_by).toBe("alt");
  });
  it("created_by null when no req.user", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createShareLink } = freshSut();
    const res = mkRes();
    await createShareLink({ body: { ad_id: 1, network: "facebook" } }, res);
    expect(mockCollection.insertOne.mock.calls[0][0].created_by).toBeNull();
  });
  it("500 when getShareCollection throws (no mongo)", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService({ mongoMissing: true }));
    const { createShareLink } = freshSut();
    const res = mkRes();
    await createShareLink({ body: { ad_id: 1, network: "facebook" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("500 when insertOne throws", async () => {
    mockCollection.insertOne.mockRejectedValue(new Error("dup"));
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createShareLink } = freshSut();
    const res = mkRes();
    await createShareLink({ body: { ad_id: 1, network: "facebook" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("shareAdController > getShareCollection (index errors)", () => {
  it("createIndex code 85/86 swallowed silently", async () => {
    const err = new Error("index exists");
    err.code = 85;
    mockCollection.createIndex.mockRejectedValueOnce(err);
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createShareLink } = freshSut();
    await createShareLink({ body: { ad_id: 1, network: "facebook" } }, mkRes());
    expect(console.warn).not.toHaveBeenCalled();
  });
  it("createIndex other errors are warned", async () => {
    mockCollection.createIndex.mockRejectedValueOnce(new Error("other"));
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createShareLink } = freshSut();
    await createShareLink({ body: { ad_id: 1, network: "facebook" } }, mkRes());
    expect(console.warn).toHaveBeenCalled();
  });
  it("indexEnsured cache means createIndex only called once across calls", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { createShareLink } = freshSut();
    await createShareLink({ body: { ad_id: 1, network: "facebook" } }, mkRes());
    await createShareLink({ body: { ad_id: 2, network: "facebook" } }, mkRes());
    expect(mockCollection.createIndex).toHaveBeenCalledTimes(2); // 2 indexes × 1 call only
  });
});

describe("shareAdController > getSharedAd", () => {
  it("400 when no token", async () => {
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("404 when no shareDoc", async () => {
    mockCollection.findOne.mockResolvedValue(null);
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("410 when expired", async () => {
    mockCollection.findOne.mockResolvedValue({ token: "tk", expires_at: new Date(Date.now() - 1000) });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(410);
  });
  it("500 when shareDoc.network has no handler (unknown network)", async () => {
    mockCollection.findOne.mockResolvedValue({ token: "tk", expires_at: new Date(Date.now() + 60000), network: "myspace" });
    serviceRegistry.getService.mockReturnValue(mkFbService());
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toContain("No handler");
  });
  it("500 when service not available for network", async () => {
    mockCollection.findOne.mockResolvedValue({ token: "tk", expires_at: new Date(Date.now() + 60000), network: "facebook", ad_id: "1" });
    let call = 0;
    serviceRegistry.getService.mockImplementation((slug) => {
      call++;
      if (slug === "facebook" && call === 1) return mkFbService();
      return null; // second call (for the network handler) → null
    });
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toContain("Service not available");
  });
  it("404 when handler returns non-200", async () => {
    mockCollection.findOne.mockResolvedValue({ token: "tk", expires_at: new Date(Date.now() + 60000), network: "facebook", ad_id: "1" });
    handlerMocks.facebook.mockResolvedValueOnce({ code: 404, data: [] });
    serviceRegistry.getService.mockImplementation(() => mkFbService());
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("404 when handler returns 200 but data empty", async () => {
    mockCollection.findOne.mockResolvedValue({ token: "tk", expires_at: new Date(Date.now() + 60000), network: "facebook", ad_id: "1" });
    handlerMocks.facebook.mockResolvedValueOnce({ code: 200, data: [] });
    serviceRegistry.getService.mockImplementation(() => mkFbService());
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("200 happy path returns ad + network + expires_at", async () => {
    const exp = new Date(Date.now() + 60000);
    mockCollection.findOne.mockResolvedValue({ token: "tk", expires_at: exp, network: "facebook", ad_id: "7" });
    serviceRegistry.getService.mockImplementation(() => mkFbService());
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ad).toEqual({ ad_id: 1 });
    expect(res.body.network).toBe("facebook");
  });
  it("500 when getShareCollection throws (no mongo)", async () => {
    serviceRegistry.getService.mockReturnValue(mkFbService({ mongoMissing: true }));
    const { getSharedAd } = freshSut();
    const res = mkRes();
    await getSharedAd({ params: { token: "tk" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

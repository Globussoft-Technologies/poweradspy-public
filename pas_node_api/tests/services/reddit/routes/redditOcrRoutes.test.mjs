import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Fake express Router ──────────────────────────────────────────────
const expressPath = require.resolve("express");
const routerInstances = [];
function FakeRouter() {
  const r = {
    routes: { get: {}, post: {} },
    get: vi.fn((path, ...rest) => { r.routes.get[path] = rest; }),
    post: vi.fn((path, ...rest) => { r.routes.post[path] = rest; }),
    use: vi.fn(),
  };
  routerInstances.push(r);
  return r;
}
require.cache[expressPath] = { id: expressPath, filename: expressPath, loaded: true, exports: { Router: FakeRouter } };

// ── Mock the controller (static methods) ─────────────────────────────
const ctrlPath = require.resolve("../../../../src/services/reddit/controllers/redditOcrController");
const Controller = { getImageUrl: vi.fn(), updateImageDetails: vi.fn() };
require.cache[ctrlPath] = { id: ctrlPath, filename: ctrlPath, loaded: true, exports: Controller };

const createRedditOcrRoutes = require("../../../../src/services/reddit/routes/redditOcrRoutes");

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

const svc = { db: {}, log: { info: vi.fn() } };

beforeEach(() => {
  routerInstances.length = 0;
  Controller.getImageUrl.mockReset();
  Controller.updateImageDetails.mockReset();
});

function lastHandler(router, method, path) {
  const stack = router.routes[method][path];
  return stack[stack.length - 1];
}

describe("redditOcrRoutes > registration", () => {
  it("exports a creator function", () => {
    expect(typeof createRedditOcrRoutes).toBe("function");
  });

  it("registers GET /ocr/getImageUrl and POST /ocr/updateImageDetails", () => {
    const router = createRedditOcrRoutes(svc);
    expect(router.routes.get["/ocr/getImageUrl"]).toBeDefined();
    expect(router.routes.post["/ocr/updateImageDetails"]).toBeDefined();
  });
});

describe("redditOcrRoutes > delegation", () => {
  it("GET handler delegates to Controller.getImageUrl with (req,res,next,service)", async () => {
    const router = createRedditOcrRoutes(svc);
    const req = { query: { status: "4" } };
    const res = mkRes();
    const next = vi.fn();
    await lastHandler(router, "get", "/ocr/getImageUrl")(req, res, next);
    expect(Controller.getImageUrl).toHaveBeenCalledWith(req, res, next, svc);
  });

  it("POST handler delegates to Controller.updateImageDetails with (req,res,next,service)", async () => {
    const router = createRedditOcrRoutes(svc);
    const req = { body: { ad_id: 1 } };
    const res = mkRes();
    const next = vi.fn();
    await lastHandler(router, "post", "/ocr/updateImageDetails")(req, res, next);
    expect(Controller.updateImageDetails).toHaveBeenCalledWith(req, res, next, svc);
  });
});

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
const ctrlPath = require.resolve("../../../../src/services/quora/controllers/quoraOcrController");
const Controller = { getImageUrl: vi.fn(), updateImageOcrDetails: vi.fn() };
require.cache[ctrlPath] = { id: ctrlPath, filename: ctrlPath, loaded: true, exports: Controller };

const createQuoraOcrRoutes = require("../../../../src/services/quora/routes/quoraOcrRoutes");

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
  Controller.updateImageOcrDetails.mockReset();
});

function lastHandler(router, method, path) {
  const stack = router.routes[method][path];
  return stack[stack.length - 1];
}

describe("quoraOcrRoutes > registration", () => {
  it("exports a creator function", () => {
    expect(typeof createQuoraOcrRoutes).toBe("function");
  });

  it("registers GET /ocr/getQuoraImageUrl and POST /ocr/update-image-info", () => {
    const router = createQuoraOcrRoutes(svc);
    expect(router.routes.get["/ocr/getQuoraImageUrl"]).toBeDefined();
    expect(router.routes.post["/ocr/update-image-info"]).toBeDefined();
  });
});

describe("quoraOcrRoutes > delegation", () => {
  it("GET handler delegates to Controller.getImageUrl with (req,res,next,service)", async () => {
    const router = createQuoraOcrRoutes(svc);
    const req = { query: { status: "4" } };
    const res = mkRes();
    const next = vi.fn();
    await lastHandler(router, "get", "/ocr/getQuoraImageUrl")(req, res, next);
    expect(Controller.getImageUrl).toHaveBeenCalledWith(req, res, next, svc);
  });

  it("POST handler delegates to Controller.updateImageOcrDetails with (req,res,next,service)", async () => {
    const router = createQuoraOcrRoutes(svc);
    const req = { body: { ad_id: 1 } };
    const res = mkRes();
    const next = vi.fn();
    await lastHandler(router, "post", "/ocr/update-image-info")(req, res, next);
    expect(Controller.updateImageOcrDetails).toHaveBeenCalledWith(req, res, next, svc);
  });
});

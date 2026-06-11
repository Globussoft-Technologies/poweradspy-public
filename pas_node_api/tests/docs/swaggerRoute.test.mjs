import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock js-yaml + fs so we don't need a real swagger.yml on disk
const yamlPath = require.resolve("js-yaml");
require.cache[yamlPath] = {
  id: yamlPath, filename: yamlPath, loaded: true,
  exports: { load: vi.fn(() => ({ openapi: "3.0.0", info: { title: "fake" } })) },
};
const fsPath = require.resolve("fs");
require.cache[fsPath] = {
  id: fsPath, filename: fsPath, loaded: true,
  exports: { readFileSync: vi.fn(() => "openapi: 3.0.0\n") },
};

// Mock swagger-ui-express
const swPath = require.resolve("swagger-ui-express");
const fakeServe = ["serve-mw"];
const fakeSetup = vi.fn(() => "setup-handler");
require.cache[swPath] = {
  id: swPath, filename: swPath, loaded: true,
  exports: { serve: fakeServe, setup: fakeSetup },
};

// Mock config
const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { admin: { username: "admin", password: "secret" } },
};

const mountSwagger = require("../../src/docs/swaggerRoute");

beforeEach(() => {
  fakeSetup.mockClear();
});

describe("docs/swaggerRoute > mountSwagger", () => {
  it("mounts /api-docs with auth, serve, setup middleware chain", () => {
    const app = { use: vi.fn() };
    mountSwagger(app);
    expect(app.use).toHaveBeenCalledWith(
      "/api-docs",
      expect.any(Function),
      fakeServe,
      "setup-handler"
    );
    expect(fakeSetup).toHaveBeenCalledWith(
      { openapi: "3.0.0", info: { title: "fake" } },
      expect.objectContaining({ customSiteTitle: "PAS API Docs" })
    );
  });
});

describe("docs/swaggerRoute > docsAuthMiddleware", () => {
  // The middleware is registered via app.use; capture it from the mount call.
  function captureMiddleware() {
    const app = { use: vi.fn() };
    mountSwagger(app);
    return app.use.mock.calls[0][1];
  }

  function mockRes() {
    const res = {};
    res.setHeader = vi.fn();
    res.status = vi.fn(() => res);
    res.send = vi.fn(() => res);
    return res;
  }

  it("valid Basic credentials → next()", () => {
    const mw = captureMiddleware();
    const creds = Buffer.from("admin:secret").toString("base64");
    const req = { headers: { authorization: `Basic ${creds}` } };
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("wrong password → 401 with WWW-Authenticate header", () => {
    const mw = captureMiddleware();
    const creds = Buffer.from("admin:wrong").toString("base64");
    const req = { headers: { authorization: `Basic ${creds}` } };
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", 'Basic realm="API Docs"');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("no Authorization header → 401 prompt", () => {
    const mw = captureMiddleware();
    const res = mockRes();
    mw({ headers: {} }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("non-Basic Authorization header → 401 prompt", () => {
    const mw = captureMiddleware();
    const res = mockRes();
    mw({ headers: { authorization: "Bearer abc" } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

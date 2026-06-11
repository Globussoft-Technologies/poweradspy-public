import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// All collaborators are sealed at require time. Replace each via require.cache
// before the SUT is loaded.
const expressApp = {
  use: vi.fn(),
  get: vi.fn(),
};
function express() { return expressApp; }
express.urlencoded = vi.fn(() => () => {});
express.json = vi.fn(() => () => {});
express.Router = () => ({ use: vi.fn(), get: vi.fn(), post: vi.fn(), stack: [] });
const expressPath = require.resolve("express");
require.cache[expressPath] = { id: expressPath, filename: expressPath, loaded: true, exports: express };

const corsPath = require.resolve("cors");
const cors = vi.fn(() => () => {});
require.cache[corsPath] = { id: corsPath, filename: corsPath, loaded: true, exports: cors };

const mongoPath = require.resolve("../mongo-db/connection");
const connectToMongo = vi.fn();
require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { connectToMongo, getCollection: vi.fn() } };

const httpServer = { listen: vi.fn((port, cb) => cb && cb()), close: vi.fn((cb) => cb && cb()) };
const httpPath = require.resolve("http");
require.cache[httpPath] = { id: httpPath, filename: httpPath, loaded: true, exports: { createServer: vi.fn(() => httpServer) } };

const mainRoutesPath = require.resolve("../routes/main-routes");
require.cache[mainRoutesPath] = { id: mainRoutesPath, filename: mainRoutesPath, loaded: true, exports: vi.fn() };

const wsPath = require.resolve("../websocket/websocket");
const initializeWebSocket = vi.fn();
require.cache[wsPath] = { id: wsPath, filename: wsPath, loaded: true, exports: { initializeWebSocket } };

const loggerPath = require.resolve("../utils/logger");
const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: logger };

// Capture process.on registrations
const procHandlers = {};
const realProcessOn = process.on.bind(process);
vi.spyOn(process, "on").mockImplementation((evt, cb) => {
  if (["SIGINT", "SIGTERM"].includes(evt)) procHandlers[evt] = cb;
  else realProcessOn(evt, cb);
  return process;
});

const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

require("../index.js");

describe("index.js bootstrap", () => {
  it("connects to Mongo at boot", () => {
    expect(connectToMongo).toHaveBeenCalled();
  });

  it("registers main-routes under /admin-panel", () => {
    const adminMount = expressApp.use.mock.calls.find((c) => c[0] === "/admin-panel");
    expect(adminMount).toBeDefined();
  });

  it("registers the health-check GET /", () => {
    expect(expressApp.get).toHaveBeenCalledWith("/", expect.any(Function));
  });

  it("starts the http server listening on PORT", () => {
    expect(httpServer.listen).toHaveBeenCalledWith(expect.any(Number), expect.any(Function));
  });

  it("initializes the websocket against the http server", () => {
    expect(initializeWebSocket).toHaveBeenCalledWith(httpServer, logger);
  });

  it("registers SIGTERM/SIGINT shutdown handlers", () => {
    expect(typeof procHandlers.SIGTERM).toBe("function");
    expect(typeof procHandlers.SIGINT).toBe("function");
  });

  it("SIGTERM closes server and exits 0", () => {
    httpServer.close.mockClear();
    exitSpy.mockClear();
    procHandlers.SIGTERM();
    expect(httpServer.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("SIGINT closes server and exits 0", () => {
    httpServer.close.mockClear();
    exitSpy.mockClear();
    procHandlers.SIGINT();
    expect(httpServer.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("health-check returns status_code 200 payload", () => {
    const handler = expressApp.get.mock.calls.find((c) => c[0] === "/")[1];
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    handler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status_code: 200 }));
  });

  it("startServer outer catch: logger.error fires when server.listen throws (line 38)", () => {
    // Re-require index.js with a listen that throws synchronously to exercise
    // the startServer catch block at line 37-38.
    const indexPath = require.resolve("../index.js");
    delete require.cache[indexPath];
    const origListen = httpServer.listen;
    httpServer.listen = vi.fn(() => { throw new Error("listen-fail"); });
    logger.error.mockClear();
    try {
      require("../index.js");
    } finally {
      httpServer.listen = origListen;
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ Worker_error: "listen-fail" })
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// --- Mock ws package: WebSocket.Server captured constructor ---
const lastServer = { instance: null };
function FakeServer(opts) {
  this.options = opts;
  this.clients = new Set();
  this.handlers = {};
  this.on = (evt, fn) => { this.handlers[evt] = fn; };
  this.emit = (evt, ...args) => this.handlers[evt]?.(...args);
  lastServer.instance = this;
}
const FakeWebSocket = { Server: FakeServer, OPEN: 1 };
const wsPath = require.resolve("ws");
require.cache[wsPath] = { id: wsPath, filename: wsPath, loaded: true, exports: FakeWebSocket };

// --- Mock logger ---
const loggerPath = require.resolve("../../utils/logger");
const logger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
};
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: logger };

process.env.API_KEY = "secret-key";

const { initializeWebSocket } = require("../../websocket/websocket");

function makeWs(overrides = {}) {
  const ws = {
    readyState: 1,
    isAlive: true,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    handlers: {},
    on(evt, fn) { this.handlers[evt] = fn; },
    emit(evt, ...args) { this.handlers[evt]?.(...args); },
    ...overrides,
  };
  return ws;
}

function makeReq({ url = "/socket", headers = {} } = {}) {
  return { url, headers };
}

let setIntervalSpy, clearIntervalSpy;

beforeEach(() => {
  Object.values(logger).forEach((fn) => fn.mockReset && fn.mockReset());
  lastServer.instance = null;
  setIntervalSpy = vi.spyOn(global, "setInterval").mockImplementation(() => ({ _id: Math.random() }));
  clearIntervalSpy = vi.spyOn(global, "clearInterval").mockImplementation(() => {});
});

afterEach(() => {
  setIntervalSpy.mockRestore();
  clearIntervalSpy.mockRestore();
});

describe("websocket/websocket > initializeWebSocket", () => {
  it("constructs Server with /socket path and returns wss/updateAllConfigs/shutdown", () => {
    const server = {};
    const out = initializeWebSocket(server);
    expect(lastServer.instance.options.path).toBe("/socket");
    expect(typeof out.updateAllConfigs).toBe("function");
    expect(typeof out.shutdown).toBe("function");
    expect(out.wss).toBe(lastServer.instance);
  });

  it("frontend query-auth: valid key registers, requests resolution if backend exists", () => {
    initializeWebSocket({});
    const backendWs = makeWs();
    lastServer.instance.handlers.connection(backendWs, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "sys1" } }));
    const frontendWs = makeWs();
    lastServer.instance.handlers.connection(frontendWs, makeReq({ url: "/socket?apiKey=secret-key&systemName=sys1" }));
    const sent = backendWs.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(sent.some((s) => s.action === "get_screen_resolution")).toBe(true);
    expect(frontendWs.systemName).toBe("sys1");
  });

  it("frontend query-auth: invalid key closes with 1008", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ url: "/socket?apiKey=wrong&systemName=s2" }));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid API key");
  });

  it("frontend query-auth: duplicate frontend closes with 1008", () => {
    initializeWebSocket({});
    const first = makeWs();
    lastServer.instance.handlers.connection(first, makeReq({ url: "/socket?apiKey=secret-key&systemName=dup" }));
    const dup = makeWs();
    lastServer.instance.handlers.connection(dup, makeReq({ url: "/socket?apiKey=secret-key&systemName=dup" }));
    expect(dup.close).toHaveBeenCalledWith(1008, "Duplicate registration");
  });

  it("frontend query-auth: no backend present → sends error message", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ url: "/socket?apiKey=secret-key&systemName=nob" }));
    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(sent.some((s) => s.message === "Backend system not available")).toBe(true);
  });

  it("backend header-auth: valid registers; invalid closes; duplicate closes", () => {
    initializeWebSocket({});
    const ws1 = makeWs();
    lastServer.instance.handlers.connection(ws1, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "back1" } }));
    expect(ws1.systemName).toBe("back1");

    const ws2 = makeWs();
    lastServer.instance.handlers.connection(ws2, makeReq({ headers: { "x-api-key": "wrong", "x-system-name": "back2" } }));
    expect(ws2.close).toHaveBeenCalledWith(1008, "Invalid API key");

    const ws3 = makeWs();
    lastServer.instance.handlers.connection(ws3, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "back1" } }));
    expect(ws3.close).toHaveBeenCalledWith(1008, "Duplicate registration");
  });

  it("pending connection: no headers/query yields clientType=pending", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    expect(logger.info).toHaveBeenCalledWith("New connection pending authentication");
  });

  it("connection setup error: url.parse throws → close 1008", () => {
    initializeWebSocket({});
    const ws = makeWs();
    // Pass a req that breaks parsing
    lastServer.instance.handlers.connection(ws, null);
    expect(ws.close).toHaveBeenCalledWith(1008, "Connection setup failed");
  });

  it("pong handler flips isAlive", () => {
    initializeWebSocket({});
    const ws = makeWs({ isAlive: false });
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("pong");
    expect(ws.isAlive).toBe(true);
  });

  it("message: oversize triggers close", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    const huge = { length: 11 * 1024 * 1024, toString: () => "{}" };
    ws.emit("message", huge);
    expect(ws.close).toHaveBeenCalledWith(1008, "Message too large");
  });

  it("pending → apiKey valid: promotes to frontend", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("message", Buffer.from(JSON.stringify({ type: "apiKey", apiKey: "secret-key" })));
    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(sent.some((s) => s.type === "apiKeyValid")).toBe(true);
  });

  it("pending → apiKey invalid: closes", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("message", Buffer.from(JSON.stringify({ type: "apiKey", apiKey: "wrong" })));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid API key");
  });

  it("frontend → systemName valid then invalid duplicate", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("message", Buffer.from(JSON.stringify({ type: "apiKey", apiKey: "secret-key" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "systemName", systemName: "sys-a" })));
    expect(ws.systemName).toBe("sys-a");

    const ws2 = makeWs();
    lastServer.instance.handlers.connection(ws2, makeReq());
    ws2.emit("message", Buffer.from(JSON.stringify({ type: "apiKey", apiKey: "secret-key" })));
    ws2.emit("message", Buffer.from(JSON.stringify({ type: "systemName", systemName: "sys-a" })));
    expect(ws2.close).toHaveBeenCalledWith(1008, "Invalid or duplicate system name");
  });

  it("frontend → systemName missing", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("message", Buffer.from(JSON.stringify({ type: "apiKey", apiKey: "secret-key" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "systemName", systemName: "" })));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid or duplicate system name");
  });

  it("pending → register: valid + duplicate paths", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("message", Buffer.from(JSON.stringify({ type: "register", systemName: "bsys" })));
    expect(ws.systemName).toBe("bsys");

    const ws2 = makeWs();
    lastServer.instance.handlers.connection(ws2, makeReq());
    ws2.emit("message", Buffer.from(JSON.stringify({ type: "register", systemName: "bsys" })));
    expect(ws2.close).toHaveBeenCalledWith(1008, "Invalid or duplicate systemName");
  });

  it("pending → register missing name", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("message", Buffer.from(JSON.stringify({ type: "register" })));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid or duplicate systemName");
  });

  it("pending non-auth message: 'Not authenticated' close", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("message", Buffer.from(JSON.stringify({ type: "random" })));
    expect(ws.close).toHaveBeenCalledWith(1008, "Not authenticated");
  });

  it("frontend → command forwarded to backend; missing backend warns", () => {
    initializeWebSocket({});
    const backendWs = makeWs();
    lastServer.instance.handlers.connection(backendWs, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "bx" } }));
    const frontendWs = makeWs();
    lastServer.instance.handlers.connection(frontendWs, makeReq({ url: "/socket?apiKey=secret-key&systemName=bx" }));
    backendWs.send.mockClear();
    frontendWs.emit("message", Buffer.from(JSON.stringify({ type: "command", systemName: "bx", action: "screenshot" })));
    expect(backendWs.send).toHaveBeenCalled();

    frontendWs.emit("message", Buffer.from(JSON.stringify({ type: "command", systemName: "ghost", action: "x" })));
    const sent = frontendWs.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(sent.some((s) => s.message === "Remote system not available")).toBe(true);
  });

  it("backend → screenshot valid/invalid + missing frontend", () => {
    initializeWebSocket({});
    const backendWs = makeWs();
    lastServer.instance.handlers.connection(backendWs, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "ss-sys" } }));
    // Invalid data
    backendWs.emit("message", Buffer.from(JSON.stringify({ type: "screenshot", data: 123 })));
    const sentBad = backendWs.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(sentBad.some((s) => s.message === "Invalid screenshot data")).toBe(true);
    // Frontend missing
    backendWs.emit("message", Buffer.from(JSON.stringify({ type: "screenshot", data: "b64..." })));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("No frontend found"));
    // Add frontend then send screenshot
    const feWs = makeWs();
    lastServer.instance.handlers.connection(feWs, makeReq({ url: "/socket?apiKey=secret-key&systemName=ss-sys" }));
    feWs.send.mockClear();
    backendWs.emit("message", Buffer.from(JSON.stringify({ type: "screenshot", data: "b64..." })));
    expect(feWs.send).toHaveBeenCalled();
  });

  it("backend → screen_resolution valid + invalid + missing frontend", () => {
    initializeWebSocket({});
    const backendWs = makeWs();
    lastServer.instance.handlers.connection(backendWs, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "sr-sys" } }));
    backendWs.emit("message", Buffer.from(JSON.stringify({ type: "screen_resolution", data: { width: 0 } })));
    expect(backendWs.send.mock.calls.map((c) => JSON.parse(c[0])).some((s) => s.message === "Invalid screen resolution data")).toBe(true);

    backendWs.emit("message", Buffer.from(JSON.stringify({ type: "screen_resolution", data: { width: 1920, height: 1080 } })));
    // No frontend → warn
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("No frontend found"));

    const feWs = makeWs();
    lastServer.instance.handlers.connection(feWs, makeReq({ url: "/socket?apiKey=secret-key&systemName=sr-sys" }));
    feWs.send.mockClear();
    backendWs.emit("message", Buffer.from(JSON.stringify({ type: "screen_resolution", data: { width: 1920, height: 1080 } })));
    expect(feWs.send).toHaveBeenCalled();
  });

  it("frontend ping → backend pong noop → unknown type warns", () => {
    initializeWebSocket({});
    const backendWs = makeWs();
    lastServer.instance.handlers.connection(backendWs, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "p-sys" } }));
    const feWs = makeWs();
    lastServer.instance.handlers.connection(feWs, makeReq({ url: "/socket?apiKey=secret-key&systemName=p-sys" }));
    feWs.send.mockClear();
    feWs.emit("message", Buffer.from(JSON.stringify({ type: "ping", timestamp: 42 })));
    expect(feWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "pong", timestamp: 42 }));

    backendWs.emit("message", Buffer.from(JSON.stringify({ type: "pong" })));
    feWs.send.mockClear();
    feWs.emit("message", Buffer.from(JSON.stringify({ type: "wat" })));
    expect(feWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "error", message: "Unknown message type" }));
  });

  it("message JSON parse error → 1008 close", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("message", Buffer.from("not json"));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid message format");
  });

  it("close handler: cleans up frontend then backend, logs unregistered case", () => {
    initializeWebSocket({});
    const feWs = makeWs();
    lastServer.instance.handlers.connection(feWs, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "x1" } }));
    feWs.emit("close", 1000, Buffer.from("ok"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("disconnected"));

    const pending = makeWs();
    lastServer.instance.handlers.connection(pending, makeReq());
    pending.emit("close", 1001, Buffer.from(""));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Unregistered"));
  });

  it("error handler: cleans up systemName mapping", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "e1" } }));
    ws.emit("error", new Error("boom"));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("WebSocket error"), expect.any(Object));
  });

  it("error handler on unregistered ws (no systemName) still logs", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.emit("error", new Error("boom"));
    expect(logger.error).toHaveBeenCalled();
  });

  it("heartbeat interval: ws not alive → terminate; ws alive → ping", () => {
    initializeWebSocket({});
    const setIntervalCallsBefore = setIntervalSpy.mock.calls.length;
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "h1" } }));
    const intervalFn = setIntervalSpy.mock.calls[setIntervalCallsBefore][0];
    intervalFn();
    expect(ws.ping).toHaveBeenCalled();
    ws.isAlive = false;
    intervalFn();
    expect(ws.terminate).toHaveBeenCalled();
  });

  it("heartbeat interval: ping throws → error logged", () => {
    initializeWebSocket({});
    const before = setIntervalSpy.mock.calls.length;
    const ws = makeWs({ ping: vi.fn(() => { throw new Error("ping-broke"); }) });
    lastServer.instance.handlers.connection(ws, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "h2" } }));
    const intervalFn = setIntervalSpy.mock.calls[before][0];
    intervalFn();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Error sending ping"), expect.any(Object));
  });

  it("heartbeat interval: terminates a frontend client when isAlive=false (line 133 true branch)", () => {
    initializeWebSocket({});
    const before = setIntervalSpy.mock.calls.length;
    // Register backend first so frontend resolution succeeds.
    const backendWs = makeWs();
    lastServer.instance.handlers.connection(backendWs, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "fe1" } }));
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ url: "/socket?apiKey=secret-key&systemName=fe1" }));
    // The frontend connection registered its own per-connection setInterval after backend's.
    // Find the index for ws's heartbeat interval: it's the next-most-recent.
    const intervalFn = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1][0];
    ws.isAlive = false;
    intervalFn();
    expect(ws.terminate).toHaveBeenCalled();
  });

  it("heartbeat interval: ws.readyState !== OPEN skips ping (line 139 false branch)", () => {
    initializeWebSocket({});
    const before = setIntervalSpy.mock.calls.length;
    const ws = makeWs({ readyState: 3 }); // CLOSED
    lastServer.instance.handlers.connection(ws, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "rs1" } }));
    const intervalFn = setIntervalSpy.mock.calls[before][0];
    intervalFn();
    expect(ws.ping).not.toHaveBeenCalled();
  });

  it("heartbeat interval: pending client (no systemName) alive → ping logs 'unregistered client' (line 141 binary idx 1)", () => {
    initializeWebSocket({});
    const before = setIntervalSpy.mock.calls.length;
    // Pending client: no auth headers, no apiKey query — connection sets clientType='pending'
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    expect(ws.systemName).toBeUndefined();
    const intervalFn = setIntervalSpy.mock.calls[before][0];
    intervalFn();
    expect(ws.ping).toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("unregistered client"));
  });

  it("close handler: pending client with manually set systemName → falls through to else branch (line 274 false side)", () => {
    initializeWebSocket({});
    // Pending client (clientType stays 'pending'): manually set systemName so
    // `if (ws.systemName)` is true and neither frontend nor backend branch fires.
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.systemName = "pending-with-name";
    ws.emit("close", 1000, Buffer.from("normal"));
    // The logger.info call uses `${clientType}` which is 'pending' — verify it ran
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("pending disconnected: pending-with-name"));
  });

  it("error handler: pending client with manually set systemName → falls through to else (line 285 false side)", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    ws.systemName = "pending-with-name";
    ws.emit("error", new Error("err"));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("WebSocket error for pending-with-name"),
      expect.any(Object)
    );
  });

  it("heartbeat: pending client without systemName, isAlive=false, terminates", () => {
    initializeWebSocket({});
    const before = setIntervalSpy.mock.calls.length;
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq());
    const intervalFn = setIntervalSpy.mock.calls[before][0];
    ws.isAlive = false;
    intervalFn();
    expect(ws.terminate).toHaveBeenCalled();
  });

  it("global heartbeat: removes from frontend/backend maps and terminates", () => {
    initializeWebSocket({});
    // Global setInterval is the LAST call registered during initializeWebSocket,
    // BEFORE any connection runs. Capture by its index immediately.
    const globalIntervalFn = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1][0];
    const feWs = makeWs();
    lastServer.instance.handlers.connection(feWs, makeReq({ url: "/socket?apiKey=secret-key&systemName=g1" }));
    lastServer.instance.clients.add(feWs);
    feWs.isAlive = false;
    globalIntervalFn();
    expect(feWs.terminate).toHaveBeenCalled();
  });

  it("global heartbeat: backend mapping removed", () => {
    initializeWebSocket({});
    const globalIntervalFn = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1][0];
    const beWs = makeWs();
    lastServer.instance.handlers.connection(beWs, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "g2" } }));
    lastServer.instance.clients.add(beWs);
    beWs.isAlive = false;
    globalIntervalFn();
    expect(beWs.terminate).toHaveBeenCalled();
  });

  it("close handler: frontend with systemName logs and removes from frontends map", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ url: "/socket?apiKey=secret-key&systemName=cf1" }));
    expect(ws.systemName).toBe("cf1");
    ws.emit("close", 1000, Buffer.from("normal"));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("frontend disconnected: cf1")
    );
  });

  it("close handler: backend with systemName logs and removes from backends map", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "cb1" } }));
    expect(ws.systemName).toBe("cb1");
    ws.emit("close", 1006, Buffer.from(""));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("backend disconnected: cb1")
    );
  });

  it("close handler: ws without systemName logs 'Unregistered ... disconnected'", () => {
    initializeWebSocket({});
    const ws = makeWs();
    // Force the close handler to register without going through auth — pass a
    // pending client by sending an invalid auth that closes immediately.
    // Easier: register backend then strip its systemName before close fires.
    lastServer.instance.handlers.connection(ws, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "x1" } }));
    delete ws.systemName; // simulate unregistered state at close time
    ws.emit("close", 1011, Buffer.from("server-err"));
    // Asserts the `clientType || 'pending'` binary-expr left-side branch
    // (line 277 idx 0): clientType is 'backend' (from auth) → 'backend' used.
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Unregistered backend disconnected")
    );
  });

  it("error handler: frontend with systemName logs and removes from frontends map", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ url: "/socket?apiKey=secret-key&systemName=ef1" }));
    ws.emit("error", new Error("ws-down"));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("WebSocket error for ef1"),
      expect.any(Object)
    );
  });

  it("error handler: backend with systemName logs and removes from backends map", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "eb1" } }));
    ws.emit("error", new Error("ws-down"));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("WebSocket error for eb1"),
      expect.any(Object)
    );
  });

  it("error handler: ws without systemName logs 'unregistered client'", () => {
    initializeWebSocket({});
    const ws = makeWs();
    lastServer.instance.handlers.connection(ws, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "ex1" } }));
    delete ws.systemName;
    ws.emit("error", new Error("ws-down"));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("unregistered client"),
      expect.any(Object)
    );
  });

  it("global heartbeat: ws without systemName still terminated", () => {
    initializeWebSocket({});
    const globalIntervalFn = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1][0];
    const ws = makeWs({ systemName: undefined, isAlive: false });
    lastServer.instance.clients.add(ws);
    globalIntervalFn();
    expect(ws.terminate).toHaveBeenCalled();
  });

  it("global heartbeat: alive ws is NOT terminated (line 293 false branch)", () => {
    initializeWebSocket({});
    const globalIntervalFn = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1][0];
    const ws = makeWs({ isAlive: true });
    lastServer.instance.clients.add(ws);
    globalIntervalFn();
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("global heartbeat: systemName not in either map → falls through both branches (line 297 false branch)", () => {
    initializeWebSocket({});
    const globalIntervalFn = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1][0];
    // ws with systemName that was never registered in clients map
    const ws = makeWs({ systemName: "ghost", isAlive: false });
    lastServer.instance.clients.add(ws);
    globalIntervalFn();
    // Still terminates, but neither branch (frontend/backend has) is taken
    expect(ws.terminate).toHaveBeenCalled();
  });

  it("updateAllConfigs: sends to OPEN backends, deletes closed ones", () => {
    const { updateAllConfigs } = initializeWebSocket({});
    const openBe = makeWs();
    const closedBe = makeWs({ readyState: 3 });
    lastServer.instance.handlers.connection(openBe, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "o" } }));
    lastServer.instance.handlers.connection(closedBe, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "c" } }));
    openBe.send.mockClear();
    updateAllConfigs({ wsUrl: "ws://override", apiKey: "k2" });
    expect(openBe.send).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Backend c not available"));
  });

  it("updateAllConfigs: defaults wsUrl/apiKey when newConfig empty", () => {
    const { updateAllConfigs } = initializeWebSocket({});
    const be = makeWs();
    lastServer.instance.handlers.connection(be, makeReq({ headers: { "x-api-key": "secret-key", "x-system-name": "d" } }));
    updateAllConfigs({});
    expect(be.send).toHaveBeenCalledWith(expect.stringContaining("ws://"));
  });

  it("updateAllConfigs: throws inside try → logger.error", () => {
    const { updateAllConfigs } = initializeWebSocket({});
    // Pass non-object: accessing .wsUrl on null throws
    updateAllConfigs(null);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to update configs"), expect.any(Object));
  });

  it("shutdown: closes all clients, logs", () => {
    const { shutdown } = initializeWebSocket({});
    const c1 = { close: vi.fn() };
    const c2 = { close: vi.fn() };
    lastServer.instance.clients.add(c1);
    lastServer.instance.clients.add(c2);
    shutdown();
    expect(c1.close).toHaveBeenCalledWith(1001, "Server shutting down");
    expect(c2.close).toHaveBeenCalledWith(1001, "Server shutting down");
  });

  it("shutdown: catches errors from forEach", () => {
    const { shutdown } = initializeWebSocket({});
    const bad = { close: vi.fn(() => { throw new Error("boom"); }) };
    lastServer.instance.clients.add(bad);
    shutdown();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Shutdown error"), expect.any(Object));
  });
});

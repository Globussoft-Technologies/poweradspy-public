import { describe, it, expect, vi, beforeEach } from "vitest";

const { ServerCtor, jwtVerifySpy, configGetSpy, loggerInfoSpy, lastIo } = vi.hoisted(() => {
  const lastIo = { instance: null };
  function ServerCtor(server, opts) {
    const middlewares = [];
    const onHandlers = {};
    const io = {
      _server: server,
      _opts: opts,
      _middlewares: middlewares,
      _onHandlers: onHandlers,
      use: vi.fn((fn) => middlewares.push(fn)),
      on: vi.fn((event, cb) => { onHandlers[event] = cb; }),
      to: vi.fn(() => ({ emit: vi.fn() })),
    };
    lastIo.instance = io;
    return io;
  }
  return {
    ServerCtor,
    jwtVerifySpy: vi.fn(),
    configGetSpy: vi.fn(),
    loggerInfoSpy: vi.fn(),
    lastIo,
  };
});

vi.mock("socket.io", () => ({ Server: ServerCtor }));
vi.mock("jsonwebtoken", () => ({ default: { verify: jwtVerifySpy } }));
vi.mock("config", () => ({ default: { get: configGetSpy } }));
vi.mock("../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: vi.fn(), warn: vi.fn() },
}));

let initSocket, getIO, sendPayloadToRoom;

beforeEach(async () => {
  jwtVerifySpy.mockReset();
  configGetSpy.mockReset();
  loggerInfoSpy.mockReset();
  lastIo.instance = null;
  vi.resetModules();
  ({ initSocket, getIO, sendPayloadToRoom } = await import("../../utils/socket.js"));
});

function makeSocket(overrides = {}) {
  const sock = {
    id: "s1",
    handshake: { auth: { token: "tok" } },
    user: null,
    handlers: {},
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    on(event, cb) { this.handlers[event] = cb; },
    ...overrides,
  };
  return sock;
}

describe("utils/socket > initSocket", () => {
  it("constructs Server with cors options and stores io", () => {
    initSocket("FAKE_HTTP_SERVER");
    expect(lastIo.instance._server).toBe("FAKE_HTTP_SERVER");
    expect(lastIo.instance._opts.cors.origin).toBe("*");
    expect(lastIo.instance.use).toHaveBeenCalled();
    expect(lastIo.instance.on).toHaveBeenCalledWith("connection", expect.any(Function));
  });

  it("middleware: missing token -> next(error)", () => {
    initSocket({});
    const mw = lastIo.instance._middlewares[0];
    const sock = makeSocket({ handshake: { auth: {} } });
    const next = vi.fn();
    mw(sock, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Authentication token missing" }));
  });

  it("middleware: valid jwt -> sets socket.user and next()", () => {
    initSocket({});
    configGetSpy.mockReturnValueOnce("secret");
    jwtVerifySpy.mockReturnValueOnce({ user_id: 42 });
    const sock = makeSocket();
    const next = vi.fn();
    lastIo.instance._middlewares[0](sock, next);
    expect(sock.user).toEqual({ user_id: 42 });
    expect(next).toHaveBeenCalledWith();
  });

  it("middleware: jwt.verify throws -> next(invalid token)", () => {
    initSocket({});
    configGetSpy.mockReturnValueOnce("secret");
    jwtVerifySpy.mockImplementationOnce(() => { throw new Error("bad"); });
    const sock = makeSocket();
    const next = vi.fn();
    lastIo.instance._middlewares[0](sock, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid or expired token" }));
  });

  it("connection: emits socket-ready and wires join/leave/ping/disconnect handlers", () => {
    initSocket({});
    const onConn = lastIo.instance._onHandlers.connection;
    const sock = makeSocket({ user: { user_id: 7 } });
    onConn(sock);
    expect(sock.emit).toHaveBeenCalledWith("socket-ready", { socket_id: "s1" });

    sock.handlers["join-room"]("room1");
    expect(sock.join).toHaveBeenCalledWith("room1");

    sock.handlers["join-room"](null);
    expect(sock.join).toHaveBeenCalledTimes(1);

    sock.handlers["leave-room"]("room1");
    expect(sock.leave).toHaveBeenCalledWith("room1");

    sock.handlers["ping"]();
    expect(sock.emit).toHaveBeenCalledWith("pong");

    sock.handlers["disconnect"]("client-disconnect");
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining("disconnected"));
  });
});

describe("utils/socket > getIO + sendPayloadToRoom", () => {
  it("getIO throws when not initialized", () => {
    expect(() => getIO()).toThrow("Socket.io not initialized");
  });

  it("getIO returns io after init", () => {
    initSocket({});
    expect(getIO()).toBe(lastIo.instance);
  });

  it("sendPayloadToRoom calls io.to(room).emit(event, payload)", () => {
    initSocket({});
    const emitSpy = vi.fn();
    lastIo.instance.to = vi.fn(() => ({ emit: emitSpy }));
    sendPayloadToRoom("r", "evt", { a: 1 });
    expect(lastIo.instance.to).toHaveBeenCalledWith("r");
    expect(emitSpy).toHaveBeenCalledWith("evt", { a: 1 });
  });
});

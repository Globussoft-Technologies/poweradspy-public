import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

const {
  expressFake,
  corsFake,
  swaggerUiFake,
  esCheckSpy, esClosedSpy,
  connectDBSpy,
  configGetSpy,
  loggerInfoSpy, loggerErrorSpy,
  httpFake, fakeHttpServer,
  initSocketSpy,
  routerFake,
} = vi.hoisted(() => {
  const fakeApp = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
  };
  const expressFn = vi.fn(() => fakeApp);
  expressFn.json = vi.fn(() => () => {});
  expressFn.urlencoded = vi.fn(() => () => {});
  expressFn.Router = vi.fn(() => ({ use: vi.fn() }));
  expressFn.static = vi.fn(() => () => {});

  const fakeHttpServer = {
    listen: vi.fn((port, cb) => cb && cb()),
  };

  return {
    expressFake: expressFn,
    corsFake: vi.fn(() => () => {}),
    swaggerUiFake: {
      serve: "swagger-serve",
      setup: vi.fn(() => "swagger-setup"),
    },
    esCheckSpy: vi.fn(),
    esClosedSpy: vi.fn(),
    connectDBSpy: vi.fn(),
    configGetSpy: vi.fn(),
    loggerInfoSpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
    httpFake: { createServer: vi.fn(() => fakeHttpServer) },
    fakeHttpServer,
    initSocketSpy: vi.fn(),
    routerFake: () => {},
  };
});

vi.mock("express", () => ({ default: expressFake }));
vi.mock("cors", () => ({ default: corsFake }));
vi.mock("swagger-ui-express", () => ({ default: swaggerUiFake }));
vi.mock("../utils/authentication.js", () => ({
  SwaggerAuth: vi.fn(),
  verifyToken: vi.fn(),
}));
vi.mock("../utils/Elasticsearch.js", () => ({
  esClient: {},
  esServers: {},
  checkElasticsearchHealth: esCheckSpy,
  closeClients: esClosedSpy,
}));
vi.mock("../resources/routes/routes.js", () => ({ default: routerFake }));
vi.mock("../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));
vi.mock("../resources/database/mongodb.js", () => ({ connectDB: connectDBSpy }));
vi.mock("config", () => ({ default: { get: configGetSpy } }));
vi.mock("node:http", () => ({ default: httpFake }));
vi.mock("../utils/socket.js", () => ({ initSocket: initSocketSpy }));
// dataReportCron pulls in node-cron, which throws on load in this env and kills
// the worker fork — stub it so importing server.js performs no real cron setup.
vi.mock("../core/mailer/dataReportCron.js", () => ({ initDataReportCron: vi.fn() }));

let readFileSyncSpy, exitSpy;

beforeEach(() => {
  expressFake.mockClear();
  corsFake.mockClear();
  esCheckSpy.mockReset();
  connectDBSpy.mockReset();
  configGetSpy.mockReset();
  loggerInfoSpy.mockReset();
  loggerErrorSpy.mockReset();
  fakeHttpServer.listen.mockClear();
  initSocketSpy.mockReset();
  configGetSpy.mockReturnValue(4000);
  readFileSyncSpy = vi.spyOn(fs, "readFileSync").mockReturnValue('{"openapi":"3.0.0"}');
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);
  vi.resetModules();
});

describe("server.js bootstrap", () => {
  it("happy path: ES health + Mongo connect succeed → server.listen called", async () => {
    esCheckSpy.mockResolvedValueOnce(undefined);
    connectDBSpy.mockResolvedValueOnce(undefined);
    await import("../server.js");
    await new Promise((r) => setImmediate(r));
    expect(fakeHttpServer.listen).toHaveBeenCalled();
    expect(initSocketSpy).toHaveBeenCalledWith(fakeHttpServer);
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining("Server started"));
  });

  it("failure path: ES health rejects → logs error + process.exit(1)", async () => {
    esCheckSpy.mockRejectedValueOnce(new Error("es-down"));
    connectDBSpy.mockResolvedValueOnce(undefined);
    await import("../server.js");
    await new Promise((r) => setImmediate(r));
    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to start server"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("reads swagger JSON file at startup", async () => {
    esCheckSpy.mockResolvedValueOnce(undefined);
    connectDBSpy.mockResolvedValueOnce(undefined);
    await import("../server.js");
    expect(readFileSyncSpy).toHaveBeenCalledWith(expect.stringContaining("swagger-api-view.json"), "utf-8");
  });

  it("PORT defaults to 3000 when config.get returns falsy", async () => {
    configGetSpy.mockReturnValue(0);
    esCheckSpy.mockResolvedValueOnce(undefined);
    connectDBSpy.mockResolvedValueOnce(undefined);
    await import("../server.js");
    await new Promise((r) => setImmediate(r));
    expect(fakeHttpServer.listen.mock.calls[0][0]).toBe(3000);
  });
});

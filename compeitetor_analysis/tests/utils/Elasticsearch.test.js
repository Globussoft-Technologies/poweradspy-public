import { describe, it, expect, vi, beforeEach } from "vitest";

const { ClientCtor, configGetSpy, loggerInfoSpy, loggerErrorSpy, lastClients } = vi.hoisted(() => {
  const lastClients = [];
  function ClientCtor(opts) {
    this.opts = opts;
    this.ping = vi.fn();
    this.close = vi.fn();
    lastClients.push(this);
  }
  return {
    ClientCtor,
    configGetSpy: vi.fn(),
    loggerInfoSpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
    lastClients,
  };
});

vi.mock("elasticsearch", () => ({ default: { Client: ClientCtor } }));
vi.mock("config", () => ({ default: { get: configGetSpy } }));
vi.mock("../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

let modulePromise;

beforeEach(async () => {
  configGetSpy.mockReset();
  loggerInfoSpy.mockReset();
  loggerErrorSpy.mockReset();
  lastClients.length = 0;
  // Provide config values for all four servers + their auth credentials
  configGetSpy.mockImplementation((key) => `value:${key}`);
  vi.resetModules();
  modulePromise = import("../../utils/Elasticsearch.js");
});

describe("utils/Elasticsearch", () => {
  it("constructs 4 clients (one per server) at module load", async () => {
    await modulePromise;
    expect(lastClients.length).toBe(4);
  });

  it("exports esClient with server1..server4 keys", async () => {
    const mod = await modulePromise;
    expect(Object.keys(mod.esClient).sort()).toEqual(["server1", "server2", "server3", "server4"]);
  });

  it("logs an info message for each client creation", async () => {
    await modulePromise;
    expect(loggerInfoSpy).toHaveBeenCalled();
  });

  it("checkElasticsearchHealth: pings every client and logs 'is up' on success", async () => {
    const { checkElasticsearchHealth } = await modulePromise;
    lastClients.forEach((c) => c.ping.mockResolvedValueOnce(undefined));
    await checkElasticsearchHealth();
    for (const c of lastClients) expect(c.ping).toHaveBeenCalled();
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining("is up"));
  });

  it("checkElasticsearchHealth: throws and logs when a ping fails", async () => {
    const { checkElasticsearchHealth } = await modulePromise;
    lastClients[0].ping.mockRejectedValueOnce(new Error("down"));
    await expect(checkElasticsearchHealth()).rejects.toThrow("down");
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("is down"),
      expect.any(Error)
    );
  });

  it("closeClients: closes every client and logs", async () => {
    const { closeClients } = await modulePromise;
    lastClients.forEach((c) => c.close.mockResolvedValueOnce(undefined));
    await closeClients();
    for (const c of lastClients) expect(c.close).toHaveBeenCalled();
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining("Closed"));
  });

  it("closeClients: catches per-client close failure (does NOT throw)", async () => {
    const { closeClients } = await modulePromise;
    lastClients[0].close.mockRejectedValueOnce(new Error("close-fail"));
    lastClients.slice(1).forEach((c) => c.close.mockResolvedValueOnce(undefined));
    await closeClients();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error closing"),
      expect.any(Error)
    );
  });
});

describe("utils/Elasticsearch > createElasticClient httpAuth branch", () => {
  it("constructs a client without httpAuth when no username/password", async () => {
    // Reload with username/password explicitly empty so the ternary's false branch runs.
    configGetSpy.mockReset();
    configGetSpy.mockImplementation((key) => {
      if (key.includes("USER") || key.includes("PASS")) return "";
      return "host:9200";
    });
    lastClients.length = 0;
    vi.resetModules();
    await import("../../utils/Elasticsearch.js");
    expect(lastClients[0].opts.httpAuth).toBeUndefined();
  });
});

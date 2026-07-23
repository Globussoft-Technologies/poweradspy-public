import { describe, it, expect, vi, beforeEach } from "vitest";

const { configGet, ClientCtor, countSpy, loggerError, esClient, esServers } = vi.hoisted(() => ({
  configGet: vi.fn(),
  ClientCtor: vi.fn(),
  countSpy: vi.fn(),
  loggerError: vi.fn(),
  esClient: {},
  esServers: {},
}));

// chainable moment stub
function makeM() {
  return {
    utcOffset: () => makeM(),
    clone: () => makeM(),
    subtract: () => makeM(),
    startOf: () => makeM(),
    format: () => "2025-01-02 00:00:00",
  };
}
vi.mock("moment", () => {
  const m = () => makeM();
  m.utc = () => makeM();
  return { default: m };
});
vi.mock("config", () => ({ default: { get: configGet } }));
vi.mock("elasticsearch", () => ({ default: { Client: ClientCtor } }));
vi.mock("../../../utils/Elasticsearch.js", () => ({ esClient, esServers }));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { error: loggerError, info: vi.fn(), warn: vi.fn() },
}));

let svc;
async function load() {
  vi.resetModules();
  ({ getDataReportStats: svc } = await import("../../../core/mailer/dataReportStatsService.js"));
}

beforeEach(() => {
  configGet.mockReset().mockReturnValue({});
  ClientCtor.mockReset().mockImplementation(function (cfg) { this.cfg = cfg; this.count = countSpy; });
  countSpy.mockReset().mockResolvedValue({ count: 5 });
  loggerError.mockReset();
  // one shared server that owns every NETWORKS index
  for (const k of Object.keys(esServers)) delete esServers[k];
  for (const k of Object.keys(esClient)) delete esClient[k];
  esServers.srv = { indexes: [
    "search_mix", "instagram_search_mix", "google_ads_data_v2", "youtube_ads_data",
    "gdn_search_mix", "native_search_mix", "linkedin_ads_data", "quora_search_mix",
    "reddit_search_mix", "pinterest_search_mix", "tiktok_ads",
  ] };
  esClient.srv = { count: countSpy };
});

describe("dataReportStatsService > getDataReportStats", () => {
  it("counts every network via the shared client; grand sums ok platforms", async () => {
    await load();
    const out = await svc();
    expect(out.platforms.length).toBe(11);
    expect(out.platforms.every((p) => p.configured && p.ok)).toBe(true);
    expect(out.grand.total).toBe(11 * 5);
    expect(out.window.since).toBeDefined();
  });

  it("network with no client → configured:false, not summed", async () => {
    esServers.srv.indexes = ["search_mix"]; // only facebook has a server now
    await load();
    const out = await svc();
    const fb = out.platforms.find((p) => p.key === "facebook");
    const insta = out.platforms.find((p) => p.key === "instagram");
    expect(fb.configured).toBe(true);
    expect(insta.configured).toBe(false);
    expect(insta.total).toBe(0);
  });

  it("count throws → caught, ok:false, logs", async () => {
    countSpy.mockRejectedValue(new Error("es-down"));
    await load();
    const out = await svc();
    expect(out.platforms.every((p) => p.ok === false)).toBe(true);
    expect(out.grand.total).toBe(0);
    expect(loggerError).toHaveBeenCalled();
  });

  it("dedicated client from config.data_report_es wins", async () => {
    configGet.mockReturnValue({ facebook: { host: "ded-host", username: "u", password: "p" } });
    await load();
    await svc();
    expect(ClientCtor).toHaveBeenCalledWith(expect.objectContaining({ host: "ded-host", httpAuth: "u:p" }));
  });

  it("dedicated conn without username → httpAuth undefined", async () => {
    configGet.mockReturnValue({ facebook: { host: "ded-host" } });
    await load();
    await svc();
    expect(ClientCtor).toHaveBeenCalledWith(expect.objectContaining({ host: "ded-host", httpAuth: undefined }));
  });

  it("dedicated conn with blank host → ignored (falls back to shared)", async () => {
    configGet.mockReturnValue({ facebook: { host: "   " } });
    await load();
    const out = await svc();
    expect(out.platforms.find((p) => p.key === "facebook").configured).toBe(true);
    expect(ClientCtor).not.toHaveBeenCalled();
  });

  it("esCount reads res.body.count fallback shape", async () => {
    countSpy.mockResolvedValue({ body: { count: 9 } });
    await load();
    const out = await svc();
    expect(out.platforms[0].total).toBe(9);
  });

  it("esCount missing count → 0", async () => {
    countSpy.mockResolvedValue({});
    await load();
    const out = await svc();
    expect(out.platforms[0].total).toBe(0);
  });

  it("config.get returns null at module-load → `|| {}` fallback", async () => {
    configGet.mockReturnValue(null);
    await load();
    const out = await svc();
    expect(out.platforms.every((p) => p.configured)).toBe(true);
  });

  it("config.get throwing at module-load → DR_ES {} (no dedicated)", async () => {
    configGet.mockImplementation(() => { throw new Error("no config"); });
    await load();
    const out = await svc();
    expect(out.platforms.every((p) => p.configured)).toBe(true); // shared clients still used
  });
});

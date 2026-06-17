import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Build a fake elasticsearch module with controllable Client constructor.
const constructedClients = [];
function FakeClient(cfg) {
  this.cfg = cfg;
  this.cluster = { health: vi.fn() };
  this.count = vi.fn();
  this.search = vi.fn();
  constructedClients.push(this);
}
const elasticsearchPath = require.resolve("elasticsearch");
require.cache[elasticsearchPath] = {
  id: elasticsearchPath, filename: elasticsearchPath, loaded: true,
  exports: { Client: FakeClient },
};

process.env.ENVIRONMENT = "PROD";
process.env.ELASTICSEARCH_HOST1 = "es-host-1";
process.env.ELASTICSEARCH_USER1 = "u1";
process.env.ELASTICSEARCH_PASS1 = "p1";
process.env.ELASTICSEARCH_HOST2 = "es-host-2";
process.env.ELASTICSEARCH_USER2 = "u2";
process.env.ELASTICSEARCH_PASS2 = "p2";
process.env.ELASTICSEARCH_HOST3 = "es-host-3";
process.env.ELASTICSEARCH_USER3 = "u3";
process.env.ELASTICSEARCH_PASS3 = "p3";
process.env.ELASTICSEARCH_HOST4 = "es-host-4";
process.env.ELASTICSEARCH_USER4 = "u4";
process.env.ELASTICSEARCH_PASS4 = "p4";

const searchAllInstances = require("../../es-connections/connection");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("es-connections/connection (PROD env)", () => {
  it("constructs one client per host with httpAuth", () => {
    expect(constructedClients.length).toBeGreaterThanOrEqual(4);
    expect(constructedClients[0].cfg.httpAuth).toBe("u1:p1");
  });

  it("count search: returns {node, type, data} where data=count", async () => {
    constructedClients[0].count.mockResolvedValueOnce({ count: 42 });
    const out = await searchAllInstances("idx", { q: 1 }, 0, "count");
    expect(out).toEqual({ node: "es-host-1", type: "count", data: 42 });
  });

  it("search search: returns full response shape", async () => {
    constructedClients[1].search.mockResolvedValueOnce({ hits: { total: 5 } });
    const out = await searchAllInstances("idx", { q: 1 }, 1, "search");
    expect(out.data).toEqual({ hits: { total: 5 } });
  });

  it("catches and logs errors, returns {}", async () => {
    constructedClients[2].search.mockRejectedValueOnce(new Error("es-down"));
    const out = await searchAllInstances("idx", {}, 2, "search");
    expect(out).toEqual({});
  });
});

describe("es-connections/connection (DEV env)", () => {
  it("uses single-client config and forces es_id=0", async () => {
    const modPath = require.resolve("../../es-connections/connection");
    delete require.cache[modPath];
    const prevEnv = process.env.ENVIRONMENT;
    process.env.ENVIRONMENT = "DEV";
    process.env.ELASTICSEARCH_HOST = "es-dev";
    process.env.ELASTICSEARCH_USER = "ud";
    process.env.ELASTICSEARCH_PASS = "pd";
    const devSearch = require("../../es-connections/connection");
    const devClient = constructedClients[constructedClients.length - 1];
    devClient.search.mockResolvedValueOnce({ hits: {} });
    const out = await devSearch("idx", {}, 99, "search");
    expect(out.node).toBe("es-dev");
    process.env.ENVIRONMENT = prevEnv;
  });
});

describe("es-connections/connection (ENVIRONMENT default fallback)", () => {
  it("uses DEV when ENVIRONMENT env var is unset (line 5 `|| 'DEV'` falsy branch)", async () => {
    const modPath = require.resolve("../../es-connections/connection");
    delete require.cache[modPath];
    const prevEnv = process.env.ENVIRONMENT;
    delete process.env.ENVIRONMENT; // unset to force fallback to 'DEV'
    process.env.ELASTICSEARCH_HOST = "es-dev-fallback";
    const beforeCount = constructedClients.length;
    const searchFallback = require("../../es-connections/connection");
    // DEV branch creates exactly one client
    expect(constructedClients.length).toBe(beforeCount + 1);
    const c = constructedClients[constructedClients.length - 1];
    c.search.mockResolvedValueOnce({ hits: { total: 1 } });
    // forces es_id = 0 in DEV regardless of passed-in id
    const out = await searchFallback("idx", {}, 99, "search");
    expect(out.node).toBe("es-dev-fallback");
    process.env.ENVIRONMENT = prevEnv;
  });
});

describe("es-connections/connection > buildClient", () => {
  it("sets httpAuth when auth is provided (truthy branch)", () => {
    const before = constructedClients.length;
    searchAllInstances.buildClient({ host: "es-auth", auth: { username: "u", password: "p" } });
    const built = constructedClients[constructedClients.length - 1];
    expect(constructedClients.length).toBe(before + 1);
    expect(built.cfg.host).toBe("es-auth");
    expect(built.cfg.httpAuth).toBe("u:p");
  });

  it("omits httpAuth when auth is absent (falsy branch)", () => {
    searchAllInstances.buildClient({ host: "es-noauth" });
    const built = constructedClients[constructedClients.length - 1];
    expect(built.cfg.host).toBe("es-noauth");
    expect(built.cfg.httpAuth).toBeUndefined();
  });
});

describe("es-connections/connection > checkAllInstances", () => {
  it("is exposed as a property on the default export (still callable as a function)", () => {
    expect(typeof searchAllInstances).toBe("function");
    expect(typeof searchAllInstances.checkAllInstances).toBe("function");
  });

  it("logs success when cluster.health resolves (try branch)", async () => {
    const fakeClient = { cluster: { health: vi.fn().mockResolvedValue({ status: "green" }) } };
    const fakeConfig = { host: "es-inject-ok" };
    await searchAllInstances.checkAllInstances([fakeClient], [fakeConfig]);
    expect(fakeClient.cluster.health).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("es-inject-ok")
    );
  });

  it("logs failure when cluster.health rejects (catch branch)", async () => {
    const fakeClient = { cluster: { health: vi.fn().mockRejectedValue(new Error("es-down")) } };
    const fakeConfig = { host: "es-inject-bad" };
    await searchAllInstances.checkAllInstances([fakeClient], [fakeConfig]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("es-down")
    );
  });
});

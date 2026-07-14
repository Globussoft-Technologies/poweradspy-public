import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { getDomainsWithoutRegistration, NETWORK_CONFIG, DEFAULT_LIMIT, MAX_LIMIT } =
  require("../../../src/services/common/services/domainsWithoutRegistrationService");
const serviceRegistry = require("../../../src/services/ServiceRegistry");

// Inject a fake network service that records the SQL it was asked to run.
function mockNetwork(name, rows = []) {
  const calls = [];
  serviceRegistry.services.set(name, {
    db: { sql: { query: async (sql, params) => { calls.push({ sql, params }); return rows; } } },
  });
  return calls;
}

afterEach(() => {
  for (const net of Object.keys(NETWORK_CONFIG)) serviceRegistry.services.delete(net);
});

describe("common/services/domainsWithoutRegistrationService > network config", () => {
  it("has config for all 10 networks", () => {
    expect(Object.keys(NETWORK_CONFIG).sort()).toEqual([
      "facebook", "gdn", "google", "instagram", "linkedin",
      "native", "pinterest", "quora", "reddit", "youtube",
    ].sort());
  });

  it("facebook & linkedin sort by last_seen; the rest by updated_date", () => {
    expect(NETWORK_CONFIG.facebook.sortColumn).toBe("last_seen");
    expect(NETWORK_CONFIG.linkedin.sortColumn).toBe("last_seen");
    for (const [net, cfg] of Object.entries(NETWORK_CONFIG)) {
      expect(cfg.table).toBeTruthy();
      if (net !== "facebook" && net !== "linkedin") {
        expect(cfg.sortColumn).toBe("updated_date");
      }
    }
  });
});

describe("common/services/domainsWithoutRegistrationService > validation", () => {
  it("rejects missing network", async () => {
    const out = await getDomainsWithoutRegistration({}, null);
    expect(out.code).toBe(400);
  });

  it("rejects unsupported network", async () => {
    const out = await getDomainsWithoutRegistration({ network: "tiktok" }, null);
    expect(out.code).toBe(400);
  });

  it("rejects non-integer / non-positive limit", async () => {
    for (const bad of ["abc", "0", "-5", "1.5"]) {
      const out = await getDomainsWithoutRegistration({ network: "facebook", limit: bad }, null);
      expect(out.code).toBe(400);
    }
  });

  it("503 when the network's SQL connection is unavailable", async () => {
    const out = await getDomainsWithoutRegistration({ network: "google" }, null);
    expect(out.code).toBe(503);
  });
});

describe("common/services/domainsWithoutRegistrationService > query + limit", () => {
  it("filters NULL registration date, orders by updated_date DESC, applies default limit", async () => {
    const calls = mockNetwork("google", [{ id: 1, domain: "a.com", domain_registered_date: null, updated_date: "2026-01-01" }]);
    const out = await getDomainsWithoutRegistration({ network: "google" }, null);

    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
    expect(out.meta).toMatchObject({ network: "google", limit: DEFAULT_LIMIT, sort_column: "updated_date", count: 1 });

    const sql = calls[0].sql.replace(/\s+/g, " ");
    expect(sql).toContain("FROM google_text_ad_domains");
    expect(sql).toContain("WHERE domain_registered_date IS NULL AND status = 0");
    expect(sql).toContain("GROUP BY domain");
    expect(sql).toContain("ORDER BY MAX(updated_date) DESC");
    expect(sql).toContain(`LIMIT ${DEFAULT_LIMIT}`);
  });

  it("uses last_seen for facebook and clamps limit to the max", async () => {
    const calls = mockNetwork("facebook");
    const out = await getDomainsWithoutRegistration({ network: "facebook", limit: "500" }, null);

    expect(out.code).toBe(200);
    expect(out.meta.limit).toBe(MAX_LIMIT);
    const sql = calls[0].sql.replace(/\s+/g, " ");
    expect(sql).toContain("FROM facebook_ad_domains");
    expect(sql).toContain("ORDER BY MAX(last_seen) DESC");
    expect(sql).toContain(`LIMIT ${MAX_LIMIT}`);
  });

  it("honours a valid in-range limit", async () => {
    const calls = mockNetwork("reddit");
    const out = await getDomainsWithoutRegistration({ network: "reddit", limit: "10" }, null);
    expect(out.meta.limit).toBe(10);
    expect(calls[0].sql.replace(/\s+/g, " ")).toContain("LIMIT 10");
  });

  it("maps a db error to code 400", async () => {
    serviceRegistry.services.set("quora", {
      db: { sql: { query: async () => { throw new Error("boom"); } } },
    });
    const out = await getDomainsWithoutRegistration({ network: "quora" }, null);
    expect(out.code).toBe(400);
  });
});

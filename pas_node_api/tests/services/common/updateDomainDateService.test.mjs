import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { updateDomainDate, NETWORK_CONFIG, isValidYmd } =
  require("../../../src/services/common/services/updateDomainDateService");
const serviceRegistry = require("../../../src/services/ServiceRegistry");

// Fake network service recording every SQL query it runs. `rows` is what the
// initial SELECT returns (null/[] → not found).
function mockNetwork(name, rows = []) {
  const calls = [];
  serviceRegistry.services.set(name, {
    db: { sql: { query: async (sql, params) => { calls.push({ sql, params }); return sql.trim().startsWith("SELECT") ? rows : { affectedRows: 1 }; } } },
  });
  return calls;
}

afterEach(() => {
  for (const net of Object.keys(NETWORK_CONFIG)) serviceRegistry.services.delete(net);
});

describe("updateDomainDateService > config & date validation", () => {
  it("covers all 10 networks; only facebook & linkedin lack updated_date", () => {
    expect(Object.keys(NETWORK_CONFIG).sort()).toEqual([
      "facebook", "gdn", "google", "instagram", "linkedin",
      "native", "pinterest", "quora", "reddit", "youtube",
    ].sort());
    expect(NETWORK_CONFIG.facebook.hasUpdatedDate).toBe(false);
    expect(NETWORK_CONFIG.linkedin.hasUpdatedDate).toBe(false);
    for (const [net, cfg] of Object.entries(NETWORK_CONFIG)) {
      if (net !== "facebook" && net !== "linkedin") expect(cfg.hasUpdatedDate).toBe(true);
    }
  });

  it("validates Y-m-d dates", () => {
    expect(isValidYmd("2026-07-09")).toBe(true);
    expect(isValidYmd("2024-02-29")).toBe(true);   // leap day
    expect(isValidYmd("2026-13-01")).toBe(false);  // bad month
    expect(isValidYmd("2026-02-30")).toBe(false);  // impossible day
    expect(isValidYmd("2026-7-9")).toBe(false);    // not zero-padded
    expect(isValidYmd("09-07-2026")).toBe(false);  // wrong order
    expect(isValidYmd("")).toBe(false);
  });
});

describe("updateDomainDateService > validation errors", () => {
  it("400 when domain_name missing", async () => {
    const out = await updateDomainDate({ domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("domain_name");
  });
  it("400 when domain_date missing", async () => {
    const out = await updateDomainDate({ domain_name: "x.com" }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("domain_date");
  });
  it("400 when domain_date malformed", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "07/09/2026" }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("Y-m-d");
  });
});

describe("updateDomainDateService > cross-network update", () => {
  it("updates where present, skips where absent, bumps updated_date except fb/li", async () => {
    // present in google (+updated_date) and facebook (no updated_date); absent elsewhere.
    const gCalls = mockNetwork("google", [{ id: 11, domain: "x.com", domain_registered_date: null }]);
    const fbCalls = mockNetwork("facebook", [{ id: 22, domain: "x.com", domain_registered_date: "2000-01-01" }]);
    for (const net of Object.keys(NETWORK_CONFIG)) {
      if (net !== "google" && net !== "facebook") mockNetwork(net, []); // not found
    }

    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);

    expect(out.code).toBe(200);
    expect(out.data.summary).toEqual({ updated: 2, not_found: 8, errors: 0 });
    expect(out.data.results.google).toMatchObject({ status: "updated", id: 11, updated_date_touched: true });
    expect(out.data.results.facebook).toMatchObject({ status: "updated", id: 22, updated_date_touched: false, previous_registered_date: "2000-01-01" });
    expect(out.data.results.reddit.status).toBe("not_found");

    // google UPDATE bumps updated_date; facebook UPDATE does not.
    const gUpdate = gCalls.find((c) => c.sql.trim().startsWith("UPDATE"));
    expect(gUpdate.sql.replace(/\s+/g, " ")).toContain("SET domain_registered_date = ?, updated_date = NOW()");
    expect(gUpdate.params).toEqual(["2026-07-09", 11]);

    const fbUpdate = fbCalls.find((c) => c.sql.trim().startsWith("UPDATE"));
    expect(fbUpdate.sql.replace(/\s+/g, " ")).toContain("SET domain_registered_date = ? WHERE id = ?");
    expect(fbUpdate.sql).not.toContain("updated_date");
  });

  it("reports a per-network db error without failing the whole request", async () => {
    for (const net of Object.keys(NETWORK_CONFIG)) mockNetwork(net, []);
    serviceRegistry.services.set("quora", {
      db: { sql: { query: async () => { throw new Error("boom"); } } },
    });
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(200);
    expect(out.data.results.quora.status).toBe("error");
    expect(out.data.summary.errors).toBe(1);
  });

  it("503 when no network has a working SQL connection", async () => {
    // no services registered → getService returns null for every network
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(503);
    expect(out.data.summary.errors).toBe(10);
  });
});

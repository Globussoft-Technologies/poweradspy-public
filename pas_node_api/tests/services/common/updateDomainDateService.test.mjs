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
  it("400 when neither domain_date nor status provided", async () => {
    const out = await updateDomainDate({ domain_name: "x.com" }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("domain_date");
  });
  it("400 when domain_date malformed", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "07/09/2026" }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("Y-m-d");
  });
  it("400 when status is out of range", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", status: 5 }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("status");
  });
  it("400 when status 1 sent without a date", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", status: 1 }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("requires a domain_date");
  });
  it("400 when a date is sent alongside a conflicting status", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09", status: 2 }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("implies status 1");
  });
});

describe("updateDomainDateService > cross-network update", () => {
  it("date → sets registered_date + status 1 on ALL rows, skips absent, bumps updated_date except fb/li", async () => {
    // google has the domain in TWO rows (one dated, one NULL) — both must be updated;
    // facebook has one row (no updated_date); absent elsewhere.
    const gCalls = mockNetwork("google", [
      { id: 11, domain: "x.com", domain_registered_date: null, status: 0 },
      { id: 12, domain: "x.com", domain_registered_date: "1999-01-01", status: 1 },
    ]);
    const fbCalls = mockNetwork("facebook", [{ id: 22, domain: "x.com", domain_registered_date: "2000-01-01", status: 1 }]);
    for (const net of Object.keys(NETWORK_CONFIG)) {
      if (net !== "google" && net !== "facebook") mockNetwork(net, []); // not found
    }

    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);

    expect(out.code).toBe(200);
    expect(out.data.status).toBe(1);
    expect(out.data.summary).toEqual({ updated: 2, not_found: 8, errors: 0 });
    expect(out.data.results.google).toMatchObject({ status: "updated", matched_rows: 2, ids: [11, 12], new_status: 1, updated_date_touched: true });
    expect(out.data.results.facebook).toMatchObject({ status: "updated", matched_rows: 1, ids: [22], new_status: 1, updated_date_touched: false, previous_registered_dates: ["2000-01-01"] });
    expect(out.data.results.reddit.status).toBe("not_found");

    // UPDATE targets the domain (all rows), sets status=1; google bumps updated_date, facebook doesn't.
    const gUpdate = gCalls.find((c) => c.sql.trim().startsWith("UPDATE"));
    expect(gUpdate.sql.replace(/\s+/g, " ")).toContain("SET domain_registered_date = ?, status = ?, updated_date = NOW() WHERE domain = ?");
    expect(gUpdate.params).toEqual(["2026-07-09", 1, "x.com"]);

    const fbUpdate = fbCalls.find((c) => c.sql.trim().startsWith("UPDATE"));
    expect(fbUpdate.sql.replace(/\s+/g, " ")).toContain("SET domain_registered_date = ?, status = ? WHERE domain = ?");
    expect(fbUpdate.sql).not.toContain("updated_date");
    expect(fbUpdate.params).toEqual(["2026-07-09", 1, "x.com"]);
  });

  it("status 2 → marks UNRESOLVABLE without touching the date", async () => {
    const gCalls = mockNetwork("google", [{ id: 11, domain: "junk.com", domain_registered_date: null, status: 0 }]);
    for (const net of Object.keys(NETWORK_CONFIG)) {
      if (net !== "google") mockNetwork(net, []);
    }
    const out = await updateDomainDate({ domain_name: "junk.com", status: 2 }, null);

    expect(out.code).toBe(200);
    expect(out.data.status).toBe(2);
    expect(out.data.domain_date).toBeNull();
    expect(out.data.results.google).toMatchObject({ status: "updated", matched_rows: 1, new_status: 2 });

    const gUpdate = gCalls.find((c) => c.sql.trim().startsWith("UPDATE"));
    expect(gUpdate.sql.replace(/\s+/g, " ")).toContain("SET status = ?, updated_date = NOW() WHERE domain = ?");
    expect(gUpdate.sql).not.toContain("domain_registered_date =");
    expect(gUpdate.params).toEqual([2, "junk.com"]);
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

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

  it("all networks sort by updated_date", () => {
    expect(NETWORK_CONFIG.facebook.sortColumn).toBe("updated_date");
    expect(NETWORK_CONFIG.linkedin.sortColumn).toBe("updated_date");
    for (const [net, cfg] of Object.entries(NETWORK_CONFIG)) {
      expect(cfg.table).toBeTruthy();
      expect(cfg.sortColumn).toBe("updated_date");
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
  it("uses the indexed Google keyset path and applies the default limit", async () => {
    const calls = mockNetwork("google", [{ id: 1, domain: "a.com", domain_registered_date: null, updated_date: "2026-01-01" }]);
    const out = await getDomainsWithoutRegistration({ network: "google" }, null);

    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
    expect(out.meta).toMatchObject({ network: "google", limit: DEFAULT_LIMIT, sort_column: "updated_date", count: 1 });

    const sql = calls[0].sql.replace(/\s+/g, " ");
    expect(sql).toContain("FROM google_text_ad_domains");
    expect(sql).toContain("WHERE domain_registered_date IS NULL AND status = 0");
    expect(sql).toContain("updated_date IS NOT NULL");
    expect(sql).toContain("ORDER BY updated_date DESC, id DESC");
    expect(sql).not.toContain("GROUP BY domain");
    expect(out.meta.query_mode).toBe("indexed_keyset");
    expect(out.meta.scanned_rows).toBe(2);
  });

  it("deduplicates Google domains while preserving newest-first order", async () => {
    const rows = [
      { id: 5, domain: "a.com", updated_date: "2026-01-05" },
      { id: 4, domain: "A.COM", updated_date: "2026-01-04" },
      { id: 3, domain: "b.com", updated_date: "2026-01-03" },
    ];
    mockNetwork("google", rows);

    const out = await getDomainsWithoutRegistration({ network: "google", limit: 2 }, null);

    expect(out.code).toBe(200);
    expect(out.data).toEqual([
      { domain: "a.com", updated_date: "2026-01-05" },
      { domain: "b.com", updated_date: "2026-01-03" },
    ]);
  });

  it("continues with a keyset cursor when the first batch contains only duplicates", async () => {
    const date = "2026-01-05";
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: 200 - index,
      domain: "a.com",
      updated_date: date,
    }));
    const calls = [];
    serviceRegistry.services.set("google", {
      db: { sql: { query: async (sql, params) => {
        calls.push({ sql, params });
        return calls.length === 1
          ? firstBatch
          : [{ id: 99, domain: "b.com", updated_date: "2026-01-04" }];
      } } },
    });

    const out = await getDomainsWithoutRegistration({ network: "google", limit: 2 }, null);

    expect(out.code).toBe(200);
    expect(out.data.map((row) => row.domain)).toEqual(["a.com", "b.com"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].sql.replace(/\s+/g, " ")).toContain("updated_date < ? OR (updated_date = ? AND id < ?)");
    expect(calls[1].params).toEqual([date, date, 101]);
  });

  it("returns retryable 429 when another Google lookup owns the advisory lock", async () => {
    let released = false;
    serviceRegistry.services.set("google", {
      db: {
        sql: {
          getConnection: async () => ({
            query: async () => [[{ acquired: 0 }], []],
            execute: async () => { throw new Error("must not execute"); },
            release: () => { released = true; },
          }),
        },
      },
    });

    const out = await getDomainsWithoutRegistration({ network: "google" }, null);

    expect(out.code).toBe(429);
    expect(out.error.type).toBe("request_in_progress");
    expect(out.error.details.retry_after_seconds).toBe(2);
    expect(released).toBe(true);
  });

  it("uses updated_date for facebook and clamps limit to the max", async () => {
    const calls = mockNetwork("facebook");
    const out = await getDomainsWithoutRegistration({ network: "facebook", limit: "500" }, null);

    expect(out.code).toBe(200);
    expect(out.meta.limit).toBe(MAX_LIMIT);
    const sql = calls[0].sql.replace(/\s+/g, " ");
    expect(sql).toContain("FROM facebook_ad_domains");
    expect(sql).toContain("ORDER BY MAX(updated_date) DESC");
    expect(sql).toContain(`LIMIT ${MAX_LIMIT}`);
  });

  it("honours a valid in-range limit", async () => {
    const calls = mockNetwork("reddit");
    const out = await getDomainsWithoutRegistration({ network: "reddit", limit: "10" }, null);
    expect(out.meta.limit).toBe(10);
    expect(calls[0].sql.replace(/\s+/g, " ")).toContain("LIMIT 10");
  });

  it("maps a db query error to a specific server error", async () => {
    serviceRegistry.services.set("quora", {
      db: { sql: { query: async () => { throw new Error("boom"); } } },
    });
    const out = await getDomainsWithoutRegistration({ network: "quora" }, null);
    expect(out.code).toBe(500);
    expect(out.error).toMatchObject({
      type: "sql_query_error",
      source: "sql",
      operation: "get-domains-without-registration-date",
      network: "quora",
    });
  });
});

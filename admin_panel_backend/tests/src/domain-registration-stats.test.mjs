import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// SUT requires `../db-connections/connection` (queryDatabase fn) and `../utils/cache`.
// Pre-replace both in require.cache so the SUT picks up our stubs (same approach the
// other src/* tests use) — no real MySQL, and a cache we can drive.
const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

const cachePath = require.resolve("../../utils/cache");
const cacheStore = new Map();
const cacheStub = {
  get: vi.fn((k) => cacheStore.get(k)),
  set: vi.fn((k, v) => cacheStore.set(k, v)),
};
require.cache[cachePath] = {
  id: cachePath, filename: cachePath, loaded: true,
  exports: cacheStub,
};

const {
  dailyDomainRegistrationStats,
  getNetworkDailyStats,
  DOMAIN_NETWORKS,
  NETWORK_KEYS,
} = require("../../src/domain-registration-stats");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const RANGE = { from: "2026-07-01", to: "2026-07-07" };

// Every network issues 2 queries: [0] daily buckets, [1] status breakdown.
const dailyRows = (rows) => rows;
const statusRows = (rows) => rows;

// Resolve both queries for all ten networks with the same canned payload.
function mockAllNetworks(daily = [], status = []) {
  queryDatabaseSpy.mockImplementation((db_id, index, sql) =>
    Promise.resolve(sql.includes("GROUP BY day") ? dailyRows(daily) : statusRows(status))
  );
}

beforeEach(() => {
  queryDatabaseSpy.mockReset();
  cacheStore.clear();
  cacheStub.get.mockClear();
  cacheStub.set.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("src/domain-registration-stats > config", () => {
  it("covers exactly the ten supported platforms, in display order", () => {
    expect(NETWORK_KEYS).toEqual([
      "facebook", "instagram", "google", "youtube", "gdn",
      "linkedin", "reddit", "quora", "pinterest", "native",
    ]);
    // TikTok has no SQL domains table and must never appear here.
    expect(DOMAIN_NETWORKS.tiktok).toBeUndefined();
  });

  it("every platform targets the standard updated_date column", () => {
    for (const key of NETWORK_KEYS) {
      expect(DOMAIN_NETWORKS[key].bucketColumn).toBe("updated_date");
    }
    expect(DOMAIN_NETWORKS.facebook.db_id).toBe(0);
    expect(DOMAIN_NETWORKS.pinterest.db_id).toBe(6);
  });

  it("only facebook and linkedin declare a pre-migration fallback", () => {
    expect(DOMAIN_NETWORKS.facebook.fallbackBucketColumn).toBe("dod_date");
    expect(DOMAIN_NETWORKS.linkedin.fallbackBucketColumn).toBe("updated_at");
    // The other eight already have updated_date and never probe the schema.
    for (const key of NETWORK_KEYS.filter((k) => k !== "facebook" && k !== "linkedin")) {
      expect(DOMAIN_NETWORKS[key].fallbackBucketColumn).toBeUndefined();
    }
  });
});

describe("src/domain-registration-stats > validation", () => {
  it("400 when range is missing entirely", async () => {
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/Missing required field: range/);
  });

  it("400 when body itself is absent", async () => {
    const res = mockRes();
    await dailyDomainRegistrationStats({}, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when range.to is missing", async () => {
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: { from: "2026-07-01" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 on a non YYYY-MM-DD date", async () => {
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: { from: "07/01/2026", to: "2026-07-07" } } }, res);
    expect(res.json.mock.calls[0][0].error).toMatch(/must be YYYY-MM-DD/);
  });

  it("400 on a well-formed but impossible date", async () => {
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: { from: "2026-13-45", to: "2026-13-46" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/valid dates/);
  });

  it("400 when from is after to", async () => {
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: { from: "2026-07-07", to: "2026-07-01" } } }, res);
    expect(res.json.mock.calls[0][0].error).toMatch(/must not be after/);
  });

  it("accepts an arbitrarily wide range — a wide scan costs the same as a narrow one", async () => {
    mockAllNetworks();
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: { from: "2020-01-01", to: "2026-07-29" } } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.days).toBe(2402);
  });

  it("reports a single-day range as one day", async () => {
    mockAllNetworks();
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: { from: "2026-07-07", to: "2026-07-07" } } }, res);
    expect(res.json.mock.calls[0][0].data.days).toBe(1);
  });

  it("400 when networks is not a non-empty array", async () => {
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: [] } }, res);
    expect(res.json.mock.calls[0][0].error).toMatch(/non-empty array/);

    const res2 = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: "facebook" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("400 listing the unsupported networks (tiktok is not queryable)", async () => {
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["tiktok", "bing"] } }, res);
    expect(res.json.mock.calls[0][0].error).toMatch(/Unsupported network\(s\): tiktok, bing/);
  });
});

describe("src/domain-registration-stats > aggregation", () => {
  it("queries all ten platforms and totals their daily rows", async () => {
    mockAllNetworks(
      [
        { day: "2026-07-07", processed_count: 10, updated_count: 8, failed_count: 2, last_updated: "2026-07-07 09:00:00" },
        { day: "2026-07-06", processed_count: 5, updated_count: 5, failed_count: 0, last_updated: "2026-07-06 22:10:00" },
      ],
      [{ status: 0, cnt: 100 }, { status: 1, cnt: 40 }, { status: 2, cnt: 6 }]
    );

    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe(200);
    expect(body.data.networks).toHaveLength(10);
    // 2 queries × 10 networks, + the facebook/linkedin bucket-column schema probes
    expect(queryDatabaseSpy).toHaveBeenCalledTimes(22);

    const fb = body.data.networks[0];
    expect(fb.network).toBe("facebook");
    expect(fb.totals).toEqual({
      processed: 15, updated: 13, failed: 2,
      last_updated: "2026-07-07 09:00:00", // newest-first, so the first stamp wins
    });
    expect(fb.backlog).toEqual({ pending: 100, resolved: 40, unresolvable: 6, total: 146 });
    expect(fb.daily[0]).toEqual({
      date: "2026-07-07", processed_count: 10, updated_count: 8, failed_count: 2,
      last_updated: "2026-07-07 09:00:00",
    });

    expect(body.data.summary).toEqual({
      processed: 150, updated: 130, failed: 20, pending: 1000,
      networks_ok: 10, networks_failed: 0,
    });
    expect(body.data.range).toEqual(RANGE);
    expect(body.data.days).toBe(7);
    expect(body.data.generated_at).toEqual(expect.any(String));
  });

  it("builds the daily SQL off each network's own bucket column and binds the range", async () => {
    mockAllNetworks();
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["google"] } }, res);

    const [db_id, index, sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(9);
    expect(index).toBe(DOMAIN_NETWORKS.google.index);
    expect(sql).toMatch(/FROM `google_text_ad_domains`/);
    expect(sql).toMatch(/DATE_FORMAT\(`updated_date`, '%Y-%m-%d'\) AS day/);
    expect(sql).toMatch(/SUM\(`status` = 1\) AS updated_count/);
    expect(sql).toMatch(/SUM\(`status` = 2\) AS failed_count/);
    // Only processed rows count; still-pending rows (status 0) are excluded.
    expect(sql).toMatch(/AND `status` IN \(1, 2\)/);
    expect(params).toEqual(["2026-07-01 00:00:00", "2026-07-07 23:59:59"]);

    // The backlog query groups on status so it can ride idx_domain_status.
    const backlogSql = queryDatabaseSpy.mock.calls[1][2];
    expect(backlogSql).toMatch(/GROUP BY `status`/);
  });

  it("filters to the requested networks but keeps canonical display order", async () => {
    mockAllNetworks();
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["NATIVE", "google"] } }, res);
    const nets = res.json.mock.calls[0][0].data.networks.map((n) => n.network);
    expect(nets).toEqual(["google", "native"]);
  });

  // facebook + linkedin probe information_schema first: updated_date is still being migrated
  // into their tables, so which column is live has to be asked, not assumed.
  const call = (i) => queryDatabaseSpy.mock.calls[i];
  const schemaSays = (present) => (db_id, index, sql) =>
    Promise.resolve(sql.includes("information_schema") ? (present ? [{ COLUMN_NAME: "updated_date" }] : []) : []);

  it.each([
    ["facebook", "facebook_ad_domains", "dod_date"],
    ["linkedin", "linkedin_ad_domains", "updated_at"],
  ])("%s: uses updated_date once the column exists in the schema", async (network, table) => {
    queryDatabaseSpy.mockImplementation(schemaSays(true));
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: [network] } }, res);

    expect(call(0)[2]).toMatch(/information_schema/);
    expect(call(0)[3]).toEqual([DOMAIN_NETWORKS[network].index, table, "updated_date"]);
    expect(call(1)[2]).toMatch(/DATE_FORMAT\(`updated_date`, '%Y-%m-%d'\) AS day/);
    expect(res.json.mock.calls[0][0].data.networks[0].bucket_column).toBe("updated_date");
  });

  it.each([
    ["facebook", "dod_date"],
    ["linkedin", "updated_at"],
  ])("%s: falls back to %s while updated_date is absent", async (network, fallback) => {
    queryDatabaseSpy.mockImplementation(schemaSays(false));
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: [network] } }, res);

    expect(call(1)[2]).toMatch(new RegExp(`DATE_FORMAT\\(\`${fallback}\``));
    expect(res.json.mock.calls[0][0].data.networks[0].bucket_column).toBe(fallback);
  });

  it("a failed schema probe falls back instead of taking the platform down", async () => {
    queryDatabaseSpy.mockImplementation((db_id, index, sql) => {
      if (sql.includes("information_schema")) return Promise.reject(new Error("probe-failed"));
      return Promise.resolve([]);
    });
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["facebook"] } }, res);

    const fb = res.json.mock.calls[0][0].data.networks[0];
    expect(fb.error).toBeNull();
    expect(fb.bucket_column).toBe("dod_date");
  });

  it("caches the resolved column so the probe is not repeated every request", async () => {
    queryDatabaseSpy.mockImplementation(schemaSays(true));
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["facebook"] } }, mockRes());
    // Different range → the payload cache misses, but the schema answer is reused.
    await dailyDomainRegistrationStats(
      { body: { range: { from: "2026-06-01", to: "2026-06-07" }, networks: ["facebook"] } },
      mockRes()
    );
    const probes = queryDatabaseSpy.mock.calls.filter((c) => String(c[2]).includes("information_schema"));
    expect(probes).toHaveLength(1);
    expect(cacheStub.set).toHaveBeenCalledWith(
      "domainRegBucketCol-facebook_ad_domains", "updated_date", 600
    );
  });

  it("the eight already-migrated platforms never pay for a schema probe", async () => {
    mockAllNetworks();
    const settled = NETWORK_KEYS.filter((k) => k !== "facebook" && k !== "linkedin");
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: settled } }, mockRes());
    expect(queryDatabaseSpy.mock.calls.filter((c) => String(c[2]).includes("information_schema"))).toHaveLength(0);
  });

  it("reports the bucket column each platform was measured on", async () => {
    mockAllNetworks();
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["google", "linkedin"] } }, res);
    const [google, linkedin] = res.json.mock.calls[0][0].data.networks;
    expect(google.bucket_column).toBe("updated_date");
    expect(linkedin.bucket_column).toBe("updated_at"); // pre-migration fallback
  });

  it("null/absent rows degrade to zeroed counters rather than NaN", async () => {
    queryDatabaseSpy.mockResolvedValue(undefined);
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["quora"] } }, res);
    const q = res.json.mock.calls[0][0].data.networks[0];
    expect(q.daily).toEqual([]);
    expect(q.totals).toEqual({ processed: 0, updated: 0, failed: 0, last_updated: null });
    expect(q.backlog).toEqual({ pending: 0, resolved: 0, unresolvable: 0, total: 0 });
  });

  it("a day with no stamp keeps last_updated null instead of undefined", async () => {
    mockAllNetworks([{ day: "2026-07-02", processed_count: 3, updated_count: 3, failed_count: 0, last_updated: null }]);
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["reddit"] } }, res);
    const r = res.json.mock.calls[0][0].data.networks[0];
    expect(r.daily[0].last_updated).toBeNull();
    expect(r.totals.last_updated).toBeNull();
  });
});

describe("src/domain-registration-stats > resilience", () => {
  it("one dead network does not sink the other nine", async () => {
    queryDatabaseSpy.mockImplementation((db_id, index, sql) => {
      if (String(index) === String(DOMAIN_NETWORKS.youtube.index)) {
        return Promise.reject(new Error("db-down"));
      }
      return Promise.resolve(sql.includes("GROUP BY day")
        ? [{ day: "2026-07-03", processed_count: 4, updated_count: 4, failed_count: 0, last_updated: "2026-07-03 01:00:00" }]
        : [{ status: 0, cnt: 7 }]);
    });

    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    const yt = body.data.networks.find((n) => n.network === "youtube");
    expect(yt.error).toBe("db-down");
    expect(yt.daily).toEqual([]);
    expect(yt.totals).toEqual({ processed: 0, updated: 0, failed: 0, last_updated: null });
    expect(yt.backlog).toBeNull();
    expect(body.data.summary.networks_ok).toBe(9);
    expect(body.data.summary.networks_failed).toBe(1);
    expect(body.data.summary.processed).toBe(36); // 9 healthy networks × 4
    expect(body.data.summary.pending).toBe(63); // youtube contributes no backlog
  });

  it("500 when something outside the per-network guard blows up", async () => {
    cacheStub.get.mockImplementationOnce(() => { throw new Error("cache exploded"); });
    const res = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ code: 500, error: "Internal Server Error" });
  });
});

describe("src/domain-registration-stats > caching", () => {
  it("serves the cached payload and skips the DB on a repeat request", async () => {
    mockAllNetworks();
    const res1 = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["gdn"] } }, res1);
    const callsAfterFirst = queryDatabaseSpy.mock.calls.length;
    expect(cacheStub.set).toHaveBeenCalledTimes(1);

    const res2 = mockRes();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["gdn"] } }, res2);
    expect(queryDatabaseSpy.mock.calls.length).toBe(callsAfterFirst); // no new queries
    expect(res2.json.mock.calls[0][0]).toEqual(res1.json.mock.calls[0][0]);
  });

  it("keys the cache by range AND network selection", async () => {
    mockAllNetworks();
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["gdn"] } }, mockRes());
    await dailyDomainRegistrationStats({ body: { range: RANGE, networks: ["quora"] } }, mockRes());
    const keys = cacheStub.set.mock.calls.map((c) => c[0]);
    expect(keys).toEqual([
      "domainRegStats-2026-07-01-2026-07-07-gdn",
      "domainRegStats-2026-07-01-2026-07-07-quora",
    ]);
  });
});

describe("src/domain-registration-stats > getNetworkDailyStats", () => {
  it("is exported for direct reuse and returns the per-network shape", async () => {
    mockAllNetworks(
      [{ day: "2026-07-05", processed_count: 2, updated_count: 1, failed_count: 1, last_updated: "2026-07-05 08:00:00" }],
      [{ status: 1, cnt: 3 }]
    );
    const out = await getNetworkDailyStats("pinterest", RANGE);
    expect(out.network).toBe("pinterest");
    expect(out.label).toBe("Pinterest");
    expect(out.table).toBe("pinterest_ad_domains");
    expect(out.bucket_column).toBe("updated_date");
    expect(out.totals).toEqual({ processed: 2, updated: 1, failed: 1, last_updated: "2026-07-05 08:00:00" });
    expect(out.backlog).toEqual({ pending: 0, resolved: 3, unresolvable: 0, total: 3 });
    expect(out.error).toBeNull();
  });

  it("propagates the error so the caller decides how to degrade", async () => {
    queryDatabaseSpy.mockRejectedValue(new Error("boom"));
    await expect(getNetworkDailyStats("native", RANGE)).rejects.toThrow("boom");
  });
});

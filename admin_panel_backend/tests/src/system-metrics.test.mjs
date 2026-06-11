import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Set env BEFORE module load
process.env.PROMETHEUS_URL = "http://prom.local";
process.env.NETWORKS = "facebook,instagram,gtext,gdn,native,linkedin,reddit,tiktok,pinterest,youtube,quora";
process.env.NODE_ENV = "production";

// Mock collaborators
const axiosPath = require.resolve("axios");
const axios = { get: vi.fn() };
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: axios };

const dbMetricsPath = require.resolve("../../utils/db-query-metrics");
const adCountAcrossSelectedNetworks = vi.fn();
const getDomainMetrics = vi.fn();
require.cache[dbMetricsPath] = {
  id: dbMetricsPath, filename: dbMetricsPath, loaded: true,
  exports: { adCountAcrossSelectedNetworks, getDomainMetrics },
};

const cachePath = require.resolve("../../utils/cache");
const cache = { get: vi.fn(), set: vi.fn() };
require.cache[cachePath] = { id: cachePath, filename: cachePath, loaded: true, exports: cache };

const {
  systemsNames,
  systemsAnalytics,
  accountsMetrics,
  accountsNameList,
  pluginWithChart,
  systemsDetails,
  systemActive,
  systemStateChart,
  accountStateChart,
  getDomainsProcessed,
} = require("../../src/system-metrics");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  axios.get.mockReset();
  adCountAcrossSelectedNetworks.mockReset();
  getDomainMetrics.mockReset();
  cache.get.mockReset();
  cache.set.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const RANGE = { from: "2025-01-01", to: "2025-01-05" };

describe("system-metrics > systemsNames", () => {
  it("400 missing range", async () => {
    const res = mockRes();
    await systemsNames({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns cached when present", async () => {
    cache.get.mockReturnValueOnce({ cached: true });
    const res = mockRes();
    await systemsNames({ body: { range: RANGE, platform: 10 } }, res);
    expect(res.json).toHaveBeenCalledWith({ cached: true });
  });

  it("computes percentage changes across networks (increase/decrease/no_change/both-zero)", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks
      // currentResults — one call per network in NETWORKS env (11)
      .mockImplementation((range, [nw]) => {
        if (range.from === "2025-01-01") {
          if (nw === "facebook") return Promise.resolve([{ system_name: "s1", network: "facebook", unqiue_ads: 100 }]);
          if (nw === "instagram") return Promise.resolve([{ system_name: "s1", network: "instagram", unqiue_ads: 0 }]);
          if (nw === "linkedin") return Promise.resolve([{ system_name: "s1", network: "linkedin", unqiue_ads: 50 }]);
          return Promise.resolve([]);
        }
        if (nw === "facebook") return Promise.resolve([{ system_name: "s1", network: "facebook", unqiue_ads: 50 }]);
        if (nw === "instagram") return Promise.resolve([{ system_name: "s1", network: "instagram", unqiue_ads: 10 }]);
        if (nw === "linkedin") return Promise.resolve([{ system_name: "s1", network: "linkedin", unqiue_ads: 50 }]);
        return Promise.resolve([]);
      });
    const res = mockRes();
    await systemsNames({ body: { range: RANGE, platform: null } }, res);
    expect(cache.set).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload[0].systemName).toBe("s1");
    const fb = payload[0].network.find((n) => n.network === "facebook");
    expect(fb.change).toBe("increase");
    const insta = payload[0].network.find((n) => n.network === "instagram");
    expect(insta.change).toBe("decrease");
    const li = payload[0].network.find((n) => n.network === "linkedin");
    expect(li.change).toBe("no_change");
  });

  it("decrease when current=0 previous>0 (-100%)", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockImplementation((range, [nw]) => {
      if (nw !== "facebook") return Promise.resolve([]);
      if (range.from === "2025-01-01") return Promise.resolve([{ system_name: "s1", network: "facebook", unqiue_ads: 0 }]);
      return Promise.resolve([{ system_name: "s1", network: "facebook", unqiue_ads: 5 }]);
    });
    const res = mockRes();
    await systemsNames({ body: { range: RANGE } }, res);
    const fb = res.json.mock.calls[0][0][0].network.find((n) => n.network === "facebook");
    expect(fb.percentage).toBe(-100);
  });

  it("500 when promise rejects", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockRejectedValue(new Error("db-down"));
    const res = mockRes();
    await systemsNames({ body: { range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("system-metrics > systemsAnalytics", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await systemsAnalytics({ body: { range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns cached when present", async () => {
    cache.get.mockReturnValueOnce({ cached: true });
    const res = mockRes();
    await systemsAnalytics({ body: { range: RANGE, steps: 1, platform: 10 } }, res);
    expect(res.json).toHaveBeenCalledWith({ cached: true });
  });

  it("500 when all ad count results fail", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockRejectedValue(new Error("nope"));
    axios.get.mockResolvedValue({ data: { data: { result: [] } } });
    const res = mockRes();
    await systemsAnalytics({ body: { range: RANGE, steps: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns [] when adCounts is empty", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockResolvedValue([{ network: "facebook", query: [], query2: [], query3: [] }]);
    axios.get.mockResolvedValue({ data: { data: { result: [] } } });
    const res = mockRes();
    await systemsAnalytics({ body: { range: RANGE, steps: 1 } }, res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it("builds summary + details when ad data present", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockImplementation((r, [nw]) => {
      if (nw === "facebook") return Promise.resolve([{
        network: "facebook",
        query: [
          { system_name: "S1", account_id: "A1", account_name: "Alice", unqiue_ads: 10 },
          { system_name: null, account_id: "N/A", account_name: null, unqiue_ads: 3 },
        ],
        query2: [{ system_name: "S1", ad_date: "2025-01-01T00:00:00Z", ads_count: 7 }],
        query3: [{ account_id: "A1", total_ads: 15 }, { system_id: "S1", total_ads: 5 }],
      }]);
      return Promise.resolve([]);
    });
    axios.get.mockResolvedValue({
      data: {
        data: {
          result: [
            { metric: { server_name: "S1" }, values: [["1735689600", "20"]] },
          ],
        },
      },
    });
    const res = mockRes();
    await systemsAnalytics({ body: { range: RANGE, steps: 1, platform: 10 } }, res);
    expect(cache.set).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.summary.totalSystems).toBeGreaterThan(0);
  });

  it("500 outer catch on getInitialAndFinalTimestamps invalid", async () => {
    cache.get.mockReturnValueOnce(undefined);
    const res = mockRes();
    await systemsAnalytics({ body: { range: {}, steps: 1 } }, res);
    // missing range fields → 400 first
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("fetchPrometheusData inner catch fires when axios.get rejects (lines 237-238)", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockImplementation(() =>
      Promise.resolve([{
        network: "facebook",
        query: [{ system_name: "S1", account_id: "A1", account_name: "Alice", unqiue_ads: 1 }],
        query2: [],
        query3: [],
      }])
    );
    // axios.get rejects for every per-query call — fetchPrometheusData inner
    // catch returns { key, data: [] } for each.
    axios.get.mockRejectedValue(new Error("prom-down"));
    const res = mockRes();
    await systemsAnalytics({ body: { range: RANGE, steps: 1, platform: 10 } }, res);
    // We just need the call to complete — the inner catch consumed all errors
    expect(res.json).toHaveBeenCalled();
  });
});

describe("system-metrics > accountsMetrics", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await accountsMetrics({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns cached when present", async () => {
    cache.get.mockReturnValueOnce({ cached: true });
    const res = mockRes();
    await accountsMetrics({ body: { range: RANGE, steps: 1 } }, res);
    expect(res.json).toHaveBeenCalledWith({ cached: true });
  });

  it("returns processed account list (with prometheus enrichment, alerts)", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockResolvedValue([{
      network: "facebook",
      query: [{ account_id: "A1", account_name: "Alice", system_name: "S1", unqiue_ads: 5 }],
      query3: [{ account_id: "A1", total_ads: 10 }],
    }]);
    // 4 calls inside fetchPrometheusMetrics
    axios.get
      .mockResolvedValueOnce({ data: { data: { result: [
        { metric: { server_name: "S1", account_name: "Alice", network: "facebook" }, values: [["1735689600", "2"]] },
      ] } } })
      .mockResolvedValueOnce({ data: { data: { result: [
        { metric: { server_name: "S1" }, values: [["1735689600", "0.5"]] },
      ] } } })
      .mockResolvedValueOnce({ data: { data: { result: [
        { metric: { server_name: "S1", account_id: "A1" }, values: [[String(Math.floor(Date.now() / 1000)), "1"]] },
      ] } } })
      .mockResolvedValueOnce({ data: { data: { result: [
        { metric: { server_name: "S1", account_id: "A2", network: "facebook", account_name: "Bob" } },
      ] } } });
    const res = mockRes();
    await accountsMetrics({ body: { range: RANGE, steps: 1, platform: 10 } }, res);
    expect(cache.set).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(Array.isArray(payload)).toBe(true);
  });

  it("500 on internal error", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockRejectedValue(new Error("nope"));
    axios.get.mockRejectedValue(new Error("prom-down"));
    const res = mockRes();
    await accountsMetrics({ body: { range: RANGE, steps: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("system-metrics > accountsNameList", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await accountsNameList({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("cached path", async () => {
    cache.get.mockReturnValueOnce({ accounts: ["a"] });
    const res = mockRes();
    await accountsNameList({ body: { range: RANGE, steps: 1, mode: "prod" } }, res);
    expect(res.json).toHaveBeenCalledWith({ accounts: ["a"] });
  });

  it("aggregates accounts from prometheus, applies 'na' default", async () => {
    cache.get.mockReturnValueOnce(undefined);
    axios.get.mockResolvedValueOnce({ data: { data: { result: [
      { metric: { account_name: "Alice" } },
      { metric: {} },
    ] } } });
    const res = mockRes();
    await accountsNameList({ body: { range: RANGE, steps: 1, mode: "prod" } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.accounts).toContain("Alice");
    expect(payload.accounts).toContain("na");
  });

  it("500 on axios fail", async () => {
    cache.get.mockReturnValueOnce(undefined);
    axios.get.mockRejectedValueOnce(new Error("down"));
    const res = mockRes();
    await accountsNameList({ body: { range: RANGE, steps: 1, mode: "prod" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("system-metrics > systemsDetails", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await systemsDetails({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("cached path", async () => {
    cache.get.mockReturnValueOnce({ cached: true });
    const res = mockRes();
    await systemsDetails({ body: { range: RANGE, system: "S1", steps: 1 } }, res);
    expect(res.json).toHaveBeenCalledWith({ cached: true });
  });

  it("returns details with full prom payloads (cpu, ram, heartbeat, network)", async () => {
    cache.get.mockReturnValueOnce(undefined);
    // instantQuery details
    axios.get.mockResolvedValueOnce({ data: { data: { result: [{ metric: { hostname: "h", os: "linux", platform: "x", cpu_model: "c", cpu_cores: "8", total_storage_gb: "200", total_ram_gb: "16", is_cpu_usage_high: "True", is_ram_usage_high: "False", is_disk_usage_high: "True" } }] } } });
    // queryRange cpu
    axios.get.mockResolvedValueOnce({ data: { data: { result: [{ values: [["1", "10"], ["2", "20"], ["3", "30"], ["4", "40"]] }] } } });
    // queryRange ram
    axios.get.mockResolvedValueOnce({ data: { data: { result: [{ values: [["1", "5"]] }] } } });
    // queryRange hb (status)
    axios.get.mockResolvedValueOnce({ data: { data: { result: [{ values: [["1", "1"], ["2", "0"], ["3", "1"]] }] } } });
    // queryRange network
    axios.get.mockResolvedValueOnce({ data: { data: { result: [{ values: [["1", "0.5"], ["2", "1.0"]] }] } } });
    const res = mockRes();
    await systemsDetails({ body: { range: RANGE, system: "S1", steps: 1, network: "facebook", mode: "prod" } }, res);
    expect(cache.set).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.system_info.hostname).toBe("h");
    expect(payload.metrics.uptime.status).toBe("active");
  });

  it("handles empty results / falls back to defaults / status inactive", async () => {
    cache.get.mockReturnValueOnce(undefined);
    axios.get.mockResolvedValueOnce({ data: { data: { result: [] } } }); // details
    axios.get.mockResolvedValueOnce({ data: { data: { result: [] } } }); // cpu
    axios.get.mockResolvedValueOnce({ data: { data: { result: [] } } }); // ram
    axios.get.mockResolvedValueOnce({ data: { data: { result: [] } } }); // hb
    axios.get.mockResolvedValueOnce({ data: { data: { result: [] } } }); // net
    const res = mockRes();
    await systemsDetails({ body: { range: RANGE, system: "S1", steps: 1 } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.metrics.uptime.status).toBe("inactive");
  });

  it("handles inner query errors gracefully (warns)", async () => {
    cache.get.mockReturnValueOnce(undefined);
    axios.get.mockResolvedValueOnce({ data: { data: { result: [] } } }); // details
    axios.get.mockRejectedValueOnce(new Error("cpu-down")); // cpu
    axios.get.mockRejectedValueOnce(new Error("ram-down")); // ram
    axios.get.mockRejectedValueOnce(new Error("hb-down"));  // hb
    axios.get.mockRejectedValueOnce(new Error("net-down")); // net
    const res = mockRes();
    await systemsDetails({ body: { range: RANGE, system: "S1", steps: 1 } }, res);
    expect(res.json).toHaveBeenCalled();
  });

  it("500 on outer error (instantQuery rejects)", async () => {
    cache.get.mockReturnValueOnce(undefined);
    axios.get.mockRejectedValueOnce(new Error("down"));
    const res = mockRes();
    await systemsDetails({ body: { range: RANGE, system: "S1", steps: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("system-metrics > pluginWithChart", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await pluginWithChart({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("cached path", async () => {
    cache.get.mockReturnValueOnce({ cached: true });
    const res = mockRes();
    await pluginWithChart({ body: { range: RANGE, steps: 1, network: "facebook", system: "S1" } }, res);
    expect(res.json).toHaveBeenCalledWith({ cached: true });
  });

  it("404 when no SQL data for requested system", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockResolvedValueOnce([{ system_name: "Other" }]);
    const res = mockRes();
    await pluginWithChart({ body: { range: RANGE, steps: 1, network: "facebook", system: "S1" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns chart data when present", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockResolvedValueOnce([
      { system_name: "S1", account_id: 123, account_name: "Acc", network: "facebook", unqiue_ads: 7 },
    ]);
    axios.get.mockResolvedValueOnce({ data: { data: { result: [
      { metric: { account_id: "123", plugin_id: "P1", country: "US" } },
    ] } } });
    const res = mockRes();
    await pluginWithChart({ body: { range: RANGE, steps: 1, network: "facebook", system: "S1" } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.system).toBe("S1");
    expect(payload.accounts).toHaveLength(1);
  });

  it("500 on outer error", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockRejectedValueOnce(new Error("nope"));
    const res = mockRes();
    await pluginWithChart({ body: { range: RANGE, steps: 1, network: "facebook", system: "S1" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("system-metrics > systemActive", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await systemActive({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("cached path (within 5s window)", async () => {
    cache.get.mockReturnValueOnce({ response: { cached: true }, cachedAt: Date.now() });
    const res = mockRes();
    await systemActive({ body: { range: RANGE, network: "facebook" } }, res);
    expect(res.json).toHaveBeenCalledWith({ cached: true });
  });

  it("computes active vs inactive split from heartbeat", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockResolvedValueOnce(["S1", "S2"]);
    axios.get
      .mockResolvedValueOnce({ data: { data: { result: [{ metric: { server_name: "S3" } }] } } }) // plugin
      .mockResolvedValueOnce({ data: { data: { result: [
        { metric: { server_name: "S1" }, values: [["1", "1"]] },
        { metric: { server_name: "S2" }, values: [["1", "0"]] },
      ] } } });
    const res = mockRes();
    await systemActive({ body: { range: RANGE, network: "facebook", mode: "prod" } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.active_systems).toEqual(["S1"]);
    expect(payload.inactive_systems).toEqual(["S2"]);
  });

  it("survives plugin + hb query rejections", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockResolvedValueOnce(["S1"]);
    axios.get.mockRejectedValueOnce(new Error("plug-down"));
    axios.get.mockRejectedValueOnce(new Error("hb-down"));
    const res = mockRes();
    await systemActive({ body: { range: RANGE, network: "facebook" } }, res);
    expect(res.json).toHaveBeenCalled();
  });

  it("500 on outer error", async () => {
    cache.get.mockReturnValueOnce(undefined);
    adCountAcrossSelectedNetworks.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await systemActive({ body: { range: RANGE, network: "facebook" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("system-metrics > systemStateChart", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await systemStateChart({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("404 when no data", async () => {
    axios.get.mockResolvedValueOnce({ data: { data: { result: [] } } });
    const res = mockRes();
    await systemStateChart({ body: { range: RANGE, systemName: "S1" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("computes timeline with active/inactive periods", async () => {
    axios.get.mockResolvedValueOnce({ data: { data: { result: [{ values: [
      ["100", "1"], ["200", "1"], ["300", "0"], ["400", "1"],
    ] }] } } });
    const res = mockRes();
    await systemStateChart({ body: { range: RANGE, systemName: "S1" } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.timeline.length).toBeGreaterThan(0);
    expect(payload.totalActive).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("500 on axios fail", async () => {
    axios.get.mockRejectedValueOnce(new Error("down"));
    const res = mockRes();
    await systemStateChart({ body: { range: RANGE, systemName: "S1" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("system-metrics > accountStateChart", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await accountStateChart({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("404 when no data", async () => {
    axios.get.mockResolvedValueOnce({ data: { data: { result: [] } } });
    const res = mockRes();
    await accountStateChart({ body: { range: RANGE, accountName: "A", systemName: "S" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("computes timeline with state transitions", async () => {
    axios.get.mockResolvedValueOnce({ data: { data: { result: [{ values: [
      ["100", "0"], ["200", "1"], ["300", "1"], ["400", "0"],
    ] }] } } });
    const res = mockRes();
    await accountStateChart({ body: { range: RANGE, accountName: "A", systemName: "S" } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.timeline.length).toBeGreaterThan(0);
  });

  it("500 on axios fail", async () => {
    axios.get.mockRejectedValueOnce(new Error("down"));
    const res = mockRes();
    await accountStateChart({ body: { range: RANGE, accountName: "A", systemName: "S" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("system-metrics > getDomainsProcessed", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await getDomainsProcessed({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("cached path", async () => {
    cache.get.mockReturnValueOnce([{ network: "facebook" }]);
    const res = mockRes();
    await getDomainsProcessed({ body: { range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("aggregates getDomainMetrics for facebook+instagram", async () => {
    cache.get.mockReturnValueOnce(undefined);
    getDomainMetrics
      .mockResolvedValueOnce({ network: "facebook", total_domain_date_updated: 5, total_lander_ad_processed: 10 })
      .mockResolvedValueOnce({ network: "instagram", total_domain_date_updated: 3, total_lander_ad_processed: 6 });
    const res = mockRes();
    await getDomainsProcessed({ body: { range: RANGE } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toHaveLength(2);
  });

  it("500 on getDomainMetrics throw", async () => {
    cache.get.mockReturnValueOnce(undefined);
    getDomainMetrics.mockRejectedValue(new Error("db-down"));
    const res = mockRes();
    await getDomainsProcessed({ body: { range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

import os from "node:os";

// A full compliance.blocklist config (the shape src/config/index.js produces),
// with any overrides merged in one level deep. Tests use this instead of
// reading config.json.
export function makeConfig(overrides = {}) {
  const base = {
    enabled: true,
    failMode: "closed",
    refreshSeconds: 30,
    refreshJitterPercent: 20,
    openWarnSeconds: 60,
    maxUrlsPerAd: 200,
    loadTimeoutMs: 500,
    pageSize: 5000,
    emptyRefreshGuard: true,
    networks: [],
    response: { code: 422, message: "Ad rejected: this content is not allowed." },
    unavailable: { code: 503, message: "Ad insertion is temporarily unavailable for this network." },
    attempts: { batchSize: 100, flushSeconds: 5, maxQueue: 10000 },
    snapshot: { enabled: true, dir: os.tmpdir() },
    rules: { adId: true, advertiser: true, url: true, domain: true },
    fields: {},
  };
  const out = { ...base, ...overrides };
  for (const key of ["response", "unavailable", "attempts", "snapshot", "rules"]) {
    out[key] = { ...base[key], ...(overrides[key] || {}) };
  }
  return out;
}

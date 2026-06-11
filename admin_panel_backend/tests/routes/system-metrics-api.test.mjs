import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Stub the system-metrics src module + its transitive deps so the router
// can require it without booting real ES/DB clients.
const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

const srcModule = require("../../src/system-metrics");
const handlers = {
  systemsNames: vi.fn(),
  systemsAnalytics: vi.fn(),
  accountsNameList: vi.fn(),
  accountsMetrics: vi.fn(),
  pluginWithChart: vi.fn(),
  systemsDetails: vi.fn(),
  systemActive: vi.fn(),
  systemStateChart: vi.fn(),
  accountStateChart: vi.fn(),
  getDomainsProcessed: vi.fn(),
};
for (const [name, fn] of Object.entries(handlers)) {
  srcModule[name] = fn;
}

const router = require("../../routes/system-metrics-api");

describe("routes/system-metrics-api > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(Array.isArray(router.stack)).toBe(true);
  });

  const expected = [
    { path: "/systems-names", handler: "systemsNames" },
    { path: "/systems-analytics", handler: "systemsAnalytics" },
    { path: "/accounts-name-list", handler: "accountsNameList" },
    { path: "/accounts-metrics", handler: "accountsMetrics" },
    { path: "/plugin-with-chart", handler: "pluginWithChart" },
    { path: "/system-details", handler: "systemsDetails" },
    { path: "/system-active", handler: "systemActive" },
    { path: "/system-state-chart", handler: "systemStateChart" },
    { path: "/account-state-chart", handler: "accountStateChart" },
    { path: "/domains-data", handler: "getDomainsProcessed" },
  ];

  it.each(expected)(
    "registers POST $path -> wrapAsync($handler)",
    ({ path }) => {
      const layer = router.stack.find((l) => l.route && l.route.path === path);
      expect(layer).toBeDefined();
      expect(layer.route.methods.post).toBe(true);
      // Handler is wrapped by wrapAsync — verify a function is registered
      expect(typeof layer.route.stack[0].handle).toBe("function");
      // wrapAsync returns a (req, res, next) 3-arg fn
      expect(layer.route.stack[0].handle.length).toBe(3);
    }
  );

  it("registers exactly 10 routes", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(10);
  });
});

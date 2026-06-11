import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Pre-cache each sub-router with a unique sentinel so we can verify the
// mount path -> router mapping in main-routes.js without actually loading
// the real sub-routers (they pull in src/* analytics modules + ES clients).
const sentinels = {};
const subRouters = [
  "countries-analytics",
  "types-analytics",
  "funnel-analytics",
  "builtwith-analytics",
  "ad-position-analytics",
  "ad-source-analytics",
  "ad-count-analytics",
  "ad-count-graph-analytics",
  "affiliate-data",
  "network-account-analytics",
  "total-ad-count.anaylytics",
  "range-counts-analytics",
  "system-metrics-api",
  "adsgpt-users-route",
  "agent-config-route",
];

for (const name of subRouters) {
  const p = require.resolve(`../../routes/${name}`);
  const sentinel = function fakeRouter() {};
  sentinel._sentinel = name;
  sentinels[name] = sentinel;
  require.cache[p] = {
    id: p, filename: p, loaded: true, exports: sentinel,
  };
}

const app = require("../../routes/main-routes");

describe("routes/main-routes > sub-router mounting", () => {
  it("exports an express app", () => {
    expect(typeof app).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  // Each app.use(path, router) registers an express layer with path + handle
  const expected = [
    ["/networks-countries", "countries-analytics"],
    ["/networks-types", "types-analytics"],
    ["/networks-funnel", "funnel-analytics"],
    ["/networks-built_with", "builtwith-analytics"],
    ["/affiliate_data", "affiliate-data"],
    ["/networks-position", "ad-position-analytics"],
    ["/networks-source", "ad-source-analytics"],
    ["/networks-ad-counts", "ad-count-analytics"],
    ["/networks-graph", "ad-count-graph-analytics"],
    ["/network-account", "network-account-analytics"],
    ["/network-name", "total-ad-count.anaylytics"],
    ["/network-name", "range-counts-analytics"],
    ["/system-metrics", "system-metrics-api"],
    ["/adsgpt-users", "adsgpt-users-route"],
    ["/agent-config", "agent-config-route"],
  ];

  it.each(expected)(
    "mounts %s -> %s",
    (mountPath, routerName) => {
      // express stores prefix-mounted middleware on app._router.stack
      // (or app.router.stack depending on version). Find layer whose
      // handle is our sentinel.
      const stack = (app._router || app.router).stack;
      const layer = stack.find((l) => l.handle && l.handle._sentinel === routerName);
      expect(layer).toBeDefined();
      // express stores the mount prefix on layer.regexp; convert by
      // looking at the layer's `route` field is not applicable for
      // sub-app mounts. Use layer.regexp.test to verify the path matches.
      expect(layer.regexp.test(mountPath)).toBe(true);
    }
  );
});

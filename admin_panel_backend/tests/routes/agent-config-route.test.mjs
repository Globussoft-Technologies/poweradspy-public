import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const mongoPath = require.resolve("../../mongo-db/connection");
require.cache[mongoPath] = {
  id: mongoPath, filename: mongoPath, loaded: true,
  exports: { getCollection: vi.fn() },
};

const srcModule = require("../../src/agent-config-data");
const handler = vi.fn();
srcModule.fetchAgentData = handler;

const router = require("../../routes/agent-config-route");

describe("routes/agent-config-route > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
  });

  it("registers GET /get-data pointing at fetchAgentData", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/get-data");
    expect(layer).toBeDefined();
    expect(layer.route.methods.get).toBe(true);
    expect(layer.route.stack[0].handle).toBe(handler);
  });

  it("registers exactly one route", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(1);
  });
});

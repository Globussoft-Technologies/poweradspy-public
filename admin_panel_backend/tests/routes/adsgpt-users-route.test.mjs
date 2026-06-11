import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Stub mongo so the src module's `getCollection` import doesn't connect.
const mongoPath = require.resolve("../../mongo-db/connection");
require.cache[mongoPath] = {
  id: mongoPath, filename: mongoPath, loaded: true,
  exports: { getCollection: vi.fn() },
};

const srcModule = require("../../src/adsgpt-user-data");
const getUserInteractionData = vi.fn();
const getUserIds = vi.fn();
const getUsersStats = vi.fn();
const getUserUsageCost = vi.fn();
srcModule.getUserInteractionData = getUserInteractionData;
srcModule.getUserIds = getUserIds;
srcModule.getUsersStats = getUsersStats;
srcModule.getUserUsageCost = getUserUsageCost;

const authPath = require.resolve("../../services/authService");
const authenticateJWT = vi.fn();
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { authenticateJWT },
};

const router = require("../../routes/adsgpt-users-route");

function find(path) {
  return router.stack.find((l) => l.route && l.route.path === path);
}

describe("routes/adsgpt-users-route > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
  });

  it("GET /get-user-data/:userid → getUserInteractionData", () => {
    const layer = find("/get-user-data/:userid");
    expect(layer).toBeDefined();
    expect(layer.route.methods.get).toBe(true);
    expect(layer.route.stack[0].handle).toBe(getUserInteractionData);
  });

  it("GET /get-user-id/ → getUserIds", () => {
    const layer = find("/get-user-id/");
    expect(layer).toBeDefined();
    expect(layer.route.stack[0].handle).toBe(getUserIds);
  });

  it("GET /get-users-stats → getUsersStats", () => {
    const layer = find("/get-users-stats");
    expect(layer).toBeDefined();
    expect(layer.route.stack[0].handle).toBe(getUsersStats);
  });

  it("GET /get-user-usage/:userid → authenticateJWT, getUserUsageCost", () => {
    const layer = find("/get-user-usage/:userid");
    expect(layer).toBeDefined();
    expect(layer.route.stack[0].handle).toBe(authenticateJWT);
    expect(layer.route.stack[1].handle).toBe(getUserUsageCost);
  });

  it("registers exactly four routes", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(4);
  });
});

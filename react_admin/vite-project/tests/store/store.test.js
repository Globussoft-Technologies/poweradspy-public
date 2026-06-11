import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/store/reducers/adsgpt", () => ({
  default: (state = { stub: "adsgpt" }) => state,
}));
vi.mock("../../src/store/reducers/powerAdsPySlice", () => ({
  default: (state = { stub: "poweradspy" }) => state,
}));

describe("store/store.js", () => {
  it("exports a configured store with adsgpt + poweradspy reducers", async () => {
    const { default: store } = await import("../../src/store/store.js");
    expect(typeof store.dispatch).toBe("function");
    expect(typeof store.getState).toBe("function");
    const state = store.getState();
    expect(state).toHaveProperty("adsgpt");
    expect(state).toHaveProperty("poweradspy");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const { svcUpdateSpy, svcGetUrlsSpy } = vi.hoisted(() => ({
  svcUpdateSpy: vi.fn(),
  svcGetUrlsSpy: vi.fn(),
}));

vi.mock("../../../core/builtWithAPI/builtWithAPI.service.js", () => ({
  default: {
    updateBuiltWithStatus: svcUpdateSpy,
    getUrlsForBuiltWith: svcGetUrlsSpy,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  svcUpdateSpy.mockReset();
  svcGetUrlsSpy.mockReset();
  ({ default: controller } = await import(
    "../../../core/builtWithAPI/builtWithAPI.controller.js"
  ));
});

describe("core/builtWithAPI/builtWithAPI.controller > updateBuiltWithStatus", () => {
  it("delegates (req, res) to service.updateBuiltWithStatus", async () => {
    svcUpdateSpy.mockResolvedValueOnce("ok");
    const req = { body: {} };
    const res = {};
    const out = await controller.updateBuiltWithStatus(req, res);
    expect(svcUpdateSpy).toHaveBeenCalledWith(req, res);
    expect(out).toBe("ok");
  });
});

describe("core/builtWithAPI/builtWithAPI.controller > getUrlsForBuiltWith", () => {
  it("delegates (req, res) to service.getUrlsForBuiltWith", async () => {
    svcGetUrlsSpy.mockResolvedValueOnce(["a", "b"]);
    const req = {};
    const res = {};
    const out = await controller.getUrlsForBuiltWith(req, res);
    expect(svcGetUrlsSpy).toHaveBeenCalledWith(req, res);
    expect(out).toEqual(["a", "b"]);
  });
});

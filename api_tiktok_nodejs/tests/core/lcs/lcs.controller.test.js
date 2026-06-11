import { describe, it, expect, vi, beforeEach } from "vitest";

const { svcUpdateSpy, svcGetSpy } = vi.hoisted(() => ({
  svcUpdateSpy: vi.fn(),
  svcGetSpy: vi.fn(),
}));

vi.mock("../../../core/lcs/lcs.service.js", () => ({
  default: { update: svcUpdateSpy, getLCS: svcGetSpy },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  svcUpdateSpy.mockReset();
  svcGetSpy.mockReset();
  ({ default: controller } = await import("../../../core/lcs/lcs.controller.js"));
});

describe("core/lcs/lcs.controller > update", () => {
  it("delegates (req, res) to lcsService.update and returns its result", async () => {
    svcUpdateSpy.mockResolvedValueOnce({ ok: true });
    const req = { body: { id: "x" } };
    const res = {};
    const out = await controller.update(req, res);
    expect(svcUpdateSpy).toHaveBeenCalledWith(req, res);
    expect(out).toEqual({ ok: true });
  });
});

describe("core/lcs/lcs.controller > getLCS", () => {
  it("delegates (req, res) to lcsService.getLCS and returns its result", async () => {
    svcGetSpy.mockResolvedValueOnce({ lcs: 1 });
    const req = { params: { id: "1" } };
    const res = {};
    const out = await controller.getLCS(req, res);
    expect(svcGetSpy).toHaveBeenCalledWith(req, res);
    expect(out).toEqual({ lcs: 1 });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const { create, update, getAll, del, getOne } = vi.hoisted(() => ({
  create: vi.fn(async () => "create-result"),
  update: vi.fn(async () => "update-result"),
  getAll: vi.fn(async () => "getAll-result"),
  del: vi.fn(async () => "delete-result"),
  getOne: vi.fn(async () => "getOne-result"),
}));

vi.mock("../../../core/variants/variants.service.js", () => ({
  default: {
    createVariants: create,
    updateVariants: update,
    getAllVariants: getAll,
    deleteVariants: del,
    getVariants: getOne,
  },
}));

let controller;

beforeEach(async () => {
  vi.resetModules();
  for (const s of [create, update, getAll, del, getOne]) s.mockClear();
  ({ default: controller } = await import(
    "../../../core/variants/veriants.controller.js"
  ));
});

describe("core/variants/veriants.controller > 5 delegations", () => {
  const req = { body: {}, params: {} };
  const res = {};
  const next = vi.fn();

  it("createVariants delegates to service.createVariants(req, res, next)", async () => {
    const r = await controller.createVariants(req, res, next);
    expect(create).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("create-result");
  });

  it("updateVariants delegates to service.updateVariants(req, res, next)", async () => {
    const r = await controller.updateVariants(req, res, next);
    expect(update).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("update-result");
  });

  it("getAllVariants delegates to service.getAllVariants(req, res, next)", async () => {
    const r = await controller.getAllVariants(req, res, next);
    expect(getAll).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("getAll-result");
  });

  it("deleteVariants delegates to service.deleteVariants(req, res, next)", async () => {
    const r = await controller.deleteVariants(req, res, next);
    expect(del).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("delete-result");
  });

  it("getVariants delegates to service.getVariants(req, res, next)", async () => {
    const r = await controller.getVariants(req, res, next);
    expect(getOne).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("getOne-result");
  });
});

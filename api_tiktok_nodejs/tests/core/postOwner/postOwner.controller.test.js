import { describe, it, expect, vi, beforeEach } from "vitest";

const { createSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc } = vi.hoisted(() => ({
  createSvc: vi.fn(),
  updateSvc: vi.fn(),
  getOneSvc: vi.fn(),
  getAllSvc: vi.fn(),
  deleteSvc: vi.fn(),
}));

vi.mock("../../../core/postOwner/postOwner.service.js", () => ({
  default: {
    createPostOwner: createSvc,
    updatePostOwner: updateSvc,
    getPostOwner: getOneSvc,
    getAllPostOwner: getAllSvc,
    deletePostOwner: deleteSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [createSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc]) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/postOwner/postOwner.controller.js"
  ));
});

describe("core/postOwner/postOwner.controller > thin wrappers", () => {
  it("createPostOwner -> service.createPostOwner(req, res, next)", async () => {
    createSvc.mockResolvedValueOnce("c");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.createPostOwner(req, res, next)).toBe("c");
    expect(createSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("updatePostOwner -> service.updatePostOwner(req, res, next)", async () => {
    updateSvc.mockResolvedValueOnce("u");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.updatePostOwner(req, res, next)).toBe("u");
    expect(updateSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("getAllPostOwner -> service.getAllPostOwner(req, res, next)", async () => {
    getAllSvc.mockResolvedValueOnce("ga");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getAllPostOwner(req, res, next)).toBe("ga");
    expect(getAllSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("getPostOwner -> service.getPostOwner(req, res) (no next)", async () => {
    getOneSvc.mockResolvedValueOnce("g1");
    const req = {}, res = {};
    expect(await controller.getPostOwner(req, res)).toBe("g1");
    expect(getOneSvc).toHaveBeenCalledWith(req, res);
  });

  it("deletePostOwner -> service.deletePostOwner(req, res, next)", async () => {
    deleteSvc.mockResolvedValueOnce("d");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.deletePostOwner(req, res, next)).toBe("d");
    expect(deleteSvc).toHaveBeenCalledWith(req, res, next);
  });
});

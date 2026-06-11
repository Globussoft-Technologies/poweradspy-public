import { describe, it, expect, vi, beforeEach } from "vitest";

const { create, del, getAllKw, sendMail, getKw, updateStatus } = vi.hoisted(
  () => ({
    create: vi.fn(async () => "create-result"),
    del: vi.fn(async () => "delete-result"),
    getAllKw: vi.fn(async () => "getAllKw-result"),
    sendMail: vi.fn(async () => "sendMail-result"),
    getKw: vi.fn(async () => "getKw-result"),
    updateStatus: vi.fn(async () => "updateStatus-result"),
  })
);

vi.mock("../../../core/userRequest/userRequest.service.js", () => ({
  default: {
    createUserRequest: create,
    deleteUserRequestData: del,
    getUserRequestKeywords: getAllKw,
    sendRequestedKeywordMail: sendMail,
    getUserReqKeywords: getKw,
    updateUserRequestSentStatus: updateStatus,
  },
}));

let controller;

beforeEach(async () => {
  vi.resetModules();
  for (const s of [create, del, getAllKw, sendMail, getKw, updateStatus])
    s.mockClear();
  ({ default: controller } = await import(
    "../../../core/userRequest/userRequest.controller.js"
  ));
});

describe("core/userRequest/userRequest.controller > 6 delegations", () => {
  const req = { body: {}, params: {}, query: {} };
  const res = {};
  const next = vi.fn();

  it("createUserRequest delegates to service.createUserRequest", async () => {
    const r = await controller.createUserRequest(req, res, next);
    expect(create).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("create-result");
  });

  it("deleteUserRequestData delegates to service.deleteUserRequestData", async () => {
    const r = await controller.deleteUserRequestData(req, res, next);
    expect(del).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("delete-result");
  });

  it("getUserRequestKeywords delegates to service.getUserRequestKeywords", async () => {
    const r = await controller.getUserRequestKeywords(req, res, next);
    expect(getAllKw).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("getAllKw-result");
  });

  it("sendRequestedKeywordMail delegates to service.sendRequestedKeywordMail", async () => {
    const r = await controller.sendRequestedKeywordMail(req, res, next);
    expect(sendMail).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("sendMail-result");
  });

  it("getUserReqKeywords delegates to service.getUserReqKeywords", async () => {
    const r = await controller.getUserReqKeywords(req, res, next);
    expect(getKw).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("getKw-result");
  });

  it("updateUserRequestSentStatus delegates to service.updateUserRequestSentStatus", async () => {
    const r = await controller.updateUserRequestSentStatus(req, res, next);
    expect(updateStatus).toHaveBeenCalledWith(req, res, next);
    expect(r).toBe("updateStatus-result");
  });
});

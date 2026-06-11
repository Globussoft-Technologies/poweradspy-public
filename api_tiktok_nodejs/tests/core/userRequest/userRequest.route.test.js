import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const {
  scheduleSpy,
  sendRequestedKeywordMailSvc,
  updateUserRequestStatusSvc,
  create,
  getReqKw,
  updateStatus,
  del,
  getAllReqKw,
  sendMail,
} = vi.hoisted(() => ({
  scheduleSpy: vi.fn(),
  sendRequestedKeywordMailSvc: vi.fn(),
  updateUserRequestStatusSvc: vi.fn(),
  create: vi.fn((req, res) => res.status(201).json({ from: "create" })),
  getReqKw: vi.fn((req, res) =>
    res.status(200).json({ from: "getReqKw", id: req.params.userid })
  ),
  updateStatus: vi.fn((req, res) =>
    res.status(200).json({ from: "updateStatus" })
  ),
  del: vi.fn((req, res) =>
    res.status(200).json({ from: "del", id: req.params.userrequestid })
  ),
  getAllReqKw: vi.fn((req, res) =>
    res.status(200).json({ from: "getAllReqKw" })
  ),
  sendMail: vi.fn((req, res) => res.status(200).json({ from: "sendMail" })),
}));

vi.mock("node-cron", () => ({
  default: { schedule: scheduleSpy },
  schedule: scheduleSpy,
}));

vi.mock("../../../core/userRequest/userRequest.controller.js", () => ({
  default: {
    createUserRequest: create,
    getUserReqKeywords: getReqKw,
    updateUserRequestSentStatus: updateStatus,
    deleteUserRequestData: del,
    getUserRequestKeywords: getAllReqKw,
    sendRequestedKeywordMail: sendMail,
  },
}));

vi.mock("../../../core/userRequest/userRequest.service.js", () => ({
  default: {
    sendRequestedKeywordMail: sendRequestedKeywordMailSvc,
    updateUserRequestStatus: updateUserRequestStatusSvc,
  },
}));

let router;

beforeEach(async () => {
  vi.resetModules();
  for (const s of [
    scheduleSpy,
    sendRequestedKeywordMailSvc,
    updateUserRequestStatusSvc,
    create,
    getReqKw,
    updateStatus,
    del,
    getAllReqKw,
    sendMail,
  ])
    s.mockClear();
  ({ default: router } = await import(
    "../../../core/userRequest/userRequest.route.js"
  ));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/userRequest/userRequest.route > controller dispatch", () => {
  it("POST /create -> createUserRequest", async () => {
    const res = await request(appWith(router)).post("/create").send({});
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalled();
  });

  it("GET /get-user-request-keyword/:userid -> getUserReqKeywords", async () => {
    const res = await request(appWith(router)).get(
      "/get-user-request-keyword/42"
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "getReqKw", id: "42" });
    expect(getReqKw).toHaveBeenCalled();
  });

  it("PATCH /update-user-request-status -> updateUserRequestSentStatus", async () => {
    const res = await request(appWith(router))
      .patch("/update-user-request-status")
      .send({});
    expect(res.status).toBe(200);
    expect(updateStatus).toHaveBeenCalled();
  });

  it("DELETE /delete/:userrequestid -> deleteUserRequestData", async () => {
    const res = await request(appWith(router)).delete("/delete/9");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "del", id: "9" });
    expect(del).toHaveBeenCalled();
  });

  it("GET /get-usersrequest-keyword -> getUserRequestKeywords", async () => {
    const res = await request(appWith(router)).get("/get-usersrequest-keyword");
    expect(res.status).toBe(200);
    expect(getAllReqKw).toHaveBeenCalled();
  });

  it("GET /send-requested-keyword-mail -> sendRequestedKeywordMail", async () => {
    const res = await request(appWith(router)).get("/send-requested-keyword-mail");
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalled();
  });
});

describe("core/userRequest/userRequest.route > scheduled cron jobs", () => {
  it("registers two daily cron jobs at '0 0 * * *'", () => {
    expect(scheduleSpy).toHaveBeenCalledTimes(2);
    expect(scheduleSpy.mock.calls[0][0]).toBe("0 0 * * *");
    expect(scheduleSpy.mock.calls[1][0]).toBe("0 0 * * *");
  });

  it("first cron callback invokes userRequestService.sendRequestedKeywordMail with (null, fakeRes, fakeNext)", () => {
    const cb = scheduleSpy.mock.calls[0][1];
    cb();
    expect(sendRequestedKeywordMailSvc).toHaveBeenCalledTimes(1);
    const [reqArg, resArg, nextArg] = sendRequestedKeywordMailSvc.mock.calls[0];
    expect(reqArg).toBeNull();
    // Exercise the fakeRes.send + fakeNext stub bodies so coverage hits them
    expect(typeof resArg.send).toBe("function");
    resArg.send({ ok: true });
    expect(typeof nextArg).toBe("function");
    nextArg();
  });

  it("second cron callback invokes userRequestService.updateUserRequestStatus", () => {
    const cb = scheduleSpy.mock.calls[1][1];
    cb();
    expect(updateUserRequestStatusSvc).toHaveBeenCalledTimes(1);
  });
});

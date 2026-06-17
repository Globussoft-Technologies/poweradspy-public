import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  mFind: vi.fn(), mFindOne: vi.fn(), mCreate: vi.fn(), mFindOneAndUpdate: vi.fn(), mDeleteOne: vi.fn(),
  ccFindOne: vi.fn(), ccUpdateMany: vi.fn(), ccUpdateOne: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../../models/member.js", () => ({
  default: { find: h.mFind, findOne: h.mFindOne, create: h.mCreate, findOneAndUpdate: h.mFindOneAndUpdate, deleteOne: h.mDeleteOne },
}));
vi.mock("../../../models/brandCcMember.js", () => ({
  default: { findOne: h.ccFindOne, updateMany: h.ccUpdateMany, updateOne: h.ccUpdateOne },
}));
vi.mock("../../../resources/logs/logger.log.js", () => ({ default: { error: h.loggerError, info: vi.fn(), warn: vi.fn() } }));

const findChain = (data) => ({ sort: () => ({ lean: () => Promise.resolve(data) }), lean: () => Promise.resolve(data) });

let ctrl;
beforeEach(async () => {
  for (const k of Object.keys(h)) h[k].mockReset();
  vi.resetModules();
  ({ default: ctrl } = await import("../../../core/Members/memberController.js"));
});

function mockRes() { const res = {}; res.send = vi.fn(() => res); return res; }
const j = (res) => JSON.stringify(res.send.mock.calls[0][0]);

describe("memberController > no-body `req.body || {}` guards", () => {
  it("every method tolerates a missing body → validation fail", async () => {
    for (const m of ["listMembers", "addMember", "updateMember", "deleteMember", "getBrandCc", "setBrandCc"]) {
      const res = mockRes();
      await ctrl[m]({}, res); // no body
      expect(res.send).toHaveBeenCalled();
    }
  });
  it("addMember with no email → isEmail(undefined) `e || ''` → validation", async () => {
    const res = mockRes();
    await ctrl.addMember({ body: { user_id: 1, name: "Al" } }, res);
    expect(j(res).toLowerCase()).toContain("valid email");
  });
});

describe("memberController > listMembers", () => {
  it("no user_id → validation", async () => {
    const res = mockRes();
    await ctrl.listMembers({ body: {} }, res);
    expect(j(res).toLowerCase()).toContain("user_id is required");
  });
  it("success", async () => {
    h.mFind.mockReturnValue(findChain([{ name: "Al", email: "a@b.c" }]));
    const res = mockRes();
    await ctrl.listMembers({ body: { user_id: 1 } }, res);
    expect(j(res)).toContain("a@b.c");
  });
  it("error → fail", async () => {
    h.mFind.mockImplementation(() => { throw new Error("db"); });
    const res = mockRes();
    await ctrl.listMembers({ body: { user_id: 1 } }, res);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe("memberController > addMember", () => {
  it("missing fields / invalid email → validation", async () => {
    const res = mockRes();
    await ctrl.addMember({ body: { user_id: 1, name: "x", email: "bad" } }, res);
    expect(j(res).toLowerCase()).toContain("valid email");
  });
  it("existing email → fail", async () => {
    h.mFindOne.mockResolvedValue({ _id: "m1" });
    const res = mockRes();
    await ctrl.addMember({ body: { user_id: 1, name: "Al", email: "a@b.c" } }, res);
    expect(j(res)).toContain("already exists");
  });
  it("create → success", async () => {
    h.mFindOne.mockResolvedValue(null);
    h.mCreate.mockResolvedValue({ _id: "m1", email: "a@b.c" });
    const res = mockRes();
    await ctrl.addMember({ body: { user_id: 1, name: "Al", email: "A@B.c" } }, res);
    expect(j(res)).toContain("member added");
  });
  it("duplicate-key (11000) → fail", async () => {
    h.mFindOne.mockResolvedValue(null);
    h.mCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const res = mockRes();
    await ctrl.addMember({ body: { user_id: 1, name: "Al", email: "a@b.c" } }, res);
    expect(j(res)).toContain("already exists");
  });
  it("other error → fail + logs", async () => {
    h.mFindOne.mockResolvedValue(null);
    h.mCreate.mockRejectedValue(new Error("boom"));
    const res = mockRes();
    await ctrl.addMember({ body: { user_id: 1, name: "Al", email: "a@b.c" } }, res);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe("memberController > updateMember", () => {
  it("no ids → validation", async () => {
    const res = mockRes();
    await ctrl.updateMember({ body: { user_id: 1 } }, res);
    expect(j(res).toLowerCase()).toContain("required");
  });
  it("invalid email → validation", async () => {
    const res = mockRes();
    await ctrl.updateMember({ body: { user_id: 1, member_id: "m1", email: "bad" } }, res);
    expect(j(res).toLowerCase()).toContain("invalid email");
  });
  it("name + email patch → success", async () => {
    h.mFindOneAndUpdate.mockResolvedValue({ _id: "m1", name: "New" });
    const res = mockRes();
    await ctrl.updateMember({ body: { user_id: 1, member_id: "m1", name: "New", email: "n@x.c" } }, res);
    expect(j(res)).toContain("member updated");
    expect(h.mFindOneAndUpdate.mock.calls[0][1].$set).toEqual({ name: "New", email: "n@x.c" });
  });
  it("not found → fail", async () => {
    h.mFindOneAndUpdate.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.updateMember({ body: { user_id: 1, member_id: "m1", name: "X" } }, res);
    expect(j(res)).toContain("not found");
  });
  it("duplicate-key (11000) → fail", async () => {
    h.mFindOneAndUpdate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const res = mockRes();
    await ctrl.updateMember({ body: { user_id: 1, member_id: "m1", email: "n@x.c" } }, res);
    expect(j(res)).toContain("already has this email");
  });
  it("other error → fail", async () => {
    h.mFindOneAndUpdate.mockRejectedValue(new Error("boom"));
    const res = mockRes();
    await ctrl.updateMember({ body: { user_id: 1, member_id: "m1", name: "X" } }, res);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe("memberController > deleteMember", () => {
  it("no ids → validation", async () => {
    const res = mockRes();
    await ctrl.deleteMember({ body: { user_id: 1 } }, res);
    expect(j(res).toLowerCase()).toContain("required");
  });
  it("not found → fail", async () => {
    h.mFindOne.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.deleteMember({ body: { user_id: 1, member_id: "m1" } }, res);
    expect(j(res)).toContain("not found");
  });
  it("delete + pull from brand-cc → success", async () => {
    h.mFindOne.mockResolvedValue({ _id: "m1", email: "a@b.c" });
    h.mDeleteOne.mockResolvedValue({});
    h.ccUpdateMany.mockResolvedValue({});
    const res = mockRes();
    await ctrl.deleteMember({ body: { user_id: 1, member_id: "m1" } }, res);
    expect(h.mDeleteOne).toHaveBeenCalled();
    expect(h.ccUpdateMany).toHaveBeenCalled();
    expect(j(res)).toContain("member deleted");
  });
  it("error → fail", async () => {
    h.mFindOne.mockRejectedValue(new Error("db"));
    const res = mockRes();
    await ctrl.deleteMember({ body: { user_id: 1, member_id: "m1" } }, res);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe("memberController > getBrandCc", () => {
  it("no ids → validation", async () => {
    const res = mockRes();
    await ctrl.getBrandCc({ body: { user_id: 1 } }, res);
    expect(j(res).toLowerCase()).toContain("required");
  });
  it("doc found → returns its ids/emails", async () => {
    h.ccFindOne.mockReturnValue(findChain({ member_ids: ["m1"], member_emails: ["a@b.c"] }));
    const res = mockRes();
    await ctrl.getBrandCc({ body: { user_id: 1, project_id: "p1" } }, res);
    expect(j(res)).toContain("a@b.c");
  });
  it("no doc → empty arrays", async () => {
    h.ccFindOne.mockReturnValue(findChain(null));
    const res = mockRes();
    await ctrl.getBrandCc({ body: { user_id: 1, project_id: "p1" } }, res);
    expect(j(res)).toContain("brand cc fetched");
  });
  it("error → fail", async () => {
    h.ccFindOne.mockImplementation(() => { throw new Error("db"); });
    const res = mockRes();
    await ctrl.getBrandCc({ body: { user_id: 1, project_id: "p1" } }, res);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe("memberController > setBrandCc", () => {
  it("no ids → validation", async () => {
    const res = mockRes();
    await ctrl.setBrandCc({ body: { user_id: 1 } }, res);
    expect(j(res).toLowerCase()).toContain("required");
  });
  it("with member_ids → resolves own members + upserts", async () => {
    h.mFind.mockReturnValue(findChain([{ _id: "m1", email: "a@b.c" }, { _id: "m2", email: "a@b.c" }]));
    h.ccUpdateOne.mockResolvedValue({});
    const res = mockRes();
    await ctrl.setBrandCc({ body: { user_id: 1, project_id: "p1", member_ids: ["m1", "m2"] } }, res);
    expect(h.ccUpdateOne).toHaveBeenCalled();
    expect(j(res)).toContain("brand cc updated");
  });
  it("no member_ids (not array) → empty selection", async () => {
    h.ccUpdateOne.mockResolvedValue({});
    const res = mockRes();
    await ctrl.setBrandCc({ body: { user_id: 1, project_id: "p1" } }, res);
    expect(h.mFind).not.toHaveBeenCalled(); // ids empty → no member lookup
  });
  it("error → fail", async () => {
    h.mFind.mockReturnValue(findChain([{ _id: "m1", email: "a@b.c" }]));
    h.ccUpdateOne.mockRejectedValue(new Error("db"));
    const res = mockRes();
    await ctrl.setBrandCc({ body: { user_id: 1, project_id: "p1", member_ids: ["m1"] } }, res);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

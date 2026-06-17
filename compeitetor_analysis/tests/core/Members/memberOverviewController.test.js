import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  memberFind: vi.fn(), userFind: vi.fn(), ccFind: vi.fn(), reqFind: vi.fn(), logFind: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../../models/member.js", () => ({ default: { find: h.memberFind } }));
vi.mock("../../../models/user_details.js", () => ({ default: { find: h.userFind } }));
vi.mock("../../../models/brandCcMember.js", () => ({ default: { find: h.ccFind } }));
vi.mock("../../../models/competitors_request.js", () => ({ default: { find: h.reqFind } }));
vi.mock("../../../models/emailSendLog.js", () => ({ default: { find: h.logFind } }));
vi.mock("../../../resources/logs/logger.log.js", () => ({ default: { error: h.loggerError, info: vi.fn(), warn: vi.fn() } }));

// chain supporting both .lean() and .sort().lean()
const chain = (data) => ({ lean: () => Promise.resolve(data), sort: () => ({ lean: () => Promise.resolve(data) }) });

let ctrl;
beforeEach(async () => {
  for (const k of Object.keys(h)) h[k].mockReset();
  vi.resetModules();
  ({ default: ctrl } = await import("../../../core/Members/memberOverviewController.js"));
});

function mockRes() { const res = {}; res.send = vi.fn(() => res); return res; }
const body = (res) => res.send.mock.calls[0][0].body;

describe("memberOverviewController > overview", () => {
  it("no members → empty owners tree", async () => {
    h.memberFind.mockReturnValue(chain([]));
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    expect(body(res).data.owners).toEqual([]);
    expect(body(res).data.summary.members).toBe(0);
  });

  it("full tree: assignment via member_ids + status totals + an unassigned member", async () => {
    h.memberFind.mockReturnValue(chain([
      { _id: "m1", user_id: "u1", name: "Al", email: "al@x.c", createdAt: 1 },
      { _id: "m2", user_id: "u1", name: "Bo", email: "bo@x.c" }, // unassigned
    ]));
    h.userFind.mockReturnValue(chain([{ _id: "u1", userName: "Owner1", email: "owner@x.c" }]));
    h.ccFind.mockReturnValue(chain([{ user_id: "u1", project_id: "p1", member_ids: ["m1"], member_emails: [], updatedAt: 2 }]));
    h.reqFind.mockReturnValue(chain([{ _id: "p1", advertiser: ["BrandA"], brand_url: "http://a" }]));
    h.logFind.mockReturnValue(chain([
      { to: "al@x.c", status: "sent", meta: { project_id: "p1" }, sent_at: 5 },
      { to: "al@x.c", status: "opened", meta: { project_id: "p1" } },
      { to: "al@x.c", status: "weirdstatus", meta: { project_id: "p1" } }, // not in totals → ignored
    ]));
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    const d = body(res).data;
    expect(d.owners).toHaveLength(1);
    const al = d.owners[0].members.find((m) => m.email === "al@x.c");
    expect(al.assignments[0].brand_name).toBe("BrandA");
    expect(al.assignments[0].last_status).toBe("sent");
    expect(al.assignments[0].totals.opened).toBe(1);
    const bo = d.owners[0].members.find((m) => m.email === "bo@x.c");
    expect(bo.unassigned).toBe(true);
    expect(d.summary.assignments).toBe(1);
  });

  it("assignment matched via member_emails (not ids); project missing meta → null; no log bucket", async () => {
    h.memberFind.mockReturnValue(chain([{ _id: "m1", user_id: "u1", name: "Al", email: "AL@x.c" }]));
    h.userFind.mockReturnValue(chain([])); // owner not found → owner_email null
    h.ccFind.mockReturnValue(chain([{ user_id: "u1", project_id: "pX", member_ids: [], member_emails: ["al@x.c"] }]));
    h.reqFind.mockReturnValue(chain([])); // project not found → meta null
    h.logFind.mockReturnValue(chain([])); // no logs → b null → defaults
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    const a = body(res).data.owners[0].members[0].assignments[0];
    expect(a.brand_name).toBeNull();
    expect(a.last_status).toBeNull();
    expect(a.totals.sent).toBe(0);
  });

  it("no ccRows → projectIds empty (skips project find); members all unassigned", async () => {
    h.memberFind.mockReturnValue(chain([{ _id: "m1", user_id: "u1", email: "al@x.c" }]));
    h.userFind.mockReturnValue(chain([{ _id: "u1", userName: "O", email: "o@x.c" }]));
    h.ccFind.mockReturnValue(chain([]));
    h.logFind.mockReturnValue(chain([]));
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    expect(h.reqFind).not.toHaveBeenCalled(); // no projectIds
    expect(body(res).data.owners[0].members[0].unassigned).toBe(true);
  });

  it("members with no email → memberEmails empty (skips log find)", async () => {
    h.memberFind.mockReturnValue(chain([{ _id: "m1", user_id: "u1", name: "NoEmail" }]));
    h.userFind.mockReturnValue(chain([{ _id: "u1", email: "o@x.c" }]));
    h.ccFind.mockReturnValue(chain([]));
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    expect(h.logFind).not.toHaveBeenCalled();
  });

  it("search matches owner → keeps all members; non-match → filtered out", async () => {
    h.memberFind.mockReturnValue(chain([
      { _id: "m1", user_id: "u1", name: "Al", email: "al@x.c" },
      { _id: "m2", user_id: "u2", name: "Zed", email: "zed@y.c" },
    ]));
    h.userFind.mockReturnValue(chain([
      { _id: "u1", userName: "Owner1", email: "owner@x.c" },
      { _id: "u2", userName: "Other", email: "other@y.c" },
    ]));
    h.ccFind.mockReturnValue(chain([]));
    h.logFind.mockReturnValue(chain([]));
    const res = mockRes();
    await ctrl.overview({ query: { search: "owner@x" } }, res);
    const owners = body(res).data.owners;
    expect(owners).toHaveLength(1);
    expect(owners[0].owner_email).toBe("owner@x.c");
  });

  it("search matches a member (not owner)", async () => {
    h.memberFind.mockReturnValue(chain([
      { _id: "m1", user_id: "u1", name: "Al", email: "findme@x.c" },
      { _id: "m2", user_id: "u1", name: "Bo", email: "bo@x.c" },
    ]));
    h.userFind.mockReturnValue(chain([{ _id: "u1", userName: "Owner1", email: "owner@x.c" }]));
    h.ccFind.mockReturnValue(chain([]));
    h.logFind.mockReturnValue(chain([]));
    const res = mockRes();
    await ctrl.overview({ query: { search: "findme" } }, res);
    const owners = body(res).data.owners;
    expect(owners[0].members).toHaveLength(1);
    expect(owners[0].members[0].email).toBe("findme@x.c");
  });

  it("project advertiser as scalar (not array) → uses it directly", async () => {
    h.memberFind.mockReturnValue(chain([{ _id: "m1", user_id: "u1", email: "al@x.c" }]));
    h.userFind.mockReturnValue(chain([{ _id: "u1", email: "o@x.c" }]));
    h.ccFind.mockReturnValue(chain([{ user_id: "u1", project_id: "p1", member_emails: ["al@x.c"] }]));
    h.reqFind.mockReturnValue(chain([{ _id: "p1", advertiser: "ScalarBrand" }]));
    h.logFind.mockReturnValue(chain([]));
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    expect(body(res).data.owners[0].members[0].assignments[0].brand_name).toBe("ScalarBrand");
  });

  it("rich nulls: missing owner/advertiser/status fields exercise all `|| null/''` + multi-item sorts", async () => {
    h.memberFind.mockReturnValue(chain([
      { _id: "m1", user_id: "u1", name: "Al", email: "al@x.c" },
      { _id: "m2", user_id: "u1", name: "Bo", email: "bo@x.c" }, // u1 → 2 members (sort L185)
      { _id: "m3", user_id: "u2" },                              // u2, no email (memberEmail "")
    ]));
    h.userFind.mockReturnValue(chain([{ _id: "u1", userName: "O1", email: "o1@x.c" }])); // u2 absent → owner null (L62/L183 `|| ''`)
    h.ccFind.mockReturnValue(chain([
      { user_id: "u1", project_id: "p1", member_ids: ["m1"] },
      { user_id: "u1", project_id: "p2", member_ids: ["m1"] }, // m1 → 2 assignments (sort L187)
      { user_id: "u1", member_ids: ["m1"] },                    // no project_id (L141 `|| ''`)
    ]));
    h.reqFind.mockReturnValue(chain([
      { _id: "p1", advertiser: [], project_name: "ProjA" }, // empty array → advertiser[0] undefined → `|| project_name`
      { _id: "p2" },                                         // no advertiser/project_name → `|| null`
    ]));
    h.logFind.mockReturnValue(chain([
      {},                                                              // log: no to/status/sent_at/meta → all fallbacks
      { to: "al@x.c", status: "sent", sent_at: 1, meta: { project_id: "p1" } },
      { to: "al@x.c", createdAt: 9, meta: { project_id: "p2" } },     // no sent_at → createdAt (L105)
    ]));
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    const owners = body(res).data.owners;
    expect(owners.length).toBe(2); // u1 + u2 → outer sort runs
    const u1 = owners.find((o) => o.user_id === "u1");
    expect(u1.members.length).toBe(2); // member sort runs
    const al = u1.members.find((m) => m.email === "al@x.c");
    expect(al.assignments.length).toBe(3); // 3 ccRows match m1 (incl. the no-project_id one) → assignment sort runs
    const p2a = al.assignments.find((a) => a.project_id === "p2");
    expect(p2a.brand_name).toBeNull(); // no advertiser/project_name
  });

  it("search where owner_email/name and member fields are null (L172/L175 `|| ''`)", async () => {
    h.memberFind.mockReturnValue(chain([{ _id: "m1", user_id: "u1" }])); // member no name/email
    h.userFind.mockReturnValue(chain([{ _id: "u1" }]));                   // owner no name/email
    h.ccFind.mockReturnValue(chain([]));
    h.logFind.mockReturnValue(chain([]));
    const res = mockRes();
    await ctrl.overview({ query: { search: "zzz-nomatch" } }, res);
    expect(body(res).data.owners).toEqual([]); // nothing matches
  });

  it("two owners + two members all with null email → both sides of sort `|| ''` (L183/L185)", async () => {
    h.memberFind.mockReturnValue(chain([
      { _id: "m1", user_id: "u1" }, // no email
      { _id: "m2", user_id: "u1" }, // no email → u1 has 2 null-email members (L185 both sides)
      { _id: "m3", user_id: "u2" }, // u2 → 2 null-email owners (L183 both sides)
    ]));
    h.userFind.mockReturnValue(chain([])); // both owners absent → owner_email null on both sides
    h.ccFind.mockReturnValue(chain([]));
    h.logFind.mockReturnValue(chain([]));
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    expect(body(res).data.owners.length).toBe(2);
  });

  it("error → userFailResp + logs", async () => {
    h.memberFind.mockImplementation(() => { throw new Error("db-down"); });
    const res = mockRes();
    await ctrl.overview({ query: {} }, res);
    expect(h.loggerError).toHaveBeenCalled();
    expect(JSON.stringify(body(res)).toLowerCase()).toContain("failed");
  });
});

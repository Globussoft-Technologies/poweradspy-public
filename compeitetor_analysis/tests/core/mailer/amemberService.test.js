import { describe, it, expect, vi, beforeEach } from "vitest";

const { configGet, loggerInfo, loggerError } = vi.hoisted(() => ({
  configGet: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("config", () => ({ default: { get: configGet } }));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfo, error: loggerError, warn: vi.fn() },
}));

let svc;
let pages; // page number -> body
let fetchFail; // page -> {ok:false,status} override

function setFetch() {
  global.fetch = vi.fn((url) => {
    const page = Number(new URL(url).searchParams.get("_page"));
    if (fetchFail && fetchFail[page]) return Promise.resolve({ ok: false, status: fetchFail[page], json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(pages[page] || {}) });
  });
}

beforeEach(async () => {
  configGet.mockReset().mockImplementation((k) => {
    if (k === "amember_api_url") return "https://amember.test/api/";
    if (k === "amember_api_key") return "KEY";
    return "";
  });
  loggerInfo.mockReset();
  loggerError.mockReset();
  pages = {};
  fetchFail = null;
  setFetch();
  vi.resetModules();
  svc = await import("../../../core/mailer/amemberService.js");
});

describe("amemberService > getSubscribedUserEmails", () => {
  it("not configured → throws", async () => {
    configGet.mockImplementation(() => { throw new Error("no cfg"); });
    await expect(svc.getSubscribedUserEmails()).rejects.toThrow(/not configured/);
  });

  it("single page (rows < pageSize) → returns deduped valid emails", async () => {
    pages[0] = {
      _total: 3,
      0: { email: "A@B.com", unsubscribed: "0" },
      1: { email: "a@b.com", unsubscribed: "0" }, // dup (lowercased)
      2: { email: "no-at-sign", unsubscribed: "0" }, // invalid → skipped
      _meta: "ignored",
    };
    const out = await svc.getSubscribedUserEmails({ pageSize: 1000 });
    expect(out.emails).toEqual(["a@b.com"]);
    expect(out.pages).toBe(1);
  });

  it("skips unsubscribed=1 rows", async () => {
    pages[0] = { _total: 2, 0: { email: "a@b.c", unsubscribed: "0" }, 1: { email: "x@y.z", unsubscribed: "1" } };
    const out = await svc.getSubscribedUserEmails({ pageSize: 1000 });
    expect(out.emails).toEqual(["a@b.c"]);
  });

  it("multi-page: fetches page 0 then remaining pages; stops early on a short page", async () => {
    pages[0] = { _total: 6, 0: { email: "a@b.c", unsubscribed: "0" }, 1: { email: "d@e.f", unsubscribed: "0" } }; // 2 rows = pageSize
    pages[1] = { 0: { email: "g@h.i", unsubscribed: "0" } }; // 1 row < pageSize → stoppedEarly
    const out = await svc.getSubscribedUserEmails({ pageSize: 2, concurrency: 2 });
    expect(out.emails.sort()).toEqual(["a@b.c", "d@e.f", "g@h.i"]);
  });

  it("page fetch HTTP error → throws", async () => {
    pages[0] = { _total: 2, 0: { email: "a@b.c", unsubscribed: "0" } };
    fetchFail = { 0: 503 };
    await expect(svc.getSubscribedUserEmails({ pageSize: 1000 })).rejects.toThrow(/HTTP 503/);
  });

  it("null page body → rowsFromPage `|| {}`, total 0, ceil `|| 1` (L29/L62/L64)", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) }));
    const out = await svc.getSubscribedUserEmails({ pageSize: 1000 });
    expect(out.emails).toEqual([]);
    expect(out.total).toBe(0);
    expect(out.pages).toBe(1);
  });

  it("full intermediate page (rows == pageSize) → no early stop, then short page stops (L94 false+true)", async () => {
    pages[0] = { _total: 6, 0: { email: "a@b.c", unsubscribed: "0" }, 1: { email: "b@b.c", unsubscribed: "0" } };
    pages[1] = { 0: { email: "c@b.c", unsubscribed: "0" }, 1: { email: "d@b.c", unsubscribed: "0" } }; // full → continue
    pages[2] = { 0: { email: "e@b.c", unsubscribed: "0" } }; // short → stop
    const out = await svc.getSubscribedUserEmails({ pageSize: 2, concurrency: 1 });
    expect(out.emails.sort()).toEqual(["a@b.c", "b@b.c", "c@b.c", "d@b.c", "e@b.c"]);
  });

  it("row with no email field → `u.email || ''` skipped (L119)", async () => {
    pages[0] = { _total: 2, 0: { unsubscribed: "0" }, 1: { email: "a@b.c", unsubscribed: "0" } };
    const out = await svc.getSubscribedUserEmails({ pageSize: 1000 });
    expect(out.emails).toEqual(["a@b.c"]);
  });
});

describe("amemberService > getSubscribedUsers (rich)", () => {
  it("returns user records with metadata, deduped", async () => {
    pages[0] = {
      _total: 3,
      0: { email: "a@b.c", unsubscribed: "0", added: "2025-01-01", last_login: "2025-02-01", user_id: 7 },
      1: { email: "a@b.c", unsubscribed: "0" }, // dup → skipped
      2: { email: "bad", unsubscribed: "0" },   // invalid → skipped
    };
    const out = await svc.getSubscribedUsers({ pageSize: 1000 });
    expect(out.users).toHaveLength(1);
    expect(out.users[0]).toMatchObject({ email: "a@b.c", added: "2025-01-01", amember_id: 7 });
  });

  it("amember_id falls back member_id → null; skips unsubscribed", async () => {
    pages[0] = {
      _total: 2,
      0: { email: "m@b.c", unsubscribed: "0", member_id: 99 },
      1: { email: "u@b.c", unsubscribed: "1" }, // skipped
    };
    const out = await svc.getSubscribedUsers({ pageSize: 1000 });
    expect(out.users).toHaveLength(1);
    expect(out.users[0].amember_id).toBe(99);
    expect(out.users[0].added).toBeNull();
  });

  it("row with no email field → skipped (L147)", async () => {
    pages[0] = { _total: 2, 0: { unsubscribed: "0" }, 1: { email: "a@b.c", unsubscribed: "0", user_id: 1 } };
    const out = await svc.getSubscribedUsers({ pageSize: 1000 });
    expect(out.users).toHaveLength(1);
  });

  it("multi-page rich path aggregates across pages", async () => {
    pages[0] = { _total: 4, 0: { email: "a@b.c", unsubscribed: "0" }, 1: { email: "d@e.f", unsubscribed: "0" } };
    pages[1] = { 0: { email: "g@h.i", unsubscribed: "0" } }; // short → stop
    const out = await svc.getSubscribedUsers({ pageSize: 2, concurrency: 1 });
    expect(out.users.map((u) => u.email).sort()).toEqual(["a@b.c", "d@e.f", "g@h.i"]);
  });
});

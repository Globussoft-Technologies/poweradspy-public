import { describe, it, expect, vi, beforeEach } from "vitest";
import zlib from "zlib";

const h = vi.hoisted(() => ({
  setApiKey: vi.fn(),
  request: vi.fn(),
  configGet: vi.fn(() => "SG_KEY"),
  loggerError: vi.fn(),
}));

vi.mock("@sendgrid/client", () => ({ default: { setApiKey: h.setApiKey, request: h.request } }));
vi.mock("config", () => ({ default: { get: h.configGet } }));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { error: h.loggerError, info: vi.fn(), warn: vi.fn() },
}));

let svc;
beforeEach(async () => {
  h.setApiKey.mockReset();
  h.request.mockReset();
  h.configGet.mockReset().mockReturnValue("SG_KEY");
  h.loggerError.mockReset();
  global.fetch = vi.fn();
  vi.resetModules();
  svc = await import("../../../core/mailer/sendgridContactsService.js");
});

const gz = (s) => zlib.gzipSync(Buffer.from(s));

describe("sendgridContactsService > getContactsBreakdown", () => {
  it("happy: count + 5 suppression lists, subscribedCount = max(0, total - suppressed)", async () => {
    h.request.mockImplementation(({ url }) => {
      if (url.includes("contacts/count")) return Promise.resolve([{}, { contact_count: 10 }]);
      if (url.includes("/suppression/unsubscribes")) return Promise.resolve([{}, [{ email: "u@x.c", created: 1, reason: "r", status: "s" }]]);
      return Promise.resolve([{}, []]); // other kinds empty
    });
    const out = await svc.getContactsBreakdown();
    expect(out.totalContacts).toBe(10);
    expect(out.suppressions.unsubscribes.count).toBe(1);
    expect(out.suppressions.unsubscribes.emails[0]).toMatchObject({ email: "u@x.c", reason: "r", status: "s" });
    expect(out.subscribedCount).toBe(9);
  });

  it("count call fails → totalContacts 0, logs", async () => {
    h.request.mockImplementation(({ url }) => {
      if (url.includes("contacts/count")) return Promise.reject(new Error("count-down"));
      return Promise.resolve([{}, []]);
    });
    const out = await svc.getContactsBreakdown();
    expect(out.totalContacts).toBe(0);
    expect(h.loggerError).toHaveBeenCalled();
  });

  it("a suppression kind fails → { count:0, error }", async () => {
    h.request.mockImplementation(({ url }) => {
      if (url.includes("contacts/count")) return Promise.resolve([{}, { contact_count: 5 }]);
      if (url.includes("/suppression/bounces")) return Promise.reject(new Error("bounces-down"));
      return Promise.resolve([{}, []]);
    });
    const out = await svc.getContactsBreakdown();
    expect(out.suppressions.bounces).toMatchObject({ count: 0, error: "bounces-down" });
  });

  it("includeEmails:false → counts only, no emails", async () => {
    h.request.mockImplementation(({ url }) => {
      if (url.includes("contacts/count")) return Promise.resolve([{}, { contact_count: 3 }]);
      if (url.includes("/suppression/blocks")) return Promise.resolve([{}, [{ email: "b@x.c" }]]);
      return Promise.resolve([{}, []]);
    });
    const out = await svc.getContactsBreakdown({ includeEmails: false });
    expect(out.suppressions.blocks).toEqual({ count: 1 });
  });

  it("count missing contact_count → 0 (nullish)", async () => {
    h.request.mockImplementation(({ url }) => {
      if (url.includes("contacts/count")) return Promise.resolve([{}, {}]);
      return Promise.resolve([{}, []]);
    });
    const out = await svc.getContactsBreakdown();
    expect(out.totalContacts).toBe(0);
  });

  it("suppression paging: full page then short page", async () => {
    const fullPage = Array.from({ length: 500 }, (_, i) => ({ email: `u${i}@x.c` }));
    let unsubCall = 0;
    h.request.mockImplementation(({ url }) => {
      if (url.includes("contacts/count")) return Promise.resolve([{}, { contact_count: 1000 }]);
      if (url.includes("/suppression/unsubscribes")) {
        unsubCall++;
        return Promise.resolve([{}, unsubCall === 1 ? fullPage : [{ email: "last@x.c" }]]);
      }
      return Promise.resolve([{}, []]);
    });
    const out = await svc.getContactsBreakdown({ includeEmails: false });
    expect(out.suppressions.unsubscribes.count).toBe(501);
    expect(unsubCall).toBe(2); // paged twice
  });
});

describe("sendgridContactsService > getSubscribedContacts", () => {
  function exportFlow({ status = "ready", urls = ["http://csv1"] } = {}) {
    h.request.mockImplementation(({ method, url }) => {
      if (method === "POST" && url.includes("contacts/exports")) return Promise.resolve([{}, { id: "job1" }]);
      if (url.includes("contacts/exports/")) return Promise.resolve([{}, { status, urls }]);
      if (url.includes("/suppression/unsubscribes")) return Promise.resolve([{}, [{ email: "u@x.c" }]]);
      return Promise.resolve([{}, []]);
    });
  }

  it("happy: export → ready → download gz csv → filters unsubscribed", async () => {
    exportFlow();
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => gz("email\na@b.c\nu@x.c\n") });
    const out = await svc.getSubscribedContacts();
    expect(out.totalContacts).toBe(2);
    expect(out.subscribed).toEqual(["a@b.c"]); // u@x.c is unsubscribed
    expect(out.unsubscribed).toBe(1);
  });

  it("export returns no id → throws", async () => {
    h.request.mockImplementation(({ method, url }) => {
      if (method === "POST" && url.includes("contacts/exports")) return Promise.resolve([{}, {}]);
      return Promise.resolve([{}, {}]);
    });
    await expect(svc.getSubscribedContacts()).rejects.toThrow(/job id/);
  });

  it("poll status=failure → throws", async () => {
    exportFlow({ status: "failure" });
    await expect(svc.getSubscribedContacts()).rejects.toThrow(/export failed/);
  });

  it("poll never ready (maxWaitMs 0) → throws timeout", async () => {
    exportFlow({ status: "pending" });
    await expect(svc.getSubscribedContacts({ maxWaitMs: 0 })).rejects.toThrow(/not ready/);
  });

  it("poll pending then ready (exercises sleep loop)", async () => {
    let pollCall = 0;
    h.request.mockImplementation(({ method, url }) => {
      if (method === "POST" && url.includes("contacts/exports")) return Promise.resolve([{}, { id: "job1" }]);
      if (url.includes("contacts/exports/")) {
        pollCall++;
        return Promise.resolve([{}, pollCall === 1 ? { status: "pending" } : { status: "ready", urls: ["http://csv1"] }]);
      }
      if (url.includes("/suppression/unsubscribes")) return Promise.resolve([{}, []]);
      return Promise.resolve([{}, []]);
    });
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => gz("email\na@b.c\n") });
    const out = await svc.getSubscribedContacts({ intervalMs: 0, maxWaitMs: 90000 });
    expect(out.subscribed).toEqual(["a@b.c"]);
    expect(pollCall).toBe(2);
  });

  it("download fetch not ok → logs + skips that url", async () => {
    exportFlow({ urls: ["http://bad", "http://good"] });
    global.fetch.mockImplementation((u) =>
      u === "http://bad"
        ? Promise.resolve({ ok: false, status: 500 })
        : Promise.resolve({ ok: true, arrayBuffer: async () => gz("email\na@b.c\n") }));
    const out = await svc.getSubscribedContacts();
    expect(out.subscribed).toEqual(["a@b.c"]);
    expect(h.loggerError).toHaveBeenCalled();
  });

  it("non-gzipped body → falls back to raw text", async () => {
    exportFlow();
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => Buffer.from("email\nplain@x.c\n") });
    const out = await svc.getSubscribedContacts();
    expect(out.subscribed).toEqual(["plain@x.c"]);
  });

  it("csv with no EMAIL header → no emails", async () => {
    exportFlow();
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => gz("name,age\nfoo,3\n") });
    const out = await svc.getSubscribedContacts();
    expect(out.subscribed).toEqual([]);
  });

  it("empty csv → no emails", async () => {
    exportFlow();
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => gz("   \n\n") });
    const out = await svc.getSubscribedContacts();
    expect(out.subscribed).toEqual([]);
  });

  it("quoted email values + empty cells parsed", async () => {
    exportFlow();
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => gz('"EMAIL"\n"q@x.c"\n""\n') });
    const out = await svc.getSubscribedContacts();
    expect(out.subscribed).toEqual(["q@x.c"]);
  });

  it("poll ready with no urls → `|| []` (L45)", async () => {
    h.request.mockImplementation(({ method, url }) => {
      if (method === "POST" && url.includes("contacts/exports")) return Promise.resolve([{}, { id: "job1" }]);
      if (url.includes("contacts/exports/")) return Promise.resolve([{}, { status: "ready" }]); // no urls
      if (url.includes("/suppression/unsubscribes")) return Promise.resolve([{}, []]);
      return Promise.resolve([{}, []]);
    });
    const out = await svc.getSubscribedContacts();
    expect(out.totalContacts).toBe(0); // no urls → no emails
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("csv row missing the email column → `cols[emailIdx] || ''` (L66)", async () => {
    exportFlow();
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => gz("name,email\nfoo\n") }); // row has 1 col, emailIdx=1 undefined
    const out = await svc.getSubscribedContacts();
    expect(out.subscribed).toEqual([]);
  });

  it("suppression body not an array → treated as [] (L105)", async () => {
    h.request.mockImplementation(({ url }) => {
      if (url.includes("contacts/count")) return Promise.resolve([{}, { contact_count: 1 }]);
      if (url.includes("/suppression/unsubscribes")) return Promise.resolve([{}, { not: "an array" }]);
      return Promise.resolve([{}, []]);
    });
    const out = await svc.getContactsBreakdown({ includeEmails: false });
    expect(out.suppressions.unsubscribes.count).toBe(0);
  });

  it("suppression row without email → skipped (L107)", async () => {
    h.request.mockImplementation(({ url }) => {
      if (url.includes("contacts/count")) return Promise.resolve([{}, { contact_count: 1 }]);
      if (url.includes("/suppression/spam_reports")) return Promise.resolve([{}, [{ created: 1 }, { email: "ok@x.c" }]]);
      return Promise.resolve([{}, []]);
    });
    const out = await svc.getContactsBreakdown({ includeEmails: false });
    expect(out.suppressions.spam_reports.count).toBe(1); // row without email skipped
  });

  it("fetchGlobalUnsubscribes fails → returns all contacts, logs", async () => {
    h.request.mockImplementation(({ method, url }) => {
      if (method === "POST" && url.includes("contacts/exports")) return Promise.resolve([{}, { id: "job1" }]);
      if (url.includes("contacts/exports/")) return Promise.resolve([{}, { status: "ready", urls: ["http://csv1"] }]);
      if (url.includes("/suppression/unsubscribes")) return Promise.reject(new Error("unsub-down"));
      return Promise.resolve([{}, []]);
    });
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => gz("email\na@b.c\n") });
    const out = await svc.getSubscribedContacts();
    expect(out.subscribed).toEqual(["a@b.c"]);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

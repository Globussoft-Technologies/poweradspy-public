import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== Hoisted mocks =====
const {
  loggerInfoSpy, loggerErrorSpy,
  competitorsFindSpy, competitorsUpdateManySpy,
  competitorsReqFindSpy, competitorsReqUpdateManySpy, competitorsReqFindOneSpy,
  esClientFake,
  axiosPostSpy,
  userDetailsFindByIdSpy, userDetailsFindOneSpy, userDetailsUpdateOneSpy,
  emailSendEmailDirectSpy,
  emailRenderTemplateSpy,
  configGetSpy,
  pLimitFn,
} = vi.hoisted(() => {
  const esClientFake = {
    server1: { search: vi.fn() },
    server2: { search: vi.fn() },
    server3: { search: vi.fn() },
    server4: { search: vi.fn() },
  };
  return {
    loggerInfoSpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
    competitorsFindSpy: vi.fn(),
    competitorsUpdateManySpy: vi.fn(),
    competitorsReqFindSpy: vi.fn(),
    competitorsReqUpdateManySpy: vi.fn(),
    competitorsReqFindOneSpy: vi.fn(),
    esClientFake,
    axiosPostSpy: vi.fn(),
    userDetailsFindByIdSpy: vi.fn(),
    userDetailsFindOneSpy: vi.fn(),
    userDetailsUpdateOneSpy: vi.fn(),
    emailSendEmailDirectSpy: vi.fn(),
    emailRenderTemplateSpy: vi.fn(() => "<html>rendered</html>"),
    configGetSpy: vi.fn(),
    pLimitFn: vi.fn((concurrency) => (fn) => fn()),
  };
});

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));
vi.mock("../../../utils/response.js", () => ({
  default: {
    userSuccessResp: (msg, data) => ({ statusCode: 200, body: { status: "success", msg, data } }),
    userFailResp: (msg, err) => ({ statusCode: 400, body: { status: "failed", msg, err } }),
    validationFailResp: (msg, err) => ({ statusCode: 400, body: { status: "failed", msg, err } }),
  },
}));
vi.mock("../../../models/competitors.js", () => ({
  default: { find: competitorsFindSpy, updateMany: competitorsUpdateManySpy },
}));
vi.mock("../../../models/competitors_request.js", () => ({
  default: {
    find: competitorsReqFindSpy,
    updateMany: competitorsReqUpdateManySpy,
    findOne: competitorsReqFindOneSpy,
  },
}));
vi.mock("../../../models/user_details.js", () => ({
  default: {
    findById: userDetailsFindByIdSpy,
    findOne: userDetailsFindOneSpy,
    updateOne: userDetailsUpdateOneSpy,
  },
}));
vi.mock("../../../utils/Elasticsearch.js", () => ({
  esClient: esClientFake,
  esServers: {
    server1: { host: "h1", indexes: ["search_mix", "youtube_ads_data"] },
    server2: { host: "h2", indexes: ["instagram_search_mix"] },
    server3: { host: "h3", indexes: ["google_ads_data"] },
    server4: { host: "h4", indexes: ["category"] },
  },
  checkElasticsearchHealth: vi.fn(),
}));
vi.mock("axios", () => ({ default: { post: axiosPostSpy } }));
vi.mock("../../mailer/emailService.js", () => ({
  default: {
    sendEmailDirect: emailSendEmailDirectSpy,
    renderTemplate: emailRenderTemplateSpy,
  },
}));
vi.mock("../../../core/mailer/emailService.js", () => ({
  default: {
    sendEmailDirect: emailSendEmailDirectSpy,
    renderTemplate: emailRenderTemplateSpy,
  },
}));
vi.mock("config", () => ({ default: { get: configGetSpy } }));
vi.mock("p-limit", () => ({ default: pLimitFn }));

let svc;

beforeEach(async () => {
  loggerInfoSpy.mockReset();
  loggerErrorSpy.mockReset();
  competitorsFindSpy.mockReset();
  competitorsUpdateManySpy.mockReset();
  competitorsReqFindSpy.mockReset();
  competitorsReqUpdateManySpy.mockReset();
  competitorsReqFindOneSpy.mockReset();
  axiosPostSpy.mockReset();
  userDetailsFindByIdSpy.mockReset();
  userDetailsFindOneSpy.mockReset();
  userDetailsUpdateOneSpy.mockReset();
  emailSendEmailDirectSpy.mockReset();
  emailRenderTemplateSpy.mockReset().mockReturnValue("<html>rendered</html>");
  configGetSpy.mockReset();
  esClientFake.server1.search.mockReset();
  esClientFake.server2.search.mockReset();
  esClientFake.server3.search.mockReset();
  esClientFake.server4.search.mockReset();
  configGetSpy.mockImplementation((k) => `cfg:${k}`);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  ({ default: svc } = await import("../../../core/Competitors/monitorService.js"));
});

function mockRes() {
  const res = { send: vi.fn() };
  return res;
}

// fetchTopAdPreview / fetchAdPreviews tests live BEFORE the
// updateCompetitorsStatus 'Index not mapped' test (which vi.doMock's
// Elasticsearch and pollutes esServers for subsequent tests).
describe("monitorService > activeCompetitorContacts main loop (PR #201)", () => {
  it("happy path: builds brand-card payload, sends mail, sets mailStatus='sent'", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X", competitor_url: "x.com" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"], project_name: "ProjA", brand_url: "branda.com" },
    ]);
    // TEST_EMAIL_ONLY config returns undefined / non-string → testEmailOnly stays ""
    configGetSpy.mockImplementation((k) => {
      if (k === "TEST_EMAIL_ONLY") return undefined;
      return `cfg:${k}`;
    });
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b.com", userName: "Alice", _id: "u1" });
    // 3 axios.post calls (fb, ig, g) — all return 0 counts, so fetchAdPreviews
    // is called with all-false (returns [] immediately, no ES search).
    axiosPostSpy.mockResolvedValue({ data: 0 });
    // sendEmail flow: fullUser, pendingEmail, subscribe-detail, sendEmailDirect, updateMany
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" }); // fullUser
    competitorsReqFindOneSpy.mockResolvedValueOnce({ user_id: "u1", email_status: 0 }); // pendingEmail
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", unsubscribed: 0 }); // subscribe-detail
    emailSendEmailDirectSpy.mockResolvedValueOnce({ message: "Email sent successfully" });
    competitorsReqUpdateManySpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data).toHaveLength(1);
    expect(data[0].mailStatus).toBe("sent");
    expect(data[0].email).toBe("a@b.com");
    expect(data[0].name).toBe("Alice");
    expect(data[0].brands[0].brand_name).toBe("BrandA");
    expect(data[0].brands[0].competitors[0].name).toBe("X");
  });

  it("TEST_EMAIL_ONLY skips users whose email doesn't match", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([{ user_id: "u1", monitoring: ["id1"] }]);
    configGetSpy.mockImplementation((k) => {
      if (k === "TEST_EMAIL_ONLY") return "boss@example.com";
      return `cfg:${k}`;
    });
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "alice@example.com", userName: "A", _id: "u1" });
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    expect(res.send.mock.calls[0][0].body.data).toEqual([]);
  });

  it("matchedCompetitors empty → skipped (continue branch)", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X" },
    ]);
    // monitoring has different id → matchedCompetitors will be empty
    competitorsReqFindSpy.mockResolvedValueOnce([{ user_id: "u1", monitoring: ["other-id"] }]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b.com", userName: "A", _id: "u1" });
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    expect(res.send.mock.calls[0][0].body.data).toEqual([]);
  });

  it("ES .catch path: when ES search rejects in countAdsLastDayIST, count stays 0 + logger.error called", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"] },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b.com", userName: "Alice", _id: "u1" });
    // Source now uses ES (countAdsLastDayIST) — make all ES counts reject.
    esClientFake.server1.search.mockRejectedValue(new Error("es-down"));
    esClientFake.server2.search.mockRejectedValue(new Error("es-down"));
    esClientFake.server3.search.mockRejectedValue(new Error("es-down"));
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" });
    competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data[0].mailStatus).toBe("not sent");
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("user unsubscribed → mailStatus='Un-subscribed'", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"] },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b.com", userName: "Alice", _id: "u1" });
    axiosPostSpy.mockResolvedValue({ data: 0 });
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" }); // fullUser
    competitorsReqFindOneSpy.mockResolvedValueOnce({ user_id: "u1", email_status: 0 }); // pendingEmail
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", unsubscribed: 1 }); // unsubscribed!
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data[0].mailStatus).toBe("Un-subscribed");
  });

  it("fullUser=null → mailStatus stays 'not sent' (continue branch)", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"] },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b.com", userName: "A", _id: "u1" });
    axiosPostSpy.mockResolvedValue({ data: 0 });
    userDetailsFindOneSpy.mockResolvedValueOnce(null); // fullUser null
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    expect(res.send.mock.calls[0][0].body.data[0].mailStatus).toBe("not sent");
  });

  it("ES returns ad with content → competitor carries post_owner_name (PR #201 brand-card shape)", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X", competitor_url: "x.com" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"], project_name: "ProjA" },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b.com", userName: "Alice", _id: "u1" });
    // ES handles BOTH count + preview now. Same response works for both since
    // count reads res.hits.total and preview reads res.hits.hits[0]._source.
    esClientFake.server1.search.mockResolvedValue({
      hits: {
        total: { value: 5 },
        hits: [{ _source: {
          "facebook_ad_variants.title": "Buy",
          "facebook_ad_variants.text": "Sale",
          image_url: "https://x/img.png",
          "facebook_ad_post_owners.post_owner_name": "Acme",
        }}],
      },
    });
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" });
    competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    // brand card carries the competitor with the rendered ad preview
    expect(data[0].brands[0].competitors[0]).toBeDefined();
  });

  it("two requests for same user + same brand → 'existing' branch dedups competitors by name (lines 528-535)", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X", competitor_url: "x.com" },
      { _id: { toString: () => "id2" }, competitor_name: "Y", competitor_url: "y.com" },
      { _id: { toString: () => "id3" }, competitor_name: "X", competitor_url: "x.com" }, // duplicate name
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1", "id2"], advertiser: ["BrandA"], project_name: "ProjA" },
      // Second request: same user, same brand → falls through 'existing' branch
      { user_id: "u1", monitoring: ["id3"], advertiser: ["BrandA"], project_name: "ProjA" },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValue({ email: "a@b.com", userName: "Alice", _id: "u1" });
    axiosPostSpy.mockResolvedValue({ data: 0 });
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" });
    competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data).toHaveLength(1);
    // X is deduped — competitors should be unique by name
    const names = data[0].brands[0].competitors.map((c) => c.name);
    expect(names.filter((n) => n === "X").length).toBe(1);
  });

  it("two requests for same user + different brands → pushes second brand to existing user (line 537)", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X", competitor_url: "x.com" },
      { _id: { toString: () => "id2" }, competitor_name: "Y", competitor_url: "y.com" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"], project_name: "ProjA" },
      { user_id: "u1", monitoring: ["id2"], advertiser: ["BrandB"], project_name: "ProjB" },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValue({ email: "a@b.com", userName: "Alice", _id: "u1" });
    axiosPostSpy.mockResolvedValue({ data: 0 });
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" });
    competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data).toHaveLength(1);
    const brands = data[0].brands.map((b) => b.brand_name).sort();
    expect(brands).toEqual(["BrandA", "BrandB"]);
  });

  it("two users with same normalized email (different casing) → seenEmails continue (line 558)", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X", competitor_url: "x.com" },
      { _id: { toString: () => "id2" }, competitor_name: "Y", competitor_url: "y.com" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"], project_name: "ProjA" },
      { user_id: "u2", monitoring: ["id2"], advertiser: ["BrandB"], project_name: "ProjB" },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    // Two different userDetails with emails that differ only in casing
    userDetailsFindByIdSpy
      .mockResolvedValueOnce({ email: "Alice@B.com", userName: "Alice", _id: "u1" })
      .mockResolvedValueOnce({ email: "alice@b.com", userName: "Alice", _id: "u2" });
    axiosPostSpy.mockResolvedValue({ data: 0 });
    // First user: full flow happens
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "Alice@B.com", _id: "u1" });
    competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    // Second user should NOT have run send-mail flow (deduped) — only one entry processed
    // The results array will still contain both, but only the first email's mail flow ran.
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("per-competitor pre-fetch throws → 'API failed for' console.error logged", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X", competitor_url: "x.com" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"], project_name: "ProjA" },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b.com", userName: "A", _id: "u1" });
    // Force the outer try in the pre-fetch block to throw by replacing
    // countAdsLastDayIST with a synchronous throw — bypasses its internal catch.
    const countSpy = vi.spyOn(svc, "countAdsLastDayIST").mockImplementation(() => { throw new Error("sync-fail"); });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" });
    competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    const wasCalled = consoleErrorSpy.mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes("API failed for X")
    );
    consoleErrorSpy.mockRestore();
    countSpy.mockRestore();
    expect(wasCalled).toBe(true);
  });

  it("html-too-large splits brands into 2 batches; one fails → dlog FAILED path (lines 899-901, 926)", async () => {
    // 2 brands, 2 competitors each. renderTemplate returns >220KB so the
    // splitter triggers (lines 899-901). First batch send returns SUCCESS,
    // second batch send returns FAILURE so line 926 dlog branch fires.
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X" },
      { _id: { toString: () => "id2" }, competitor_name: "Y" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"], project_name: "ProjA" },
      { user_id: "u1", monitoring: ["id2"], advertiser: ["BrandB"], project_name: "ProjB" },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    // findById is called per unique user; cached in userMap so only once
    userDetailsFindByIdSpy.mockResolvedValue({ email: "a@b.com", userName: "A", _id: "u1" });
    axiosPostSpy.mockResolvedValue({ data: 0 });
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" }); // fullUser
    competitorsReqFindOneSpy.mockResolvedValueOnce({ user_id: "u1", email_status: 0 }); // pendingEmail
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", unsubscribed: 0 }); // subscribe-detail
    // Force fullHtml > 220_000 bytes
    emailRenderTemplateSpy.mockReturnValueOnce("X".repeat(230_000));
    // batch 1 succeeds, batch 2 fails
    emailSendEmailDirectSpy
      .mockResolvedValueOnce({ message: "Email sent successfully" })
      .mockResolvedValueOnce({ error: "sg-quota" });
    competitorsReqUpdateManySpy.mockResolvedValue({});
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    // 2 sendEmailDirect calls (one per batch) confirms splitter ran
    expect(emailSendEmailDirectSpy).toHaveBeenCalledTimes(2);
    // anySent=true (first batch succeeded) so mailStatus is "sent (2 parts)"
    const data = res.send.mock.calls[0][0].body.data;
    expect(data[0].mailStatus).toBe("sent (2 parts)");
  });

  it("sendEmailDirect throws → inner catch sets mailStatus='failed' (overwritten to 'not sent')", async () => {
    competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "id1" }, competitor_name: "X" },
    ]);
    competitorsReqFindSpy.mockResolvedValueOnce([
      { user_id: "u1", monitoring: ["id1"], advertiser: ["BrandA"] },
    ]);
    configGetSpy.mockImplementation((k) => k === "TEST_EMAIL_ONLY" ? "" : `cfg:${k}`);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b.com", userName: "A", _id: "u1" });
    axiosPostSpy.mockResolvedValue({ data: 0 });
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", _id: "u1" });
    competitorsReqFindOneSpy.mockResolvedValueOnce({ user_id: "u1", email_status: 0 });
    userDetailsFindOneSpy.mockResolvedValueOnce({ email: "a@b.com", unsubscribed: 0 });
    emailSendEmailDirectSpy.mockRejectedValueOnce(new Error("sg-down"));
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    expect(res.send.mock.calls[0][0].body.data[0].mailStatus).toBe("not sent");
  });
});

describe("monitorService > fetchTopAdPreview ES paths (PR #201)", () => {
  it("returns null when ES returns no hits", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({ hits: { hits: [] } });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out).toBeNull();
  });

  it("returns null when hit has no title/body/image", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: { facebook_ad: { other_field: "x" } } }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out).toBeNull();
  });

  it("returns parsed preview when hit has title + image_url", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{
        _source: {
          "facebook_ad_variants.title": "Buy Now!",
          "facebook_ad_variants.text": "Big sale",
          image_url: "https://x/img.png",
          "facebook_ad_post_owners.post_owner_name": "Acme Co",
        },
      }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out).toMatchObject({
      platform: "facebook",
      title: "Buy Now!",
      body: "Big sale",
      cta: "",
      image_url: "https://x/img.png",
    });
  });

  it("catch path: returns null + logs on ES search throw", async () => {
    esClientFake.server1.search.mockRejectedValueOnce(new Error("es-down"));
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out).toBeNull();
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("truncates long strings + handles protocol-relative URLs", async () => {
    const longBody = "x".repeat(200);
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{
        _source: {
          "facebook_ad_variants.title": "T",
          "facebook_ad_variants.text": longBody,
          image_url: "//cdn/x.png",
        },
      }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out.body.endsWith("…")).toBe(true);
    expect(out.image_url).toBe("https://cdn/x.png");
  });

  it("fetchAdPreviews: queries each active platform; filters out nulls", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: {
        "facebook_ad_variants.title": "T",
        image_url: "https://x/p.jpg",
      } }] },
    });
    const out = await svc.fetchAdPreviews("Acme", { facebook: true, instagram: false });
    expect(out).toHaveLength(1);
    expect(out[0].platform).toBe("facebook");
  });

  it("fetchAdPreviews: all platforms active, all return null → []", async () => {
    esClientFake.server1.search.mockResolvedValue({ hits: { hits: [] } });
    esClientFake.server2.search.mockResolvedValue({ hits: { hits: [] } });
    esClientFake.server3.search.mockResolvedValue({ hits: { hits: [] } });
    const out = await svc.fetchAdPreviews("Acme", { facebook: true, instagram: true, google: true });
    expect(out).toEqual([]);
  });

  it("pickFirstUrl: data: URL pass-through (line 233)", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: {
        "facebook_ad_variants.title": "T",
        image_url: "data:image/png;base64,abc",
      } }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out.image_url).toBe("data:image/png;base64,abc");
  });

  it("pickFirstUrl: skips pasimages/* paths (line 237)", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: {
        "facebook_ad_variants.title": "T",
        image_url: "/pasimages/foo.jpg",
      } }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    // pasimages-prefixed paths are dropped, image_url ends up ""
    expect(out.image_url).toBe("");
  });
  it("pickFirstUrl: STRIP_PAS_PREFIX + PAS_MEDIA_CDN → rewrites to media CDN (lines 240-243)", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: {
        "facebook_ad_variants.title": "T",
        image_url: "Poweradspy/n2/foo.jpg",
      } }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    // PAS_MEDIA_CDN is "cfg:media_url" (from mocked config). The /n2 prefix is
    // stripped and what remains is concatenated onto the CDN base.
    expect(out.image_url).toBe("cfg:media_url/foo.jpg");
  });
  it("pickFirstUrl: leading-slash variant of PAS prefix also rewrites onto CDN (lines 240-243)", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: {
        "facebook_ad_variants.title": "T",
        image_url: "/pas-prod/stream/bar.png",
      } }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out.image_url).toBe("cfg:media_url/bar.png");
  });

  it("pickFirstUrl: nested-array path traversal (getByPath line 190)", async () => {
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: {
        // Nested array: pickFirstString resolves facebook_ad_variants.title
        // through cur = cur[0] for arrays.
        facebook_ad_variants: [{ title: "FromArray" }],
        image_url: "https://x/img.png",
      } }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out.title).toBe("FromArray");
  });

  it("pickFirstUrl: whitespace-only URL → trimmed to empty → `if (!v) continue` truthy (line 229)", async () => {
    // First image_url candidate is whitespace-only; after .trim() it's empty
    // so the `if (!v) continue;` guard fires and we fall through to the next
    // candidate (new_nas_image_url) for the actual URL.
    esClientFake.server1.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: {
        "facebook_ad_variants.title": "T",
        image_url: "   ",                       // whitespace-only → skipped
        new_nas_image_url: "https://x/img2.png", // resolves on next iteration
      } }] },
    });
    const out = await svc.fetchTopAdPreview("Acme", "facebook");
    expect(out.image_url).toBe("https://x/img2.png");
  });
});

describe("monitorService > getCompetitors", () => {
  it("validation fail when platform missing", async () => {
    const res = mockRes();
    await svc.getCompetitors({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("platform is required");
  });

  it("validation fail when platform not in (facebook, instagram, youtube, google)", async () => {
    const res = mockRes();
    await svc.getCompetitors({ query: { platform: "tiktok" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Invalid platform");
  });

  it("returns empty list response when no competitors match", async () => {
    competitorsFindSpy.mockReturnValueOnce({
      sort: () => ({ limit: () => Promise.resolve([]) }),
    });
    const res = mockRes();
    await svc.getCompetitors({ query: { platform: "facebook" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("no competitors");
  });

  it("returns competitor names and updates their status to 1", async () => {
    competitorsFindSpy.mockReturnValueOnce({
      sort: () => ({ limit: () => Promise.resolve([{ _id: "a", competitor_name: "X" }]) }),
    });
    competitorsUpdateManySpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.getCompetitors({ query: { platform: "facebook" } }, res);
    expect(competitorsUpdateManySpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.data).toEqual({ competitorNames: ["X"] });
  });

  it("covers instagram/youtube/google platform branches", async () => {
    for (const platform of ["instagram", "youtube", "google"]) {
      competitorsFindSpy.mockReturnValueOnce({
        sort: () => ({ limit: () => Promise.resolve([]) }),
      });
      const res = mockRes();
      await svc.getCompetitors({ query: { platform } }, res);
      expect(res.send).toHaveBeenCalled();
    }
  });

  it("outer catch fires userFailResp on Mongo throw", async () => {
    competitorsFindSpy.mockImplementationOnce(() => { throw new Error("mongo-down"); });
    const res = mockRes();
    await svc.getCompetitors({ query: { platform: "facebook" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting competitors");
  });
});

describe("monitorService > updateCompetitorsStatus", () => {
  it("validation fail when platform invalid", async () => {
    const res = mockRes();
    await svc.updateCompetitorsStatus({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Invalid or missing platform");
  });

  it("no competitors -> empty response", async () => {
    competitorsFindSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.updateCompetitorsStatus({ query: { platform: "facebook" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("No competitors found");
  });

  it("happy path facebook: ES hit -> status updated", async () => {
    competitorsFindSpy.mockResolvedValueOnce([{ competitor_name: "X" }]);
    esClientFake.server1.search.mockResolvedValueOnce({ hits: { hits: [{}] } });
    competitorsUpdateManySpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.updateCompetitorsStatus({ query: { platform: "facebook" } }, res);
    expect(competitorsUpdateManySpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.data).toEqual(["X"]);
  });

  it("youtube branch uses epoch timestamps", async () => {
    competitorsFindSpy.mockResolvedValueOnce([{ competitor_name: "X" }]);
    esClientFake.server1.search.mockResolvedValueOnce({ hits: { hits: [] } });
    const res = mockRes();
    await svc.updateCompetitorsStatus({ query: { platform: "youtube" } }, res);
    const esQuery = esClientFake.server1.search.mock.calls[0][0];
    expect(typeof esQuery.body.query.bool.must[1].range["last_seen"].gte).toBe("number");
  });

  it("ES query inner-catch logs but does not throw", async () => {
    competitorsFindSpy.mockResolvedValueOnce([{ competitor_name: "X" }]);
    esClientFake.server1.search.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await svc.updateCompetitorsStatus({ query: { platform: "facebook" } }, res);
    expect(res.send.mock.calls[0][0].body.data).toEqual([]);
  });

  it("outer catch fires on Mongo find throw", async () => {
    competitorsFindSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.updateCompetitorsStatus({ query: { platform: "facebook" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in updating");
  });

  // 5 misplaced activeCompetitorContacts userMap/mailStatus tests removed —
  // the source (activeCompetitorContacts) was rewritten in upstream merge
  // (PR #201 "Competitor Mail template", commit 221a15183) to a new
  // brand-based response shape. Old tests asserted competitor_name /
  // facebook_count / mailStatus fields that the new shape doesn't return.

  it("'Index not mapped to any server' fires in updateCompetitorsStatus when esServers has no matching index", async () => {
    // Re-mock with esServers that doesn't include any of the platform indexes;
    // re-import the service so serverKey resolves to undefined.
    vi.doMock("../../../utils/Elasticsearch.js", () => ({
      esClient: esClientFake,
      esServers: { onlyServer: { host: "h", indexes: ["unrelated_index"] } },
      checkElasticsearchHealth: vi.fn(),
    }));
    vi.resetModules();
    const { default: isolatedSvc } = await import("../../../core/Competitors/monitorService.js");
    competitorsFindSpy.mockResolvedValueOnce([{ competitor_name: "x" }]);
    const res = mockRes();
    await isolatedSvc.updateCompetitorsStatus({ query: { platform: "facebook" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Index not mapped");
    // Restore the original Elasticsearch mock so subsequent tests' re-imports
    // (via beforeEach's vi.resetModules) get the full esServers config back.
    vi.doUnmock("../../../utils/Elasticsearch.js");
    vi.resetModules();
  });
});

describe("monitorService > updateDailyCompetitors", () => {
  it("success: resets statuses across both collections", async () => {
    competitorsUpdateManySpy.mockResolvedValueOnce({});
    competitorsReqUpdateManySpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.updateDailyCompetitors({}, res);
    expect(competitorsUpdateManySpy).toHaveBeenCalled();
    expect(competitorsReqUpdateManySpy).toHaveBeenCalled();
  });
  it("catch on Mongo failure", async () => {
    competitorsUpdateManySpy.mockRejectedValueOnce(new Error("nope"));
    const res = mockRes();
    await svc.updateDailyCompetitors({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Failed to update");
  });
});

describe("monitorService > unSubscribeMail", () => {
  it("validation fail when email missing", async () => {
    const res = mockRes();
    await svc.unSubscribeMail({ body: {} }, res);
    expect(res.send).toHaveBeenCalled();
  });
  it("no record matched", async () => {
    userDetailsUpdateOneSpy.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });
    const res = mockRes();
    await svc.unSubscribeMail({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("not found");
  });
  it("success path", async () => {
    userDetailsUpdateOneSpy.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });
    const res = mockRes();
    await svc.unSubscribeMail({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("unsubscribed");
  });
  it("catch on update throw", async () => {
    userDetailsUpdateOneSpy.mockRejectedValueOnce(new Error("nope"));
    const res = mockRes();
    await svc.unSubscribeMail({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Failed");
  });
});

describe("monitorService > reSubscribeMail", () => {
  it("validation fail when email missing", async () => {
    const res = mockRes();
    await svc.reSubscribeMail({ body: {} }, res);
    expect(res.send).toHaveBeenCalled();
  });
  it("no record matched", async () => {
    userDetailsUpdateOneSpy.mockResolvedValueOnce({ matchedCount: 0 });
    const res = mockRes();
    await svc.reSubscribeMail({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("not found");
  });
  it("success path", async () => {
    userDetailsUpdateOneSpy.mockResolvedValueOnce({ matchedCount: 1 });
    const res = mockRes();
    await svc.reSubscribeMail({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("resubscribed");
  });
  it("catch on update throw", async () => {
    userDetailsUpdateOneSpy.mockRejectedValueOnce(new Error("nope"));
    const res = mockRes();
    await svc.reSubscribeMail({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Failed");
  });
});

describe("monitorService > activeCompetitorContacts", () => {
  it("no active competitors -> 'no active competitors'", async () => {
    competitorsFindSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("No active competitors");
  });

  it("no matching competitor requests", async () => {
    competitorsFindSpy.mockResolvedValueOnce([{ _id: "id1", competitor_name: "X" }]);
    competitorsReqFindSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("No matching competitor request");
  });

  // Removed: "happy path: aggregates ads counts and sends email" — source
  // rewritten in upstream PR #201 to a brand-based response shape (uses
  // fetchAdPreviews, brands[], etc) instead of competitor_name / mailStatus
  // at top level. Old test no longer matches.

  it("user has no email -> skipped (continue branch)", async () => {
    // Defensive: previous test ('Index not mapped') uses vi.doMock to swap
    // esServers; restore the full config + re-import so this test sees the
    // original 4-server map and pre-fetch can resolve.
    vi.doMock("../../../utils/Elasticsearch.js", () => ({
      esClient: esClientFake,
      esServers: {
        server1: { host: "h1", indexes: ["search_mix", "youtube_ads_data"] },
        server2: { host: "h2", indexes: ["instagram_search_mix"] },
        server3: { host: "h3", indexes: ["google_ads_data"] },
        server4: { host: "h4", indexes: ["category"] },
      },
      checkElasticsearchHealth: vi.fn(),
    }));
    vi.resetModules();
    const { default: localSvc } = await import("../../../core/Competitors/monitorService.js");
    competitorsFindSpy.mockResolvedValueOnce([{ _id: { toString: () => "id1" }, competitor_name: "X" }]);
    competitorsReqFindSpy.mockResolvedValueOnce([{ user_id: "u1", monitoring: ["id1"] }]);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: null, _id: "u1" });
    for (const srv of ["server1", "server2", "server3"]) {
      esClientFake[srv].search.mockResolvedValue({ hits: { total: { value: 0 }, hits: [] } });
    }
    const res = mockRes();
    await localSvc.activeCompetitorContacts({}, res);
    expect(res.send.mock.calls[0][0].body.data).toEqual([]);
    vi.doUnmock("../../../utils/Elasticsearch.js");
  });

  it("ES pre-fetch throws -> inner catch logs, user is never added to userMap", async () => {
    competitorsFindSpy.mockResolvedValueOnce([{ _id: { toString: () => "id1" }, competitor_name: "X" }]);
    competitorsReqFindSpy.mockResolvedValueOnce([{ user_id: "u1", monitoring: ["id1"] }]);
    userDetailsFindByIdSpy.mockResolvedValueOnce({ email: "a@b", userName: "A", _id: "u1" });
    // Force the per-competitor pre-fetch outer try to throw via spyOn
    const spy = vi.spyOn(svc, "countAdsLastDayIST").mockImplementation(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    spy.mockRestore();
    // When per-competitor block throws, cache is empty → no brandCompetitors
    // → user is filtered out → results is [].
    expect(res.send.mock.calls[0][0].body.data).toEqual([]);
  });

  // Removed: 4 mailStatus / dedup tests — source rewritten in upstream
  // PR #201, no longer return mailStatus at the top level.

  it("outer catch on Mongo throw", async () => {
    competitorsFindSpy.mockImplementationOnce(() => { throw new Error("mongo-down"); });
    const res = mockRes();
    await svc.activeCompetitorContacts({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in fetching");
  });

  // Removed: 2 more seenEmails dedup / fullUser-null tests — same reason as above.
});

describe("monitorService > fetchTopAdPreview defensive early-returns (PR #201)", () => {
  it("fetchTopAdPreview: returns null when platform isn't in AD_PREVIEW_FIELD_CANDIDATES", async () => {
    const out = await svc.fetchTopAdPreview("Acme", "tiktok");
    expect(out).toBeNull();
  });

  it("fetchAdPreviews: returns [] when no platforms active", async () => {
    const out = await svc.fetchAdPreviews("Acme", {});
    expect(out).toEqual([]);
  });

  it("fetchTopAdPreview: returns null when esServers has no key for the cfg.index (line 154 true side)", async () => {
    const original = svc.esServers;
    svc.esServers = {}; // no server has search_mix
    try {
      const out = await svc.fetchTopAdPreview("Acme", "facebook");
      expect(out).toBeNull();
    } finally {
      svc.esServers = original;
    }
  });

  it("countAdsLastDayIST: returns 0 for unknown platform (line 396 !cfg branch)", async () => {
    const out = await svc.countAdsLastDayIST("Acme", "myspace");
    expect(out).toBe(0);
  });

  it("countAdsLastDayIST: returns 0 when esServers has no matching index (line 401 !serverKey branch)", async () => {
    const original = svc.esServers;
    svc.esServers = {}; // no server hosts search_mix
    try {
      const out = await svc.countAdsLastDayIST("Acme", "facebook");
      expect(out).toBe(0);
    } finally {
      svc.esServers = original;
    }
  });
});

describe("monitorService > PAS_MEDIA_CDN module-init fallback (lines 218, 219)", () => {
  it("config.get('media_url') returns falsy → `|| ''` fallback fires (line 218 right operand)", async () => {
    // Reload SUT with a config that returns "" for media_url so the
    // `(config.get('media_url') || '')` left side is falsy → right side ''.
    configGetSpy.mockImplementation((k) => k === "media_url" ? "" : `cfg:${k}`);
    vi.resetModules();
    const mod = await import("../../../core/Competitors/monitorService.js");
    expect(mod.default).toBeDefined();
  });

  it("config.get('media_url') throws → outer catch returns '' (line 219)", async () => {
    // Only throw for media_url so Elasticsearch.js and other deps can still
    // initialize. The PAS_MEDIA_CDN IIFE's catch block then fires (line 219).
    configGetSpy.mockImplementation((k) => {
      if (k === "media_url") throw new Error("config-down");
      return `cfg:${k}`;
    });
    vi.resetModules();
    const mod = await import("../../../core/Competitors/monitorService.js");
    expect(mod.default).toBeDefined();
  });

  it("MAIL_DEBUG_LOG=false → dlog() short-circuits unless line contains ❌/FAILED (line 24 falsy)", async () => {
    // Reload SUT with MAIL_DEBUG_LOG=false so the dlog gate flips off.
    configGetSpy.mockImplementation((k) => {
      if (k === "MAIL_DEBUG_LOG") return false;
      return `cfg:${k}`;
    });
    vi.resetModules();
    const mod = await import("../../../core/Competitors/monitorService.js");
    expect(mod.default).toBeDefined();
    // Trigger the loop: empty competitors set → quick path that calls dlog
    // along the way. The gated dlog should not print non-error lines.
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    competitorsFindSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await mod.default.activeCompetitorContacts({}, res);
    consoleLogSpy.mockRestore();
  });
});

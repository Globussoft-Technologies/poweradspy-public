import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import { Readable } from "node:stream";
const require = createRequire(import.meta.url);
const express = require("express");

const C = require("../../../src/compliance/claims/claims");
const { createClaimsRouter } = require("../../../src/services/copyrightClaimsRoutes");
const { createRouter } = require("../../../src/services/copyrightRequest");

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const silent = { info() {}, warn() {}, error() {} };
const SETTINGS = { enabled: true, homeNetwork: "facebook", statusSecret: "status-secret", requireEvidenceReviewed: true };
const claim = (over = {}) => ({
  name: "Example Advertiser", reason: "Copyright complaint about the images", complaintId: ID,
  complainantName: "Jane Doe", complainantEmail: "jane@example.com", complainantOrg: "Example Company", ...over,
});

// ── an in-memory copyright_claims with the same rules as the repository's SQL (unique keys, one conditional decision) ──
function fakeRepo() {
  const rows = new Map();
  let nextId = 1;
  return {
    rows,
    async insert(_sql, c) {
      if (rows.has(c.complaintId)) return;
      if ([...rows.values()].some((r) => r.claim_reference === c.reference)) return; // the reference is taken: nothing is added
      rows.set(c.complaintId, {
        id: nextId++, complaint_id: c.complaintId, claim_reference: c.reference, name: c.name, reason: c.reason,
        complainant_name: c.complainantName, complainant_email: c.complainantEmail, complainant_org: c.complainantOrg,
        evidence_url: c.evidenceUrl || null, source_reference: c.sourceReference || null, fingerprint: c.fingerprint, status: "pending",
        received_at: "2026-11-03 10:00:00", decided_by: null, decided_at: null, decision_reason: null, evidence_reviewed: 0,
        processing_status: "none", processing_result: null, processed_at: null,
      });
    },
    async getByComplaintId(_s, id) { const r = rows.get(id); return r ? { ...r } : null; },
    async list(_s, { status, beforeId, limit = 25 } = {}) {
      return [...rows.values()].filter((r) => (!status || r.status === status) && (!beforeId || r.id < Number(beforeId))).sort((a, b) => b.id - a.id).slice(0, limit).map((r) => ({ ...r }));
    },
    async summary() {
      const pending = [...rows.values()].filter((r) => r.status === "pending");
      return { pending: pending.length, oldestPendingAt: pending[0]?.received_at || null, failingProcessing: [...rows.values()].filter((r) => r.status === "accepted" && ["partial", "failed"].includes(r.processing_status)).length };
    },
    async decide(_s, { complaintId, status, by, reason, evidenceReviewed }) {
      const r = rows.get(complaintId);
      if (!r || r.status !== "pending") return false; // the conditional update: only a pending claim changes
      Object.assign(r, { status, decided_by: by, decided_at: "2026-11-03 11:00:00", decision_reason: reason || null, evidence_reviewed: evidenceReviewed ? 1 : 0 });
      return true;
    },
    async saveProcessing(_s, { complaintId, status, result }) {
      const r = rows.get(complaintId);
      if (!r || r.status !== "accepted") return false;
      Object.assign(r, { processing_status: status, processing_result: JSON.stringify(result), processed_at: "2026-11-03 11:00:01" });
      return true;
    },
  };
}

const okIntake = (over = {}) => ({
  ok: true, complaintId: ID, name: "Example Advertiser", totalAds: 120,
  blocked: [{ network: "facebook", blocklistId: 7 }, { network: "reddit", blocklistId: 8 }], failed: [], rejected: [],
  matches: [{ network: "facebook", ownerId: 3, name: "Example Advertiser", ads: 120 }],
  hashing: [{ network: "facebook", queued: true }], ...over,
});

function build({ settings = {}, repo = fakeRepo(), submitAdvertiser = vi.fn(async () => okIntake()), attachments, precheckDeps, sql = { fake: true }, random } = {}) {
  const service = C.createClaimsService({
    settings: { ...SETTINGS, ...settings }, getSql: () => sql, repo, submitAdvertiser, attachments, precheckDeps, log: silent, random,
    normalizeName: (s) => String(s).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
  });
  return { service, repo, submitAdvertiser };
}

describe("claims > helpers", () => {
  it("cleans text to one line and checks the link", () => {
    expect(C.oneLine("  a\u0000b\n c  ", 10)).toBe("a b c");
    expect(C.oneLine("x".repeat(400), 255)).toHaveLength(255);
    expect(C.oneLine(5, 10)).toBe("");
    expect(C.evidenceUrlOf("https://example.org/proof")).toBe("https://example.org/proof");
    expect(C.evidenceUrlOf(undefined)).toBe("");
    expect(C.evidenceUrlOf("")).toBe("");
    for (const bad of ["http://example.org", "javascript:alert(1)", "example.org", "https://", "https://exa mple.org", `https://example.org/${"a".repeat(1100)}`, 5, {}]) {
      expect(C.evidenceUrlOf(bad)).toBeNull();
    }
  });

  it("makes a readable reference: CR- and six characters without 0 O 1 I L", () => {
    for (let i = 0; i < 50; i += 1) expect(C.newReference()).toMatch(/^CR-[A-HJKMNP-Z2-9]{6}$/);
    expect(C.newReference(() => Buffer.from([0, 1, 2, 3, 4, 5]))).toBe("CR-ABCDEF");
  });

  it("the fingerprint ignores formatting but not content", () => {
    const n = (s) => String(s).trim().replace(/\s+/g, " ").toLowerCase();
    const base = { name: "Example Advertiser", reason: "r", complainantName: "Jane", complainantEmail: "Jane@Example.com", complainantOrg: "Org", evidenceUrl: "", sourceReference: "" };
    const f = C.fingerprintOf(base, n);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(C.fingerprintOf({ ...base, name: "  example   ADVERTISER ", complainantEmail: "jane@example.com" }, n)).toBe(f);
    for (const changed of [{ name: "Other" }, { reason: "r2" }, { complainantName: "Joe" }, { complainantOrg: "Org2" }, { evidenceUrl: "https://x.org" }, { sourceReference: "WP-1" }]) {
      expect(C.fingerprintOf({ ...base, ...changed }, n)).not.toBe(f);
    }
  });

  it("derives the status key from the complaint id and a secret: the same every time, different for another secret or claim", () => {
    const k = C.statusKeyOf("secret", ID);
    expect(k).toMatch(/^[0-9a-f]{40}$/);
    expect(C.statusKeyOf("secret", ID.toUpperCase())).toBe(k);
    expect(C.statusKeyOf("other", ID)).not.toBe(k);
    expect(C.statusKeyOf("secret", ID2)).not.toBe(k);
  });

  it("sums up what processing did: ok, partial or failed, with each network's own result", () => {
    expect(C.processingOf(okIntake()).status).toBe("ok");
    const ok = C.processingOf(okIntake()).result.networks;
    expect(ok.find((n) => n.network === "facebook")).toMatchObject({ blocklist: "ok", hashing: "queued", ads: 120 });
    expect(ok.find((n) => n.network === "reddit")).toMatchObject({ blocklist: "ok", hashing: "not_supported" });

    const failedNetwork = C.processingOf(okIntake({ failed: [{ network: "quora", error: "Table 'copyright_blocklist' doesn't exist" }] }));
    expect(failedNetwork.status).toBe("partial");
    expect(failedNetwork.result.networks.find((n) => n.network === "quora")).toMatchObject({ blocklist: "failed", error: expect.stringMatching(/doesn't exist/) });

    expect(C.processingOf(okIntake({ hashing: [{ network: "facebook", queued: false }] })).status).toBe("partial"); // blocked, but no hash job was queued
    expect(C.processingOf(okIntake({ blocked: [], failed: [{ network: "facebook", error: "x" }] })).status).toBe("failed");
    expect(C.processingOf({ ok: false, error: "failed", message: "boom" })).toMatchObject({ status: "failed", result: { ok: false } });
    expect(C.processingOf(undefined).status).toBe("failed");
  });
});

describe("claims > submitting a claim", () => {
  it("stores it as pending and answers with the reference and a status key", async () => {
    const { service, repo } = build();
    const out = await service.submit(claim({ evidenceUrl: "https://example.org/proof", sourceReference: "WP-TICKET-1" }));
    expect(out).toMatchObject({ ok: true, repeated: false, complaintId: ID, status: "pending" });
    expect(out.claimReference).toMatch(/^CR-[A-Z0-9]{6}$/);
    expect(out.statusKey).toBe(C.statusKeyOf("status-secret", ID));
    expect(repo.rows.get(ID)).toMatchObject({ name: "Example Advertiser", complainant_org: "Example Company", evidence_url: "https://example.org/proof", source_reference: "WP-TICKET-1", status: "pending", processing_status: "none" });
  });

  it("makes a complaint id when none is given, and keeps the one that is (in lower case)", async () => {
    const { service } = build();
    const made = await service.submit(claim({ complaintId: undefined }));
    expect(made.complaintId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await service.submit(claim({ complaintId: ID.toUpperCase() }))).complaintId).toBe(ID);
  });

  it("requires the advertiser, who is complaining (name, email, organization) and a reason; checks the link and the id", async () => {
    const { service, repo } = build();
    const cases = [
      [{ name: "a" }, "invalid_name"], [{ name: undefined }, "invalid_name"],
      [{ complainantName: " " }, "invalid_complainant_name"],
      [{ complainantEmail: "not-an-email" }, "invalid_complainant_email"], [{ complainantEmail: undefined }, "invalid_complainant_email"],
      [{ complainantOrg: "" }, "invalid_complainant_org"],
      [{ reason: "" }, "invalid_reason"],
      [{ evidenceUrl: "http://example.org" }, "invalid_evidence_url"],
      [{ complaintId: "not-a-uuid" }, "invalid_complaint_id"],
    ];
    for (const [over, error] of cases) expect(await service.submit(claim(over))).toMatchObject({ ok: false, error });
    expect(repo.rows.size).toBe(0);
  });

  it("answers no_database when the claims database is not connected", async () => {
    const { service } = build({ sql: null });
    expect(await service.submit(claim())).toMatchObject({ ok: false, error: "no_database" });
  });

  it("a retry (same id, same content, even formatted differently) is the same claim: nothing is added", async () => {
    const { service, repo } = build();
    const first = await service.submit(claim());
    const again = await service.submit(claim({ name: "  example   ADVERTISER ", complainantEmail: "JANE@example.com" }));
    expect(again).toMatchObject({ ok: true, repeated: true, claimReference: first.claimReference, statusKey: first.statusKey });
    expect(repo.rows.size).toBe(1);
  });

  it("the same id with different content is refused, and nothing changes", async () => {
    const { service, repo } = build();
    await service.submit(claim());
    for (const over of [{ name: "Another Advertiser" }, { reason: "something else" }, { complainantOrg: "Another Org" }, { evidenceUrl: "https://example.org/other" }]) {
      expect(await service.submit(claim(over))).toMatchObject({ ok: false, error: "conflict" });
    }
    expect(repo.rows.get(ID).name).toBe("Example Advertiser");
  });

  it("when a reference is already taken by another claim, it tries another one", async () => {
    const seq = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6]].map((a) => Buffer.from(a));
    const { service, repo } = build({ random: () => seq.shift() });
    const first = await service.submit(claim());
    const second = await service.submit(claim({ complaintId: ID2, name: "Second Advertiser" }));
    expect(first.claimReference).toBe("CR-AAAAAA");
    expect(second.claimReference).toBe("CR-BCDEFG");
    expect(repo.rows.size).toBe(2);
  });

  it("two simultaneous submits of the same claim end as one claim", async () => {
    const { service, repo } = build();
    const [a, b] = await Promise.all([service.submit(claim()), service.submit(claim())]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.claimReference).toBe(b.claimReference);
    expect(repo.rows.size).toBe(1);
  });
});

describe("claims > reading", () => {
  async function withClaim(over) {
    const t = build(over);
    const out = await t.service.submit(claim());
    return { ...t, key: out.statusKey };
  }

  it("gives a claimant the coarse status only when the status key is right", async () => {
    const { service, key } = await withClaim();
    expect(await service.getStatus({ complaintId: ID, key })).toEqual({ ok: true, status: "pending", decidedAt: null });
    for (const wrong of ["", "x".repeat(40), key.slice(1), undefined]) expect(await service.getStatus({ complaintId: ID, key: wrong })).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.getStatus({ complaintId: "nope", key })).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.getStatus({ complaintId: ID2, key: C.statusKeyOf("status-secret", ID2) })).toMatchObject({ ok: false, error: "not_found" }); // a right key for a claim that does not exist
  });

  it("lists claims for reviewers without contact details, newest first, with a cursor", async () => {
    const { service } = await withClaim();
    await service.submit(claim({ complaintId: ID2, name: "Second Advertiser" }));
    const page = await service.list({ status: "pending", limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ complaintId: ID2, name: "Second Advertiser", status: "pending", organization: "Example Company" });
    expect(JSON.stringify(page)).not.toMatch(/jane@example\.com|fingerprint|statusKey/);
    const next = await service.list({ status: "pending", limit: 1, beforeId: page.next });
    expect(next.items[0].complaintId).toBe(ID);
    expect((await service.list({ status: "weird" })).error).toBe("invalid_status");
  });

  it("gives a reviewer the whole claim and its files, but never the fingerprint, the status key or the database id", async () => {
    const attachments = { listFiles: vi.fn(async () => [{ fileId: "f1", name: "proof.pdf", kind: "document", scanStatus: "clean" }]) };
    const { service } = await withClaim({ attachments });
    const out = await service.get(ID);
    expect(out.claim).toMatchObject({ complaintId: ID, complainant: { name: "Jane Doe", email: "jane@example.com", organization: "Example Company" }, status: "pending", decision: null });
    expect(out.files).toEqual([{ fileId: "f1", name: "proof.pdf", kind: "document", scanStatus: "clean" }]);
    expect(JSON.stringify(out)).not.toMatch(/fingerprint|statusKey|"id":/);
    expect((await service.get("not-a-uuid")).error).toBe("not_found");
    expect((await service.get(ID2)).error).toBe("not_found");
  });

  it("a files service that fails does not hide the claim: it says the files could not be listed", async () => {
    const attachments = { listFiles: async () => { throw new Error("db"); } };
    const { service } = await withClaim({ attachments });
    expect(await service.get(ID)).toMatchObject({ ok: true, files: [], filesError: "unable to list the files" });
  });

  it("counts what waits for review and what is failing after acceptance (for the badge)", async () => {
    const { service } = await withClaim({ submitAdvertiser: vi.fn(async () => okIntake({ failed: [{ network: "quora", error: "x" }] })) });
    await service.submit(claim({ complaintId: ID2, name: "Second" }));
    await service.accept({ complaintId: ID, reviewedBy: "Asha", evidenceReviewed: true });
    expect(await service.summary()).toMatchObject({ ok: true, pending: 1, failingProcessing: 1 });
  });
});

describe("claims > the decision", () => {
  async function pending(over) {
    const t = build(over);
    await t.service.submit(claim());
    return t;
  }

  it("accept records the decision, then blocks and queues the hashing with the reviewer's name and the claim's complaint id", async () => {
    const { service, repo, submitAdvertiser } = await pending();
    const out = await service.accept({ complaintId: ID, reviewedBy: "Asha Rao", evidenceReviewed: true, note: "documents fine" });
    expect(out).toMatchObject({ ok: true, status: "accepted", processingStatus: "ok" });
    expect(submitAdvertiser).toHaveBeenCalledTimes(1);
    expect(submitAdvertiser.mock.calls[0][0]).toMatchObject({ name: "Example Advertiser", addedBy: "Asha Rao", complaintId: ID, network: "all" });
    expect(submitAdvertiser.mock.calls[0][0].reason).toMatch(/^copyright claim CR-[A-Z0-9]{6}: Copyright complaint/);
    const row = repo.rows.get(ID);
    expect(row).toMatchObject({ status: "accepted", decided_by: "Asha Rao", decision_reason: "documents fine", evidence_reviewed: 1, processing_status: "ok" });
    expect(JSON.parse(row.processing_result).networks.map((n) => n.network).sort()).toEqual(["facebook", "reddit"]);
  });

  it("needs a reviewer's name and the confirmation that the documents were reviewed (unless the setting is off)", async () => {
    const { service, submitAdvertiser } = await pending();
    expect((await service.accept({ complaintId: ID, reviewedBy: "", evidenceReviewed: true })).error).toBe("reviewer_required");
    expect((await service.accept({ complaintId: ID, reviewedBy: "A", evidenceReviewed: true })).error).toBe("reviewer_required");
    expect((await service.accept({ complaintId: ID, reviewedBy: "Asha", evidenceReviewed: false })).error).toBe("evidence_not_reviewed");
    expect((await service.accept({ complaintId: ID, reviewedBy: "Asha" })).error).toBe("evidence_not_reviewed");
    expect((await service.accept({ complaintId: ID2, reviewedBy: "Asha", evidenceReviewed: true })).error).toBe("not_found");
    expect(submitAdvertiser).not.toHaveBeenCalled();
    const lenient = await pending({ settings: { requireEvidenceReviewed: false } });
    expect((await lenient.service.accept({ complaintId: ID, reviewedBy: "Asha" })).ok).toBe(true);
  });

  it("accepting again changes nothing and does not start the work twice; a rejected claim cannot be accepted", async () => {
    const { service, submitAdvertiser } = await pending();
    await service.accept({ complaintId: ID, reviewedBy: "Asha", evidenceReviewed: true });
    expect(await service.accept({ complaintId: ID, reviewedBy: "Bob", evidenceReviewed: true })).toMatchObject({ ok: true, already: true, status: "accepted" });
    expect(submitAdvertiser).toHaveBeenCalledTimes(1);
    expect((await service.reject({ complaintId: ID, reviewedBy: "Bob", reason: "changed my mind" })).error).toBe("already_decided");

    const other = await pending();
    await other.service.reject({ complaintId: ID, reviewedBy: "Asha", reason: "no proof" });
    expect((await other.service.accept({ complaintId: ID, reviewedBy: "Bob", evidenceReviewed: true })).error).toBe("already_decided");
    expect(other.submitAdvertiser).not.toHaveBeenCalled();
  });

  it("two reviewers accepting at the same moment: one starts the work, the other just sees it accepted", async () => {
    const { service, submitAdvertiser, repo } = await pending();
    const [a, b] = await Promise.all([
      service.accept({ complaintId: ID, reviewedBy: "Asha", evidenceReviewed: true }),
      service.accept({ complaintId: ID, reviewedBy: "Bob", evidenceReviewed: true }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect([a.already, b.already].filter(Boolean)).toHaveLength(1);
    expect(submitAdvertiser).toHaveBeenCalledTimes(1);
    expect(["Asha", "Bob"]).toContain(repo.rows.get(ID).decided_by);
  });

  it("an accept and a reject at the same moment: exactly one decision stands", async () => {
    const { service, repo } = await pending();
    const [a, r] = await Promise.all([
      service.accept({ complaintId: ID, reviewedBy: "Asha", evidenceReviewed: true }),
      service.reject({ complaintId: ID, reviewedBy: "Bob", reason: "no proof" }),
    ]);
    expect([a.ok, r.ok].filter(Boolean)).toHaveLength(1);
    expect(["accepted", "rejected"]).toContain(repo.rows.get(ID).status);
  });

  it("reject needs a reason, blocks nothing, and rejecting again is harmless", async () => {
    const { service, submitAdvertiser, repo } = await pending();
    expect((await service.reject({ complaintId: ID, reviewedBy: "Asha", reason: " " })).error).toBe("reason_required");
    expect((await service.reject({ complaintId: ID, reviewedBy: "", reason: "x" })).error).toBe("reviewer_required");
    expect(await service.reject({ complaintId: ID, reviewedBy: "Asha", reason: "no proof of ownership" })).toMatchObject({ ok: true, status: "rejected" });
    expect(await service.reject({ complaintId: ID, reviewedBy: "Asha", reason: "no proof of ownership" })).toMatchObject({ ok: true, already: true });
    expect(repo.rows.get(ID)).toMatchObject({ status: "rejected", decided_by: "Asha", decision_reason: "no proof of ownership" });
    expect(submitAdvertiser).not.toHaveBeenCalled();
  });

  it("keeps approval and processing apart: a failed or partial processing never undoes the decision, and shows what failed", async () => {
    const partial = await pending({ submitAdvertiser: vi.fn(async () => okIntake({ failed: [{ network: "quora", error: "no table" }] })) });
    expect(await partial.service.accept({ complaintId: ID, reviewedBy: "Asha", evidenceReviewed: true })).toMatchObject({ ok: true, status: "accepted", processingStatus: "partial" });
    expect(partial.repo.rows.get(ID)).toMatchObject({ status: "accepted", processing_status: "partial" });

    const broken = await pending({ submitAdvertiser: vi.fn(async () => { throw new Error("database is down"); }) });
    expect(await broken.service.accept({ complaintId: ID, reviewedBy: "Asha", evidenceReviewed: true })).toMatchObject({ ok: true, status: "accepted", processingStatus: "failed" });
    expect(broken.repo.rows.get(ID)).toMatchObject({ status: "accepted", processing_status: "failed" });
    expect(JSON.parse(broken.repo.rows.get(ID).processing_result)).toMatchObject({ ok: false, message: "database is down" });
  });

  it("retry runs the processing of an accepted claim again and updates the result; nothing else can be retried", async () => {
    const answers = [okIntake({ failed: [{ network: "quora", error: "no table" }] }), okIntake()];
    const { service, repo, submitAdvertiser } = await pending({ submitAdvertiser: vi.fn(async () => answers.shift()) });
    expect((await service.retryProcessing({ complaintId: ID, reviewedBy: "Asha" })).error).toBe("not_accepted"); // still pending
    await service.accept({ complaintId: ID, reviewedBy: "Asha", evidenceReviewed: true });
    expect(repo.rows.get(ID).processing_status).toBe("partial");
    expect(await service.retryProcessing({ complaintId: ID, reviewedBy: "Bob" })).toMatchObject({ ok: true, processingStatus: "ok" });
    expect(repo.rows.get(ID).processing_status).toBe("ok");
    expect(submitAdvertiser).toHaveBeenCalledTimes(2);
    expect(submitAdvertiser.mock.calls[1][0]).toMatchObject({ addedBy: "Bob", complaintId: ID });
    expect((await service.retryProcessing({ complaintId: ID, reviewedBy: "" })).error).toBe("reviewer_required");
  });
});

describe("claims > the search before a decision", () => {
  const deps = (over = {}) => ({
    networks: () => ["facebook", "reddit", "quora", "google"],
    supports: (n) => ["facebook", "reddit", "quora"].includes(n),
    sqlOf: (n) => (n === "quora" ? null : { fake: n }),
    findOwners: async (sql, network) => {
      if (network === "reddit") throw new Error("connect ETIMEDOUT 10.0.0.1:3306 while reading");
      return network === "facebook" ? [{ id: 1, ads_count: 90 }, { id: 2, ads_count: 30 }] : [];
    },
    ...over,
  });

  it("says found, not found, unable to check or not supported: a failed search is never 'no ads found'", async () => {
    const t = build({ precheckDeps: deps() });
    await t.service.submit(claim());
    const out = await t.service.precheck(ID);
    expect(out.networks).toEqual([
      { network: "facebook", check: "found", owners: 2, ads: 120 },
      { network: "reddit", check: "unable_to_check", reason: expect.stringMatching(/ETIMEDOUT/) },
      { network: "quora", check: "unable_to_check", reason: "no database connection" },
      { network: "google", check: "not_supported" },
    ]);
    expect(out.networks.filter((n) => n.check === "not_found")).toHaveLength(0);
    const none = build({ precheckDeps: deps({ findOwners: async () => [] }) });
    await none.service.submit(claim());
    expect((await none.service.precheck(ID)).networks.find((n) => n.network === "facebook")).toEqual({ network: "facebook", check: "not_found" });
  });

  it("answers not_found for an unknown claim", async () => {
    const t = build({ precheckDeps: deps() });
    expect((await t.service.precheck(ID2)).error).toBe("not_found");
  });
});

// ═════════════ the routes ═════════════
describe("claims > routes", () => {
  const SITE = "site-token";
  const ADMIN = "admin-token";

  function fakeService(over = {}) {
    return {
      submit: vi.fn(async () => ({ ok: true, complaintId: ID, claimReference: "CR-ABC234", status: "pending", statusKey: "k".repeat(40) })),
      getStatus: vi.fn(async () => ({ ok: true, status: "pending", decidedAt: null })),
      claimForUpload: vi.fn(async () => ({ ok: true, complaintId: ID, sql: { fake: true } })),
      list: vi.fn(async () => ({ ok: true, items: [{ id: 2 }], next: 2 })),
      summary: vi.fn(async () => ({ ok: true, pending: 3, oldestPendingAt: "2026-11-03 09:00:00", failingProcessing: 1 })),
      get: vi.fn(async () => ({ ok: true, claim: { complaintId: ID }, files: [], filesError: null })),
      precheck: vi.fn(async () => ({ ok: true, networks: [{ network: "facebook", check: "found", ads: 5 }] })),
      accept: vi.fn(async () => ({ ok: true, status: "accepted", processingStatus: "ok", processing: { ok: true } })),
      reject: vi.fn(async () => ({ ok: true, status: "rejected" })),
      retryProcessing: vi.fn(async () => ({ ok: true, processingStatus: "ok", processing: { ok: true } })),
      openFile: vi.fn(async () => ({ ok: true, stream: Readable.from([Buffer.from("%PDF-1.4 data")]), headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="p.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } })),
      ...over,
    };
  }
  function fakeFiles(over = {}) {
    return {
      addFiles: vi.fn(async ({ files }) => ({ ok: true, results: files.map((f) => ({ ok: true, name: f.originalName, fileId: "f1" })) })),
      ...over,
    };
  }

  async function serve({ service = fakeService(), files = fakeFiles(), settings = {}, requestSettings = {} } = {}) {
    const claimsRouter = createClaimsRouter({
      settings: { adminToken: ADMIN, statusSecret: "s", homeNetwork: "facebook", attachments: { enabled: true, maxFiles: 3, maxFileBytes: 1024 }, ...settings },
      requestSettings: { token: SITE, rateLimit: { windowMs: 60000, max: 500 }, ...requestSettings },
      claims: service, attachments: files,
    });
    const app = express();
    app.use(express.json());
    app.use("/c", claimsRouter);
    const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/c`;
    const site = { "x-copyright-token": SITE };
    const admin = { "x-copyright-admin-token": ADMIN };
    const call = (method, path, body, headers = {}) => fetch(base + path, { method, headers: { ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)) });
    return { call, site, admin, service, files, close: () => new Promise((r) => server.close(r)) };
  }
  const using = (opts, fn) => async () => { const t = await serve(opts); try { await fn(t); } finally { await t.close(); } };
  const formWith = (...parts) => { const f = new FormData(); for (const [name, bytes] of parts) f.append("files", new Blob([bytes]), name); return f; };

  it("POST /claims stores a claim and gives the reference and the status key; refuses bad tokens", using({}, async (t) => {
    const res = await t.call("POST", "/claims", { name: "X" }, t.site);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ complaintId: ID, claimReference: "CR-ABC234", status: "pending", statusKey: "k".repeat(40) });
    expect((await t.call("POST", "/claims", { name: "X" }, {})).status).toBe(401);
    expect((await t.call("POST", "/claims", { name: "X" }, { "x-copyright-token": "wrong" })).status).toBe(401);
    expect(t.service.submit).toHaveBeenCalledTimes(1);
  }));

  it("maps the service's answers: 400 for bad input, 409 for the same id with other content, 503 for a failure (without internal detail)", async () => {
    for (const [error, code] of [["invalid_name", 400], ["invalid_complainant_org", 400], ["conflict", 409], ["failed", 503], ["no_database", 503]]) {
      const t = await serve({ service: fakeService({ submit: vi.fn(async () => ({ ok: false, error, message: `m ${error}` })) }) });
      try {
        const res = await t.call("POST", "/claims", { name: "X" }, t.site);
        expect(res.status).toBe(code);
        const json = await res.json();
        if (code === 503) expect(json.message).not.toMatch(/m failed|m no_database/);
      } finally { await t.close(); }
    }
  });

  it("does not take claims when the status secret is not set", using({ settings: { statusSecret: "" } }, async (t) => {
    expect((await t.call("POST", "/claims", { name: "X" }, t.site)).status).toBe(503);
    expect(t.service.submit).not.toHaveBeenCalled();
  }));

  it("GET /claims/:id gives the coarse status with the key (in a header or the query), and nothing else", using({}, async (t) => {
    const res = await t.call("GET", `/claims/${ID}`, undefined, { ...t.site, "x-claim-key": "abc" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: "pending", decidedAt: null });
    expect(t.service.getStatus).toHaveBeenLastCalledWith({ complaintId: ID, key: "abc" });
    await t.call("GET", `/claims/${ID}?key=fromquery`, undefined, t.site);
    expect(t.service.getStatus).toHaveBeenLastCalledWith({ complaintId: ID, key: "fromquery" });
  }));

  it("GET /claims/:id answers 404 for a wrong key, like for an unknown claim", async () => {
    const t = await serve({ service: fakeService({ getStatus: vi.fn(async () => ({ ok: false, error: "not_found" })) }) });
    try { expect((await t.call("GET", `/claims/${ID}`, undefined, t.site)).status).toBe(404); } finally { await t.close(); }
  });

  it("the WordPress token cannot call a single admin route", using({}, async (t) => {
    const calls = [
      ["GET", "/admin/claims/summary"], ["GET", "/admin/claims"], ["GET", `/admin/claims/${ID}`], ["GET", `/admin/claims/${ID}/precheck`],
      ["POST", `/admin/claims/${ID}/accept`, { reviewedBy: "Asha", evidenceReviewed: true }], ["POST", `/admin/claims/${ID}/reject`, { reviewedBy: "Asha", reason: "x" }],
      ["POST", `/admin/claims/${ID}/retry`, { reviewedBy: "Asha" }], ["GET", `/admin/claims/${ID}/files/${ID2}`],
    ];
    for (const [m, p, b] of calls) {
      expect((await t.call(m, p, b, t.site)).status).toBe(401); // the site's token, in the site's header
      expect((await t.call(m, p, b, { "x-copyright-admin-token": SITE })).status).toBe(401); // the site's token in the admin header
      expect((await t.call(m, p, b, {})).status).toBe(401);
    }
    for (const fn of [t.service.list, t.service.get, t.service.accept, t.service.reject, t.service.retryProcessing, t.service.summary, t.service.precheck, t.service.openFile]) expect(fn).not.toHaveBeenCalled();
  }));

  it("the admin token cannot submit a claim or read a claimant's status", using({}, async (t) => {
    expect((await t.call("POST", "/claims", { name: "X" }, t.admin)).status).toBe(401);
    expect((await t.call("GET", `/claims/${ID}`, undefined, t.admin)).status).toBe(401);
  }));

  it("the admin routes are not usable when the admin token is missing or is the same as the WordPress token", async () => {
    for (const adminToken of ["", SITE]) {
      const t = await serve({ settings: { adminToken } });
      try {
        expect((await t.call("GET", "/admin/claims/summary", undefined, { "x-copyright-admin-token": adminToken || "anything" })).status).toBe(503);
        expect((await t.call("POST", "/claims", { name: "X" }, t.site)).status).toBe(200); // the WordPress side still works
      } finally { await t.close(); }
    }
  });

  it("serves the admin panel: summary, list, one claim, the search, accept, reject, retry", using({}, async (t) => {
    expect((await (await t.call("GET", "/admin/claims/summary", undefined, t.admin)).json()).data).toEqual({ pending: 3, oldestPendingAt: "2026-11-03 09:00:00", failingProcessing: 1 });
    expect((await (await t.call("GET", "/admin/claims?status=pending&beforeId=9&limit=5", undefined, t.admin)).json()).data).toEqual({ items: [{ id: 2 }], next: 2 });
    expect(t.service.list).toHaveBeenCalledWith({ status: "pending", beforeId: "9", limit: "5" });
    expect((await (await t.call("GET", `/admin/claims/${ID}`, undefined, t.admin)).json()).data).toEqual({ claim: { complaintId: ID }, files: [], filesError: null });
    expect((await (await t.call("GET", `/admin/claims/${ID}/precheck`, undefined, t.admin)).json()).data.networks[0].check).toBe("found");
    const acc = await t.call("POST", `/admin/claims/${ID}/accept`, { reviewedBy: "Asha Rao", evidenceReviewed: true, note: "ok" }, t.admin);
    expect(acc.status).toBe(200);
    expect((await acc.json()).data).toMatchObject({ status: "accepted", processingStatus: "ok", already: false });
    expect(t.service.accept).toHaveBeenCalledWith({ complaintId: ID, reviewedBy: "Asha Rao", evidenceReviewed: true, note: "ok" });
    expect((await t.call("POST", `/admin/claims/${ID}/reject`, { reviewedBy: "Asha", reason: "no proof" }, t.admin)).status).toBe(200);
    expect(t.service.reject).toHaveBeenCalledWith({ complaintId: ID, reviewedBy: "Asha", reason: "no proof" });
    expect((await t.call("POST", `/admin/claims/${ID}/retry`, { reviewedBy: "Asha" }, t.admin)).status).toBe(200);
  }));

  it("maps decision errors: 404 unknown, 409 already decided, 400 missing reviewer, reason or confirmation", async () => {
    for (const [error, code] of [["not_found", 404], ["already_decided", 409], ["not_accepted", 409], ["reviewer_required", 400], ["reason_required", 400], ["evidence_not_reviewed", 400], ["failed", 503]]) {
      const t = await serve({ service: fakeService({ accept: vi.fn(async () => ({ ok: false, error, message: `m ${error}` })) }) });
      try { expect((await t.call("POST", `/admin/claims/${ID}/accept`, { reviewedBy: "A" }, t.admin)).status).toBe(code); } finally { await t.close(); }
    }
  });

  it("downloads a file through this server with download-only headers", using({}, async (t) => {
    const res = await t.call("GET", `/admin/claims/${ID}/files/${ID2}`, undefined, t.admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toMatch(/^%PDF/);
    expect(t.service.openFile).toHaveBeenCalledWith({ complaintId: ID, fileId: ID2 });
  }));

  it("does not download a file that is not scanned, is missing, whose claim is unknown, or when files are not enabled", async () => {
    for (const [error, code] of [["scan_pending", 409], ["not_found", 404], ["unavailable", 503], ["not_configured", 503], ["no_database", 503]]) {
      const t = await serve({ service: fakeService({ openFile: vi.fn(async () => ({ ok: false, error })) }) });
      try { expect((await t.call("GET", `/admin/claims/${ID}/files/${ID2}`, undefined, t.admin)).status).toBe(code); } finally { await t.close(); }
    }
  });

  it("takes the files of a claim: needs the status key, keeps to the limits, and removes its temp files", async () => {
    const seen = [];
    const t = await serve({ files: fakeFiles({ addFiles: vi.fn(async ({ files }) => { seen.push(...files); return { ok: true, results: files.map((f) => ({ ok: true, name: f.originalName, fileId: "f1" })) }; }) }) });
    try {
      const res = await t.call("POST", `/claims/${ID}/attachments`, formWith(["a.pdf", Buffer.from("%PDF-1.4 a")], ["b.png", Buffer.from("png b")]), { ...t.site, "x-claim-key": "key1" });
      expect(res.status).toBe(200);
      expect((await res.json()).data.results.map((r) => [r.name, r.ok])).toEqual([["a.pdf", true], ["b.png", true]]);
      expect(t.service.claimForUpload).toHaveBeenCalledWith({ complaintId: ID, key: "key1" });
      expect(seen).toHaveLength(2);
      await new Promise((r) => setTimeout(r, 80));
      for (const f of seen) expect(fs.existsSync(f.path)).toBe(false); // nothing is left in the temp folder

      const tooBig = await t.call("POST", `/claims/${ID}/attachments`, formWith(["big.pdf", Buffer.alloc(5000, 1)]), { ...t.site, "x-claim-key": "key1" });
      expect(tooBig.status).toBe(400);
      expect((await tooBig.json()).message).toMatch(/larger than the limit/);
      const tooMany = await t.call("POST", `/claims/${ID}/attachments`, formWith(["1", Buffer.from("1")], ["2", Buffer.from("2")], ["3", Buffer.from("3")], ["4", Buffer.from("4")]), { ...t.site, "x-claim-key": "key1" });
      expect(tooMany.status).toBe(400);
      expect((await t.call("POST", `/claims/${ID}/attachments`, new FormData(), { ...t.site, "x-claim-key": "key1" })).status).toBe(400);
      expect((await t.call("POST", `/claims/${ID}/attachments`, formWith(["a.pdf", Buffer.from("x")]), {})).status).toBe(401);
    } finally { await t.close(); }
  });

  it("refuses files for a wrong key or a claim that is no longer pending, and says so when nothing could be stored", async () => {
    for (const [error, code] of [["not_found", 404], ["not_pending", 409]]) {
      const t = await serve({ service: fakeService({ claimForUpload: vi.fn(async () => ({ ok: false, error, message: "m" })) }) });
      try {
        expect((await t.call("POST", `/claims/${ID}/attachments`, formWith(["a.pdf", Buffer.from("x")]), { ...t.site, "x-claim-key": "k" })).status).toBe(code);
        expect(t.files.addFiles).not.toHaveBeenCalled();
      } finally { await t.close(); }
    }
    const none = await serve({ files: fakeFiles({ addFiles: vi.fn(async () => ({ ok: false, results: [{ ok: false, name: "a.pdf", reason: "type_not_allowed" }] })) }) });
    try {
      const res = await none.call("POST", `/claims/${ID}/attachments`, formWith(["a.pdf", Buffer.from("x")]), { ...none.site, "x-claim-key": "k" });
      expect(res.status).toBe(422);
      expect((await res.json()).data.results[0].reason).toBe("type_not_allowed");
    } finally { await none.close(); }
  });

  it("answers 503 for files when the evidence storage is not enabled", async () => {
    const t = await serve({ files: null, settings: { attachments: { enabled: false } } });
    try {
      expect((await t.call("POST", `/claims/${ID}/attachments`, formWith(["a.pdf", Buffer.from("x")]), { ...t.site, "x-claim-key": "k" })).status).toBe(503);
    } finally { await t.close(); }
  });
});

describe("claims > mounting", () => {
  async function ask(router, path) {
    const app = express();
    app.use(express.json());
    app.use("/c", router);
    const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    try {
      return (await fetch(`http://127.0.0.1:${server.address().port}/c${path}`, { method: "POST", headers: { "content-type": "application/json", "x-copyright-token": "t" }, body: "{}" })).status;
    } finally { await new Promise((r) => server.close(r)); }
  }

  it("the claims routes do not exist unless they are switched on: a plain request router has no /claims", async () => {
    const plain = createRouter({ settings: { token: "t", rateLimit: { windowMs: 60000, max: 100 } }, submit: vi.fn() });
    expect(await ask(plain, "/claims")).toBe(404);
  });

  it("they are mounted on the request router when given one", async () => {
    const claimsRouter = createClaimsRouter({
      settings: { adminToken: "a", statusSecret: "s", attachments: { enabled: false } },
      requestSettings: { token: "t", rateLimit: { windowMs: 60000, max: 100 } },
      claims: { submit: vi.fn(async () => ({ ok: true, complaintId: ID, claimReference: "CR-ABC234", status: "pending", statusKey: "k" })) },
    });
    const router = createRouter({ settings: { token: "t", rateLimit: { windowMs: 60000, max: 100 } }, submit: vi.fn(), claimsRouter });
    expect(await ask(router, "/claims")).toBe(200);
  });

  it("are off by default in the configuration, with the secrets read from the environment and two different tokens expected", () => {
    const { compliance } = require("../../../src/config");
    expect(compliance.claims).toMatchObject({ enabled: false, homeNetwork: "facebook", requireEvidenceReviewed: true });
    expect(typeof compliance.claims.adminToken).toBe("string");
    expect(typeof compliance.claims.statusSecret).toBe("string");
  });
});

describe("claims > opening an evidence file", () => {
  const ATT = (over = {}) => ({ listFiles: async () => [], openFile: vi.fn(async () => ({ ok: true, stream: Readable.from(["x"]), headers: {} })), ...over });

  it("opens it only for a claim that exists, with the claim's own id, through the files service", async () => {
    const attachments = ATT();
    const t = build({ attachments });
    await t.service.submit(claim());
    expect((await t.service.openFile({ complaintId: ID.toUpperCase(), fileId: ID2 })).ok).toBe(true);
    expect(attachments.openFile).toHaveBeenCalledWith({ sql: { fake: true }, complaintId: ID, fileId: ID2 });
    expect((await t.service.openFile({ complaintId: ID2, fileId: ID2 })).error).toBe("not_found"); // a claim that does not exist
    expect((await t.service.openFile({ complaintId: "x", fileId: ID2 })).error).toBe("not_found");
    expect(attachments.openFile).toHaveBeenCalledTimes(1);
  });

  it("says so when evidence files are not enabled, or the database is not connected", async () => {
    const off = build({});
    await off.service.submit(claim());
    expect((await off.service.openFile({ complaintId: ID, fileId: ID2 })).error).toBe("not_configured");
    const down = build({ attachments: ATT(), sql: null });
    expect((await down.service.openFile({ complaintId: ID, fileId: ID2 })).error).toBe("no_database");
  });
});

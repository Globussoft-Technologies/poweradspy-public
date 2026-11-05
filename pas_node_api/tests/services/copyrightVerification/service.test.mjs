import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const config = require("../../../src/config");
const databaseManager = require("../../../src/database/DatabaseManager");
const blocklist = require("../../../src/compliance/blocklist/service");
const nas = require("../../../src/insertion/helpers/nasClient");
const { ImageHashClient } = require("../../../src/compliance/imagematch/client");
const { parseHash } = require("../../../src/compliance/imagematch/matcher");
const fbDelete = require("../../../src/services/facebook/insertion/deletePipeline");
const status = require("../../../src/services/copyrightVerification/status");
const service = require("../../../src/services/copyrightVerification/service");
const { compare, matchBatch } = require("../../../src/services/copyrightVerification/hashWorker");

const V = "sscd-simhash-v1";
const SHA_BLOCKED = "a".repeat(64);
const PHASH = "0".repeat(64);
const PHASH_FAR = "f".repeat(64);
const banned = [{ id: 7, sha256: SHA_BLOCKED, phash: parseHash(PHASH), algo: V }];

// A tiny SQL fake: answers the page / media / update / audit queries the service sends.
function makeSql(ads, media, internal = []) {
  const calls = [];
  return {
    calls,
    async query(q, p = []) {
      calls.push({ q, p });
      if (q.includes("FROM facebook_ad a")) return ads.filter((a) => a.copyright_status === p[0] && Number(a.id) > Number(p[1]));
      if (q.includes("FROM facebook_ad_variants")) return media.filter((m) => p.includes(String(m.ad)));
      if (q.includes("FROM facebook_ad_image_video")) return [];
      if (q.includes("FROM copyright_blocklist")) return internal.filter((r) => p.includes(r.value));
      if (q.startsWith("UPDATE facebook_ad SET copyright_status")) {
        const [to, ...rest] = p; const from = rest.pop();
        let n = 0; for (const a of ads) if (rest.includes(String(a.id)) && a.copyright_status === from) { a.copyright_status = to; n++; }
        return { affectedRows: n };
      }
      return { affectedRows: 1 };
    },
  };
}

function makeEs() {
  const bulks = [];
  return {
    bulks, esMajor: 6, indexName: "search_mix",
    async search({ body }) { return { hits: { hits: body.query.terms["facebook_ad.id"].map((id) => ({ _id: `doc-${id}`, _index: "search_mix", _type: "doc" })) } }; },
    async bulk({ body }) { bulks.push(body); return { errors: false }; },
  };
}

let saved;
beforeEach(() => {
  saved = JSON.parse(JSON.stringify({ v: config.compliance.copyrightVerification, m: config.compliance.imageMatch, url: config.insertion.nas.mediaUrl }));
  Object.assign(config.compliance.copyrightVerification, { enabled: true, networks: ["facebook"], batchSize: 50, workers: 2,
    hashConcurrency: 2, maxHashAttempts: 2, afterMaxAttempts: "pending", cleanupBatchSize: 10, nasConcurrency: 2, maxNasAttempts: 2, blockAdvertiser: false, audit: true,
    recheckExisting: false, recheckEntries: 100, recheckAds: 1000, recheckLookbackHours: 24 });
  Object.assign(config.compliance.imageMatch, { hashVersion: V, perceptual: { enabled: true, rejectDistance: 10, reviewDistance: 20 } });
  config.insertion.nas.mediaUrl = "https://cdn.test";
  vi.spyOn(ImageHashClient.prototype, "health").mockResolvedValue({ ok: true, ready: true, hashVersion: V, hashBits: 256 });
  vi.spyOn(blocklist, "getImageHashes").mockReturnValue({ available: true, hashes: banned });
  vi.spyOn(blocklist, "recordAttempt").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(config.compliance.copyrightVerification, saved.v);
  Object.assign(config.compliance.imageMatch, saved.m);
  config.insertion.nas.mediaUrl = saved.url;
});

describe("status helpers", () => {
  it("hide pending/failed in ES and keep legacy docs (no field) visible", () => {
    expect(status.searchFilter()).toEqual({ bool: { must_not: { terms: { copyright_status: [0, 2] } } } });
    expect(status.sqlPredicate("facebook_ad")).toBe(" AND facebook_ad.copyright_status = 1");
  });
  it("copies the SQL status into a full ES re-index and never throws", async () => {
    const sql = { query: vi.fn().mockResolvedValue([{ copyright_status: 1 }]) };
    const out = await status.indexDocument("facebook", "search_mix", { index: "search_mix", body: { facebook_ad: { id: 5 } } }, () => sql);
    expect(out.body.copyright_status).toBe(1);
    // Real insertion docs use a flat dotted key, not a nested object.
    const flat = await status.indexDocument("facebook", "search_mix", { index: "search_mix", body: { "facebook_ad.id": 5 } }, () => sql);
    expect(flat.body.copyright_status).toBe(1);
    const broken = await status.indexDocument("facebook", "search_mix", { index: "search_mix", body: { facebook_ad: { id: 5 } } }, () => { throw new Error("down"); });
    expect(broken.body.copyright_status).toBe(0);
  });
  it("does nothing while disabled", () => {
    config.compliance.copyrightVerification.enabled = false;
    expect(status.searchFilter()).toBeNull();
    expect(status.sqlPredicate("facebook_ad")).toBe("");
  });
});

describe("hash worker", () => {
  it("rejects exact and near copies, allows far ones", () => {
    const opts = { hashVersion: V, perceptual: { enabled: true, rejectDistance: 10, reviewDistance: 20 } };
    const out = compare([{ sha256: SHA_BLOCKED, phash: PHASH_FAR }, { sha256: "b".repeat(64), phash: PHASH }, { sha256: "c".repeat(64), phash: PHASH_FAR }], banned, opts);
    expect(out.map((r) => r.action)).toEqual(["reject", "reject", "allow"]);
  });
  it("runs in worker threads and keeps order", async () => {
    const opts = { hashVersion: V, perceptual: { enabled: true, rejectDistance: 10, reviewDistance: 20 } };
    const out = await matchBatch([{ sha256: "c".repeat(64), phash: PHASH_FAR }, { sha256: SHA_BLOCKED, phash: PHASH_FAR }], banned, opts, 2);
    expect(out.map((r) => r.action)).toEqual(["allow", "reject"]);
  });
});

describe("verification cron", () => {
  it("approves clean ads (ES then SQL), fails blocklist matches, keeps unreachable images pending", async () => {
    const ads = [
      { id: 1, ad_id: "p1", post_owner: "Good Co", copyright_status: 0 },
      { id: 2, ad_id: "p2", post_owner: "Bad Co", copyright_status: 0 },   // metadata hit
      { id: 3, ad_id: "p3", post_owner: "Copy Co", copyright_status: 0 },  // image hit
      { id: 4, ad_id: "p4", post_owner: "Slow Co", copyright_status: 0 },  // image not hashable yet
    ];
    const media = [1, 3, 4].map((id) => ({ ad: id, image_url: `/b/stream/fb/adImage/2026-11/${id}.jpg` }));
    const sql = makeSql(ads, media); const es = makeEs();
    vi.spyOn(databaseManager, "getConnections").mockReturnValue({ sql, elastic: es });
    vi.spyOn(blocklist, "match").mockImplementation((ad) => (ad.post_owner === "Bad Co" ? { hit: { entry: { id: 9, entryType: "advertiser" } } } : null));
    vi.spyOn(ImageHashClient.prototype, "hashUrl").mockImplementation(async (url) => {
      if (url.endsWith("/3.jpg")) return { ok: true, sha256: SHA_BLOCKED, sscdHash: PHASH_FAR };
      if (url.endsWith("/4.jpg")) return { ok: false, outcome: "unavailable" };
      return { ok: true, sha256: "c".repeat(64), sscdHash: PHASH_FAR };
    });

    const out = await service.runVerification({});
    expect(out.facebook).toMatchObject({ scanned: 4, approved: 1, failed: 2, pending: 1 });
    expect(ads.map((a) => a.copyright_status)).toEqual([1, 2, 2, 0]);
    expect(es.bulks).toHaveLength(1);
    expect(es.bulks[0][1]).toEqual({ doc: { copyright_status: 1 } });
    expect(blocklist.recordAttempt).toHaveBeenCalledTimes(2);
  });

  it("fails an ad blocked by its internal row id (identifier_namespace = internal)", async () => {
    const ads = [{ id: 21, ad_id: "p21", post_owner: "X", copyright_status: 0 }, { id: 22, ad_id: "21", post_owner: "Y", copyright_status: 0 }];
    const sql = makeSql(ads, [], [{ id: 5, value: "21" }]);
    vi.spyOn(databaseManager, "getConnections").mockReturnValue({ sql, elastic: makeEs() });
    vi.spyOn(blocklist, "match").mockReturnValue(null);
    vi.spyOn(blocklist, "getImageHashes").mockReturnValue({ available: true, hashes: [] });
    await service.runVerification({});
    // Internal id 21 is ad 21 only; ad 22 whose PLATFORM id is "21" is not touched.
    expect(ads.map((a) => a.copyright_status)).toEqual([2, 1]);
    expect(sql.calls.find((c) => c.q.includes("FROM copyright_blocklist")).q).toContain("identifier_namespace = 'internal'");
  });

  it("does nothing while disabled", async () => {
    config.compliance.copyrightVerification.enabled = false;
    const spy = vi.spyOn(databaseManager, "getConnections");
    expect(await service.runVerification({})).toHaveProperty("skipped");
    expect(spy).not.toHaveBeenCalled();
  });
});

// SQL fake for the re-check of existing ads against new blocklist entries.
function makeRecheckSql({ entries, owners = [], ads, hashes = [] }) {
  const live = (a) => a.copyright_status === 0 || a.copyright_status === 1;
  return {
    async query(q, p = []) {
      if (q.includes("MIN(id) FROM copyright_blocklist")) return [{ first: null, last: 0 }];
      if (q.includes("FROM copyright_blocklist")) return entries.filter((e) => e.id > p[0]);
      if (q.includes("FROM copyright_image_hashes")) return hashes.filter((h) => h.sha256 === p[0]).map((h) => ({ id: h.internal_ad_id }));
      if (q.includes("FROM `facebook_ad_post_owners`")) { expect(q).toContain("`post_owner_lower` IN"); return owners.filter((o) => p.includes(o.name)).map((o) => ({ id: o.id })); }
      if (q.startsWith("UPDATE facebook_ad SET copyright_status")) {
        const [to, ...rest] = p; const from = rest.splice(-2);
        let n = 0; for (const a of ads) if (rest.includes(String(a.id)) && from.includes(a.copyright_status)) { a.copyright_status = to; n++; }
        return { affectedRows: n };
      }
      if (q.includes("WHERE post_owner_id IN")) {
        const after = p[p.length - 1]; const ownerIds = p.slice(0, -1); const limit = Number(q.match(/LIMIT (\d+)/)[1]);
        return ads.filter((a) => ownerIds.includes(a.owner) && a.id > after && live(a)).slice(0, limit).map((a) => ({ id: a.id }));
      }
      if (q.includes("FROM facebook_ad WHERE id IN")) return ads.filter((a) => p.includes(String(a.id)) && live(a)).map((a) => ({ id: a.id }));
      if (q.includes("FROM facebook_ad WHERE ad_id")) return ads.filter((a) => a.adId === p[0] && live(a)).map((a) => ({ id: a.id }));
      throw new Error(`unexpected query ${q}`);
    },
  };
}

describe("re-check of existing ads", () => {
  beforeEach(() => service.recheckCursors.clear());
  const s = () => config.compliance.copyrightVerification;

  it("fails the existing approved ads of a newly blocked advertiser and hides them in ES", async () => {
    const ads = [{ id: 1, owner: 9, copyright_status: 1 }, { id: 2, owner: 9, copyright_status: 0 }, { id: 3, owner: 8, copyright_status: 1 }];
    const sql = makeRecheckSql({ entries: [{ id: 1, entry_type: "advertiser", identifier_namespace: "none", value: "Acme Corp" }], owners: [{ id: 9, name: "acme corp" }], ads });
    const es = makeEs();
    const out = await service.recheckExisting({ sql, elastic: es }, "facebook", s());
    expect(out).toEqual({ entries: 1, failed: 2 });
    expect(ads.map((a) => a.copyright_status)).toEqual([2, 2, 1]);
    expect(es.bulks[0].filter((x) => x.doc).every((x) => x.doc.copyright_status === 2)).toBe(true);
    // Why each ad failed goes to the Rejected ads tab.
    expect(blocklist.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ blocklistId: 1, matchType: "advertiser", advertiser: "Acme Corp", source: "verification-recheck" }));
    // Next tick: nothing new.
    expect(await service.recheckExisting({ sql, elastic: es }, "facebook", s())).toEqual({ entries: 0, failed: 0 });
  });

  it("fails the ad an image_hash entry came from and every stored exact copy", async () => {
    const ads = [{ id: 10, copyright_status: 1 }, { id: 11, copyright_status: 1 }, { id: 12, copyright_status: 1 }];
    const sql = makeRecheckSql({ ads,
      entries: [{ id: 5, entry_type: "image_hash", value: SHA_BLOCKED, image_sha256: SHA_BLOCKED, details: JSON.stringify({ internal_ad_id: 10 }) }],
      hashes: [{ sha256: SHA_BLOCKED, internal_ad_id: 11 }] });
    const out = await service.recheckExisting({ sql, elastic: makeEs() }, "facebook", s());
    expect(out.failed).toBe(2);
    expect(ads.map((a) => a.copyright_status)).toEqual([2, 2, 1]);
  });

  it("pages a big advertiser across ticks (recheckAds per tick)", async () => {
    const ads = [1, 2, 3, 4, 5].map((id) => ({ id, owner: 9, copyright_status: 1 }));
    const sql = makeRecheckSql({ ads, entries: [{ id: 1, entry_type: "advertiser", value: "acme" }, { id: 2, entry_type: "ad_id", identifier_namespace: "platform", value: "P1" }],
      owners: [{ id: 9, name: "acme" }] });
    ads.push({ id: 6, owner: 7, adId: "P1", copyright_status: 1 });
    const cfg = { ...s(), recheckAds: 2 };
    expect((await service.recheckExisting({ sql, elastic: makeEs() }, "facebook", cfg)).failed).toBe(2);
    expect((await service.recheckExisting({ sql, elastic: makeEs() }, "facebook", cfg)).failed).toBe(2);
    expect((await service.recheckExisting({ sql, elastic: makeEs() }, "facebook", cfg)).failed).toBe(2); // ad 5 + the ad_id entry
    expect(ads.every((a) => a.copyright_status === 2)).toBe(true);
  });
});

describe("cleanup cron", () => {
  it("closes runs stuck at 'running' even when there is nothing to delete", async () => {
    const sql = makeSql([], []);
    vi.spyOn(databaseManager, "getConnections").mockReturnValue({ sql, elastic: makeEs() });
    expect(await service.cleanupNetwork("facebook")).toEqual({ scanned: 0 });
    const stale = sql.calls.find((c) => c.q.startsWith("UPDATE copyright_takedown_runs SET status = 'failed'"));
    // planned is kept; what the run did not finish counts as failed in that run
    expect(stale.q).toContain("items_failed = GREATEST(items_planned - items_succeeded, 0)");
    expect(stale.q).not.toContain("items_planned =");
    expect(stale.p).toEqual(["facebook", "copyright-verification"]);
  });

  it("blocklists, deletes own NAS files, deletes through the existing pipeline and writes audit rows", async () => {
    const ads = [{ id: 11, ad_id: "p11", post_owner: "Bad Co", copyright_status: 2 }];
    const media = [{ ad: 11, image_url: "/b/stream/fb/adImage/2026-11/11.jpg" }, { ad: 11, image_url: "/b/stream/fb/postowner/2026-11/99.jpg" }];
    const sql = makeSql(ads, media);
    vi.spyOn(databaseManager, "getConnections").mockReturnValue({ sql, elastic: makeEs() });
    const add = vi.spyOn(blocklist, "add").mockResolvedValue({ ok: true });
    const del = vi.spyOn(nas, "deleteFromNas").mockResolvedValue(true);
    const pipe = vi.spyOn(fbDelete, "processDelete").mockResolvedValue({ code: 200 });

    const out = await service.runCleanup({});
    expect(out.facebook).toMatchObject({ scanned: 1, removed: 1, runId: expect.any(String) });
    // The takedown run (with its snapshot) is saved before anything is deleted, then closed with its steps.
    const runAt = sql.calls.findIndex((c) => c.q.includes("INSERT INTO copyright_takedown_runs"));
    expect(runAt).toBeGreaterThan(-1);
    expect(JSON.parse(sql.calls[runAt].p[4]).ads[0]).toEqual({ internalId: "11", platformAdId: "p11", storagePaths: ["/b/stream/fb/adImage/2026-11/11.jpg"] });
    expect(del.mock.invocationCallOrder[0]).toBeGreaterThan(0);
    const steps = sql.calls.find((c) => c.q.includes("INSERT INTO copyright_takedown_actions"));
    expect(steps.p.filter((v) => v === "storage" || v === "sql")).toEqual(["storage", "sql"]);
    expect(sql.calls.filter((c) => c.q.startsWith("UPDATE copyright_takedown_runs")).pop().p.slice(0, 4)).toEqual(["succeeded", 1, 1, 0]); // status, planned, succeeded, failed
    // `system` is a reserved word in MySQL 8: the step and finding inserts must quote it
    for (const c of sql.calls.filter((x) => /INSERT INTO copyright_(takedown_actions|audit_findings)/.test(x.q))) expect(c.q).toContain("`system`");
    expect(add.mock.calls[0][0][0]).toMatchObject({ entryType: "ad_id", identifierNamespace: "platform", value: "p11", network: "facebook" });
    expect(del).toHaveBeenCalledTimes(1); // the shared post-owner image is never deleted
    expect(del.mock.calls[0][0]).toBe("/b/stream/fb/adImage/2026-11/11.jpg");
    expect(pipe).toHaveBeenCalledWith({ id: "11", body: { id: "11" } }, expect.objectContaining({ network: "facebook" }));
    expect(sql.calls.some((c) => c.q.includes("INSERT INTO copyright_audit_findings"))).toBe(true);
  });

  it("retries a failed NAS delete before removing SQL", async () => {
    const ads = [{ id: 12, ad_id: "p12", copyright_status: 2 }];
    const sql = makeSql(ads, [{ ad: 12, image_url: "/b/stream/fb/adImage/2026-11/12.jpg" }]);
    vi.spyOn(databaseManager, "getConnections").mockReturnValue({ sql, elastic: makeEs() });
    vi.spyOn(blocklist, "add").mockResolvedValue({ ok: true });
    vi.spyOn(nas, "deleteFromNas").mockResolvedValue(false);
    const pipe = vi.spyOn(fbDelete, "processDelete").mockResolvedValue({ code: 200 });
    expect((await service.runCleanup({})).facebook.removed).toBe(0);
    expect(pipe).not.toHaveBeenCalled();
    expect((await service.runCleanup({})).facebook.removed).toBe(1); // maxNasAttempts reached: removed, failure kept in audit
  });
});

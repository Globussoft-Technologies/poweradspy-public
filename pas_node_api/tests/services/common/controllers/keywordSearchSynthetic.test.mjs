import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);

const dbManager = require("../../../../src/database/DatabaseManager");
const config = require("../../../../src/config");
const { insertSyntheticKeywords, scraperWork, storeKeywordSearch, enforceCap } =
  require("../../../../src/services/common/controllers/keywordSearchController");
const { parseJsonKeywords, parseCsvFile, splitCsvLine } =
  require("../../../../src/services/common/helpers/keywordInput");

const ALL_NETWORKS = config.keywordSearch.networks;

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

// Detect which cap category a filter targets (handles the $and-wrapped delete filter too).
function categoryOf(filter) {
  const f = filter && filter.$and ? filter.$and[0] : filter;
  if (!f) return null;
  if (f.$or) return 'user';
  if (f.users === null) return 'synthetic';
  return null;
}

// Fake collection capturing the ops the controller issues. `existing` = set of valueNorms
// already present (bulkWrite/updateOne report them as duplicates, not upserts). `counts` =
// per-category countDocuments result; `oldest` = per-category _id list returned by find().
// `oldest` = ids returned by the phase-1 (scraped) find ($and filter); `oldestAny` = ids
// returned by the phase-2 (hard-cap fallback) find (plain category filter).
// Which claim tier a /work filter targets (priority | user | synthetic | daily).
function tierOf(filter) {
  const net = filter.networks;
  if (filter[`networkState.${net}.isActive`] === true) return "priority";
  if (filter[`networkState.${net}.dailyClaimDate`]) {
    if (filter.$or) return "user";
    if (filter.users === null) return "synthetic";
  }
  return "daily";
}

function makeCol({ existing = new Set(), claimDoc = null, counts = {}, oldest = {}, oldestAny = {}, tierDocs = null } = {}) {
  const calls = { bulkWrite: [], findOneAndUpdate: [], updateOne: [], updateMany: [], countDocuments: [], find: [], deleteMany: [] };
  let claimsLeft = claimDoc ? 1 : 0;
  return {
    calls,
    createIndexes: vi.fn(async () => []),
    bulkWrite: vi.fn(async (ops) => {
      calls.bulkWrite.push(ops);
      const upsertedCount = ops.filter((o) => !existing.has(o.updateOne.filter.valueNorm)).length;
      return { upsertedCount };
    }),
    findOneAndUpdate: vi.fn(async (filter) => {
      calls.findOneAndUpdate.push(filter);
      if (tierDocs) return tierDocs[tierOf(filter)] ?? null; // tier-aware claim simulation
      if (claimsLeft > 0) { claimsLeft--; return claimDoc; }
      return null;
    }),
    updateOne: vi.fn(async (filter, update, opts) => {
      calls.updateOne.push({ filter, update, opts });
      return { upsertedCount: existing.has(filter.valueNorm) ? 0 : 1, matchedCount: 1, modifiedCount: 1 };
    }),
    updateMany: vi.fn(async (filter) => { calls.updateMany.push(filter); return { modifiedCount: 0 }; }),
    countDocuments: vi.fn(async (filter) => { calls.countDocuments.push(filter); return counts[categoryOf(filter)] ?? 0; }),
    deleteMany: vi.fn(async (filter) => { calls.deleteMany.push(filter); return { deletedCount: (filter._id && filter._id.$in ? filter._id.$in.length : 0) }; }),
    find: vi.fn((filter, opts) => {
      calls.find.push({ filter, opts });
      const cat = categoryOf(filter);
      const isScrapedPhase = !!(filter && filter.$and); // phase 1 wraps category AND scraped in $and
      const src = isScrapedPhase ? oldest[cat] : oldestAny[cat];
      let arr = (cat && src) ? src.map((id) => ({ _id: id })) : [];
      const cursor = { sort: () => cursor, limit: (n) => { arr = arr.slice(0, n); return cursor; }, toArray: async () => arr };
      return cursor;
    }),
  };
}

function installMongo(col) {
  const db = { collection: () => col };
  vi.spyOn(dbManager, "getMongo").mockReturnValue({ db, client: { db: () => db } });
}

let savedAutoRecover;
beforeEach(() => {
  vi.restoreAllMocks();
  savedAutoRecover = config.keywordSearch.autoRecoverStale;
  config.keywordSearch.autoRecoverStale = false; // keep scraperWork tests focused on the claim
});
afterEach(() => { config.keywordSearch.autoRecoverStale = savedAutoRecover; });

// ── parser ───────────────────────────────────────────────────────────────────
describe("keywordInput parser", () => {
  it("splitCsvLine honors quotes and escaped quotes", () => {
    expect(splitCsvLine('cat, "a,b", "he ""x"""')).toEqual(["cat", "a,b", 'he "x"']);
  });
  it("parseJsonKeywords handles strings, {keywords:[]}, and objects with type/network", () => {
    expect(parseJsonKeywords(["a", "b"])).toEqual([{ value: "a" }, { value: "b" }]);
    expect(parseJsonKeywords({ keywords: ["c"] })).toEqual([{ value: "c" }]);
    expect(parseJsonKeywords([{ value: "d", type: 2, network: "facebook" }]))
      .toEqual([{ value: "d", type: 2, network: "facebook" }]);
  });
  it("parseCsvFile reads one-per-line and a header with keyword/network", async () => {
    const tmp = path.join(os.tmpdir(), `synk_${Date.now()}.csv`);
    fs.writeFileSync(tmp, "keyword,network\nCat,facebook\ndog,instagram\n");
    expect(await parseCsvFile(tmp)).toEqual([
      { value: "Cat", network: "facebook" },
      { value: "dog", network: "instagram" },
    ]);
    fs.unlinkSync(tmp);
  });
});

// ── synthetic insert ──────────────────────────────────────────────────────────
describe("insertSyntheticKeywords", () => {
  it("inserts with users:null + userInfos:null, dedupes case-insensitively, $setOnInsert only", async () => {
    const col = makeCol();
    installMongo(col);
    const res = mockRes();
    await insertSyntheticKeywords({ body: { keywords: ["cat", "Cat", " CAT ", "dog"], network: "all" } }, res);

    expect(res.body.code).toBe(200);
    expect(res.body.data).toMatchObject({ received: 4, unique: 2, inserted: 2, duplicatesIgnored: 0 });

    const ops = col.calls.bulkWrite[0];
    expect(ops.map((o) => o.updateOne.filter.valueNorm).sort()).toEqual(["cat", "dog"]);
    const op = ops.find((o) => o.updateOne.filter.valueNorm === "cat").updateOne;
    expect(Object.keys(op.update)).toEqual(["$setOnInsert"]); // never $set → existing docs untouched
    expect(op.upsert).toBe(true);
    const doc = op.update.$setOnInsert;
    expect(doc.users).toBeNull();
    expect(doc.userInfos).toBeNull();
    expect(doc).toMatchObject({ type: 1, value: "cat", valueNorm: "cat", userCount: 0, searchCount: 0, lastSearchedAt: null, searchDates: [] });
    expect(doc.networks).toEqual(ALL_NETWORKS);
    // networkState: one entry per network, daily-crawlable but NOT in the priority queue
    expect(Object.keys(doc.networkState).sort()).toEqual([...ALL_NETWORKS].sort());
    for (const net of ALL_NETWORKS) expect(doc.networkState[net]).toEqual({ isActive: false });
  });

  it("reports already-present keywords as duplicatesIgnored (no clobber)", async () => {
    const col = makeCol({ existing: new Set(["cat"]) });
    installMongo(col);
    const res = mockRes();
    await insertSyntheticKeywords({ body: { keywords: ["cat", "new"], network: "facebook" } }, res);
    expect(res.body.data).toMatchObject({ received: 2, unique: 2, inserted: 1, duplicatesIgnored: 1 });
  });

  it("applies per-item type/network overrides over batch defaults", async () => {
    const col = makeCol();
    installMongo(col);
    const res = mockRes();
    await insertSyntheticKeywords({ body: { type: 1, network: "facebook", keywords: [{ value: "adX", type: 2, network: "instagram,reddit" }] } }, res);
    const op = col.calls.bulkWrite[0][0].updateOne;
    expect(op.filter.type).toBe(2);
    expect(op.update.$setOnInsert.networks.sort()).toEqual(["instagram", "reddit"]);
  });

  it("reads a CSV upload and unlinks the temp file", async () => {
    const col = makeCol();
    installMongo(col);
    const tmp = path.join(os.tmpdir(), `synk_post_${Date.now()}.csv`);
    fs.writeFileSync(tmp, "apple\nbanana\nAPPLE\n");
    const res = mockRes();
    await insertSyntheticKeywords({ body: { network: "facebook" }, file: { path: tmp } }, res);
    expect(res.body.data).toMatchObject({ received: 3, unique: 2, inserted: 2 });
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it("400 when nothing is supplied", async () => {
    installMongo(makeCol());
    const res = mockRes();
    await insertSyntheticKeywords({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it("400 when no network is supplied (network is mandatory, no default)", async () => {
    const col = makeCol();
    installMongo(col);
    const res = mockRes();
    await insertSyntheticKeywords({ body: { keywords: ["cat", "dog"] } }, res); // no batch/per-item network
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/network is required/i);
    expect(res.body.data).toMatchObject({ received: 2, skippedNoNetwork: 2 });
    expect(col.calls.bulkWrite.length).toBe(0); // nothing inserted
  });

  it("400 when the network value is invalid (unknown slug)", async () => {
    installMongo(makeCol());
    const res = mockRes();
    await insertSyntheticKeywords({ body: { keywords: ["cat"], network: "myspace" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.data).toMatchObject({ skippedNoNetwork: 1 });
  });

  it("inserts items WITH a network and skips those without (per-item)", async () => {
    const col = makeCol();
    installMongo(col);
    const res = mockRes();
    // batch network absent → only the item carrying its own network is valid
    await insertSyntheticKeywords({ body: { keywords: [{ value: "withnet", network: "facebook" }, { value: "nonet" }] } }, res);
    expect(res.body.code).toBe(200);
    expect(res.body.data).toMatchObject({ received: 2, unique: 1, inserted: 1, skippedNoNetwork: 1 });
    expect(col.calls.bulkWrite[0].map((o) => o.updateOne.filter.valueNorm)).toEqual(["withnet"]);
  });
});

// ── synthetic-only claim on the work endpoint ──────────────────────────────────
describe("scraperWork synthetic filter", () => {
  const claimDoc = { _id: "d1", type: 1, value: "syn", userInfos: null, users: null };
  const req = (body) => ({ body, query: {}, get: (h) => (h === config.keywordSearch.scraperHeader ? "plug-1" : undefined) });

  it("restricts the claim to synthetic docs (userInfos:null) when body.users is null", async () => {
    const col = makeCol({ claimDoc });
    installMongo(col);
    const res = mockRes();
    await scraperWork(req({ type: "keyword", network: "facebook", users: null }), res);
    expect(res.body.synthetic).toBe(true);
    const filter = col.calls.findOneAndUpdate[0];
    expect(filter.userInfos).toBeNull();
    expect(filter).toMatchObject({ type: 1, networks: "facebook" });
  });

  it("also triggers on userInfos:null", async () => {
    const col = makeCol({ claimDoc });
    installMongo(col);
    const res = mockRes();
    await scraperWork(req({ type: "keyword", network: "facebook", userInfos: null }), res);
    expect(col.calls.findOneAndUpdate[0].userInfos).toBeNull();
  });

  it("does NOT add the filter for a normal claim (backward-compatible)", async () => {
    const col = makeCol({ claimDoc });
    installMongo(col);
    const res = mockRes();
    await scraperWork(req({ type: "keyword", network: "facebook" }), res);
    expect(res.body.synthetic).toBe(false);
    expect("userInfos" in col.calls.findOneAndUpdate[0]).toBe(false);
  });
});

// ── google-specific priority→user→synthetic ordering on /work (daily) ───────────
describe("scraperWork google ordering (daily, no priority flag)", () => {
  const doc = (value, mode) => ({ _id: "g_" + value, type: 1, value, userInfos: [], users: [] });
  const req = (body) => ({ body, query: {}, get: (h) => (h === config.keywordSearch.scraperHeader ? "g-plug" : undefined) });

  it("serves a PRIORITY (isActive:true) term first — single findOneAndUpdate, isActive flips false, mode priority", async () => {
    const col = makeCol({ tierDocs: { priority: doc("prio") } });
    installMongo(col);
    const res = mockRes();
    await scraperWork(req({ type: "keyword", network: "google" }), res); // NO priority flag
    const f0 = col.calls.findOneAndUpdate[0];
    expect(f0["networkState.google.isActive"]).toBe(true);  // tier-1 = priority gate
    expect(res.body.data[0].mode).toBe("priority");
    expect(res.body.data[0].value).toBe("prio");
  });

  it("falls back to USER-searched when no priority term, then to SYNTHETIC", async () => {
    // no priority, no user → only synthetic available: expect 3 attempts in order
    const col = makeCol({ tierDocs: { synthetic: doc("syn") } });
    installMongo(col);
    const res = mockRes();
    await scraperWork(req({ type: "keyword", network: "google" }), res);
    const filters = col.calls.findOneAndUpdate;
    expect(tierOf(filters[0])).toBe("priority");
    expect(tierOf(filters[1])).toBe("user");      // user-searched daily ($or users/userInfos)
    expect(tierOf(filters[2])).toBe("synthetic"); // synthetic daily (users:null)
    expect(filters[1].$or).toBeTruthy();
    expect(filters[2].users).toBeNull();
    expect(res.body.data[0].mode).toBe("daily");
    expect(res.body.data[0].value).toBe("syn");
  });

  it("user tier wins over synthetic when both exist (order)", async () => {
    const col = makeCol({ tierDocs: { user: doc("u"), synthetic: doc("s") } });
    installMongo(col);
    const res = mockRes();
    await scraperWork(req({ type: "keyword", network: "google" }), res);
    expect(col.calls.findOneAndUpdate.length).toBe(2); // priority(miss) → user(hit), stops
    expect(res.body.data[0].value).toBe("u");
  });

  it("non-google daily is UNCHANGED — a single daily attempt, no tiering", async () => {
    const col = makeCol({ tierDocs: { daily: doc("fb") } });
    installMongo(col);
    const res = mockRes();
    await scraperWork(req({ type: "keyword", network: "facebook" }), res);
    expect(col.calls.findOneAndUpdate.length).toBe(1);
    expect(tierOf(col.calls.findOneAndUpdate[0])).toBe("daily");
    expect(col.calls.findOneAndUpdate[0].$or).toBeUndefined(); // not split by user/synthetic
  });

  it("explicit priority:true for google is UNCHANGED — single priority attempt", async () => {
    const col = makeCol({ tierDocs: { priority: doc("p") } });
    installMongo(col);
    const res = mockRes();
    await scraperWork(req({ type: "keyword", network: "google", priority: true }), res);
    expect(col.calls.findOneAndUpdate.length).toBe(1);
    expect(tierOf(col.calls.findOneAndUpdate[0])).toBe("priority");
    expect(res.body.mode).toBe("priority");
  });
});

// ── enrichment seam: a user search upserts the SAME (type,valueNorm) doc ────────
describe("storeKeywordSearch enriches the same doc a synthetic keyword occupies", () => {
  it("upserts by {type, valueNorm} with upsert:true (so it matches an existing synthetic doc)", async () => {
    const col = makeCol({ existing: new Set(["nike"]) }); // pretend the synthetic 'nike' exists
    installMongo(col);
    const res = mockRes();
    await storeKeywordSearch(
      { body: { value: "Nike", type: 1, network: "all" }, user: { id: 9, email: "u@x.com", login: "u" } },
      res,
    );
    expect(res.body.data.status).toBe("existing"); // matched the existing doc, not a new insert
    const { filter, opts } = col.calls.updateOne[0];
    expect(filter).toEqual({ type: 1, valueNorm: "nike" });
    expect(opts).toEqual({ upsert: true });
  });
});

// ── enforceCap: auto-deletion (oldest UNSCRAPED only, per category) ─────────────
describe("enforceCap", () => {
  const SCRAPED = { "scrapping_status.0": { $exists: true } };

  it("no-op when under the cap (no find / delete)", async () => {
    const col = makeCol({ counts: { synthetic: 100000 } });
    installMongo(col);
    const r = await enforceCap("synthetic");
    expect(r).toMatchObject({ category: "synthetic", deleted: 0 });
    expect(col.calls.find.length).toBe(0);
    expect(col.calls.deleteMany.length).toBe(0);
  });

  it("deletes the oldest already-SCRAPED docs down to the cap", async () => {
    // 100k cap, 100003 present → overflow 3; 3 scraped oldest available
    const col = makeCol({ counts: { synthetic: 100003 }, oldest: { synthetic: ["a", "b", "c", "d"] } });
    installMongo(col);
    const r = await enforceCap("synthetic");

    // find restricted to this category AND already-scraped, sorted by _id, limited to overflow
    const find = col.calls.find[0];
    expect(find.filter.$and[1]).toEqual(SCRAPED);
    expect(find.filter.$and[0]).toEqual({ users: null, userInfos: null }); // synthetic category
    expect(col.calls.deleteMany[0]._id.$in).toEqual(["a", "b", "c"]); // limited to overflow=3
    expect(r).toMatchObject({ category: "synthetic", totalBefore: 100003, deleted: 3, remaining: 100000 });
  });

  it("hard cap: when scraped docs aren't enough, also deletes the oldest not-yet-scraped", async () => {
    // overflow 5; only 2 scraped available (phase 1) → phase 2 deletes 3 not-yet-scraped
    const col = makeCol({
      counts: { synthetic: 100005 },
      oldest: { synthetic: ["x", "y"] },            // phase 1 (scraped)
      oldestAny: { synthetic: ["p", "q", "r", "s"] }, // phase 2 (fallback, oldest remaining)
    });
    installMongo(col);
    const r = await enforceCap("synthetic");

    expect(col.calls.deleteMany[0]._id.$in).toEqual(["x", "y"]);       // phase 1
    expect(col.calls.deleteMany[1]._id.$in).toEqual(["p", "q", "r"]);  // phase 2, limited to remaining 3
    // phase 2 find uses the plain category filter (no $and)
    expect(col.calls.find[1].filter.$and).toBeUndefined();
    expect(col.calls.find[1].filter).toEqual({ users: null, userInfos: null });
    expect(r).toMatchObject({ deleted: 5, deletedScraped: 2, deletedUnscraped: 3, remaining: 100000 }); // back to cap
  });

  it("uses the USER category filter for the user cap", async () => {
    const col = makeCol({ counts: { user: 100002 }, oldest: { user: ["u1", "u2"] } });
    installMongo(col);
    await enforceCap("user");
    expect(col.calls.countDocuments[0]).toEqual({ $or: [{ users: { $ne: null } }, { userInfos: { $ne: null } }] });
    expect(col.calls.find[0].filter.$and[0]).toEqual({ $or: [{ users: { $ne: null } }, { userInfos: { $ne: null } }] });
  });

  it("config.json applyTo scopes which categories are capped", async () => {
    const saved = config.keywordSearch.cleanup.applyTo;
    try {
      // applyTo='none' → nothing is enforced (auto-deletion disabled)
      config.keywordSearch.cleanup.applyTo = 'none';
      let col = makeCol({ counts: { user: 999999, synthetic: 999999 } });
      installMongo(col);
      expect((await enforceCap('user')).skipped).toMatch(/not applied/);
      expect((await enforceCap('synthetic')).skipped).toMatch(/not applied/);
      expect(col.calls.countDocuments.length).toBe(0);

      // applyTo='user' → only user is capped; synthetic is left alone
      config.keywordSearch.cleanup.applyTo = 'user';
      col = makeCol({ counts: { user: 100001, synthetic: 999999 }, oldest: { user: ['u1'] } });
      installMongo(col);
      expect((await enforceCap('user')).deleted).toBe(1);
      expect((await enforceCap('synthetic')).skipped).toMatch(/not applied/);

      // applyTo='synthetic' → only synthetic is capped
      config.keywordSearch.cleanup.applyTo = 'synthetic';
      col = makeCol({ counts: { user: 999999, synthetic: 100001 }, oldest: { synthetic: ['s1'] } });
      installMongo(col);
      expect((await enforceCap('user')).skipped).toMatch(/not applied/);
      expect((await enforceCap('synthetic')).deleted).toBe(1);
    } finally { config.keywordSearch.cleanup.applyTo = saved; }
  });
});

// ── auto-deletion is triggered ON INSERT (not a cron) ──────────────────────────
describe("cleanup runs on insert only when a new doc was added", () => {
  it("synthetic insert over cap → trims synthetic (deleteMany invoked, reported in response)", async () => {
    const col = makeCol({ counts: { synthetic: 100002 }, oldest: { synthetic: ["o1", "o2"] } });
    installMongo(col);
    const res = mockRes();
    await insertSyntheticKeywords({ body: { keywords: ["fresh1", "fresh2"], network: "facebook" } }, res);
    expect(res.body.data.cleanup).toMatchObject({ category: "synthetic", deleted: 2 });
    expect(col.calls.deleteMany.length).toBe(1);
  });

  it("synthetic insert with only duplicates (inserted 0) → cap not run, but cleanup STILL present (A1)", async () => {
    const col = makeCol({ existing: new Set(["dup"]), counts: { synthetic: 100002 } });
    installMongo(col);
    const res = mockRes();
    await insertSyntheticKeywords({ body: { keywords: ["dup"], network: "facebook" } }, res);
    expect(res.body.data.inserted).toBe(0);
    expect(col.calls.countDocuments.length).toBe(0); // enforceCap (cap query) never entered — no new docs
    // A1 regression: cleanup must survive JSON serialization even when nothing was inserted
    // (a bare `let cleanup;` would be undefined → JSON.stringify drops the key).
    const serialized = JSON.parse(JSON.stringify(res.body.data));
    expect(serialized).toHaveProperty("cleanup");
    expect(serialized.cleanup).toMatchObject({ deleted: 0 });
  });

  it("store new keyword → enforces the USER cap; repeat search → does not", async () => {
    // new doc (not in `existing`) → upsertedCount 1 → enforceCap('user') runs
    const colNew = makeCol({ counts: { user: 1 } });
    installMongo(colNew);
    await storeKeywordSearch({ body: { value: "BrandNew", type: 1, network: "facebook" }, user: { id: 1, email: "a@b.c" } }, mockRes());
    expect(colNew.calls.countDocuments.length).toBe(1);
    expect(colNew.calls.countDocuments[0]).toEqual({ $or: [{ users: { $ne: null } }, { userInfos: { $ne: null } }] });

    // existing doc → upsertedCount 0 → no enforcement
    const colExisting = makeCol({ existing: new Set(["brandnew"]) });
    installMongo(colExisting);
    await storeKeywordSearch({ body: { value: "BrandNew", type: 1, network: "facebook" }, user: { id: 1, email: "a@b.c" } }, mockRes());
    expect(colExisting.calls.countDocuments.length).toBe(0);
  });
});

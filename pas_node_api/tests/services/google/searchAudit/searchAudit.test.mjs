import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);

const dbManager = require("../../../../src/database/DatabaseManager");
const repo = require("../../../../src/services/google/searchAudit/repository");
const { getSearchAuditKeywords } = require("../../../../src/services/google/searchAudit/service");
const { insertKeywords } = require("../../../../src/services/google/searchAudit/insertService");
const { runGoogleKeywordAudit } = require("../../../../src/jobs/googleKeywordAuditCron");
const { parseJsonKeywords, splitCsvLine, parseCsvFile } = require("../../../../src/services/google/searchAudit/parseInput");
const { syncGoogleKeyword } = require("../../../../src/services/google/searchAudit/userSearchHook");

const fakeLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

// ── minimal in-memory Mongo (only the ops the repository uses) ──────────────────
function matches(doc, filter) {
  for (const [k, v] of Object.entries(filter)) {
    const dv = doc[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if ("$gt" in v && !(dv > v.$gt)) return false;
      if ("$in" in v && !v.$in.some((x) => (Array.isArray(dv) ? dv.includes(x) : x === dv))) return false;
      if ("$ne" in v && dv === v.$ne) return false;
    } else if (Array.isArray(dv)) {
      if (!dv.includes(v)) return false;
    } else if (dv !== v) return false;
  }
  return true;
}
class FakeCol {
  constructor() { this.docs = []; this.seq = 0; }
  async createIndexes() { return []; }
  async findOne(filter) { return this.docs.find((d) => matches(d, filter)) || null; }
  async updateOne(filter, update, opts = {}) {
    let doc = this.docs.find((d) => matches(d, filter));
    if (doc) { Object.assign(doc, update.$set || {}); return { matchedCount: 1, upsertedCount: 0 }; }
    if (opts.upsert) { doc = { ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) }; if (doc._id === undefined) doc._id = ++this.seq; this.docs.push(doc); return { matchedCount: 0, upsertedCount: 1 }; }
    return { matchedCount: 0, upsertedCount: 0 };
  }
  async bulkWrite(ops) {
    let upsertedCount = 0;
    for (const op of ops) {
      const { filter, update, upsert } = op.updateOne;
      let doc = this.docs.find((d) => matches(d, filter));
      if (doc) { Object.assign(doc, update.$set || {}); }
      else if (upsert) { doc = { _id: ++this.seq, ...(update.$setOnInsert || {}), ...(update.$set || {}) }; this.docs.push(doc); upsertedCount++; }
    }
    return { upsertedCount };
  }
  async countDocuments(filter = {}) { return this.docs.filter((d) => matches(d, filter)).length; }
  find(filter = {}) {
    let res = this.docs.filter((d) => matches(d, filter));
    const cur = {
      sort(s) { const [[k, dir]] = Object.entries(s); res = res.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); return cur; },
      limit(n) { res = res.slice(0, n); return cur; },
      toArray: async () => res,
    };
    return cur;
  }
  async deleteMany(filter) { const before = this.docs.length; this.docs = this.docs.filter((d) => !matches(d, filter)); return { deletedCount: before - this.docs.length }; }
}
function installFakeMongo({ source = [] } = {}) {
  const cols = { google_audit_keywords: new FakeCol(), google_audit_meta: new FakeCol(), keyword_searches: new FakeCol() };
  cols.keyword_searches.docs = source.map((d, i) => ({ _id: i + 1, ...d }));
  const db = { collection: (name) => cols[name] };
  vi.spyOn(dbManager, "getMongo").mockReturnValue({ db, client: { db: () => db } });
  return cols;
}

beforeEach(() => { vi.restoreAllMocks(); fakeLogger.error.mockClear(); fakeLogger.info.mockClear(); });

// ── parseInput ───────────────────────────────────────────────────────────────
describe("searchAudit > parseInput", () => {
  it("splitCsvLine handles quotes, commas, and escaped quotes", () => {
    expect(splitCsvLine('cat, dog ,"a,b","he said ""hi"""')).toEqual(["cat", "dog", "a,b", 'he said "hi"']);
  });
  it("parseJsonKeywords accepts array of strings, {keywords:[]}, and array of objects", () => {
    expect(parseJsonKeywords(["a", "b"]).map((x) => x.keyword)).toEqual(["a", "b"]);
    expect(parseJsonKeywords({ keywords: ["c"] }).map((x) => x.keyword)).toEqual(["c"]);
    expect(parseJsonKeywords([{ keyword: "d", country: "US" }])[0]).toEqual({ keyword: "d", country: "US", user_id: null });
  });
  it("parseCsvFile reads one keyword per line and honors a header row", async () => {
    const tmp = path.join(os.tmpdir(), `gka_${Date.now()}.csv`);
    fs.writeFileSync(tmp, "keyword,country\nCat,US\ndog,IN\n\n");
    const items = await parseCsvFile(tmp);
    fs.unlinkSync(tmp);
    expect(items).toEqual([{ keyword: "Cat", country: "US", user_id: null }, { keyword: "dog", country: "IN", user_id: null }]);
  });
});

// ── dedupe (case-insensitive) ──────────────────────────────────────────────────
describe("searchAudit > bulkUpsertKeywords dedupe", () => {
  it("treats 'cat' and 'Cat' as the same keyword and stores one copy", async () => {
    const cols = installFakeMongo();
    const r = await repo.bulkUpsertKeywords([{ keyword: "cat" }, { keyword: "Cat" }, { keyword: " CAT " }, { keyword: "dog" }], "upload");
    expect(r.received).toBe(4);
    expect(r.unique).toBe(2);          // cat, dog
    expect(r.inserted).toBe(2);
    expect(cols.google_audit_keywords.docs.map((d) => d.keywordNorm).sort()).toEqual(["cat", "dog"]);
  });
  it("re-inserting an existing keyword is a no-op (alreadyPresent)", async () => {
    installFakeMongo();
    await repo.bulkUpsertKeywords([{ keyword: "cat" }], "upload");
    const r = await repo.bulkUpsertKeywords([{ keyword: "CAT" }, { keyword: "new" }], "upload");
    expect(r.inserted).toBe(1);        // only "new"
    expect(r.alreadyPresent).toBe(1);  // "CAT" already there
  });
});

// ── 100k cap ────────────────────────────────────────────────────────────────────
describe("searchAudit > enforceCap", () => {
  it("deletes the oldest rows (lowest _id) beyond maxCount", async () => {
    const cols = installFakeMongo();
    for (let i = 0; i < 10; i++) cols.google_audit_keywords.docs.push({ _id: i + 1, keywordNorm: `k${i}` });
    cols.google_audit_keywords.seq = 10;
    const res = await repo.enforceCap(6);
    expect(res.deleted).toBe(4);
    expect(res.total).toBe(6);
    expect(cols.google_audit_keywords.docs.map((d) => d._id)).toEqual([5, 6, 7, 8, 9, 10]); // oldest 1-4 gone
  });
  it("no-op when under the cap", async () => {
    const cols = installFakeMongo();
    cols.google_audit_keywords.docs.push({ _id: 1, keywordNorm: "a" });
    expect(await repo.enforceCap(100000)).toEqual({ total: 1, deleted: 0 });
  });
});

// ── GET crawl cursor ─────────────────────────────────────────────────────────────
describe("searchAudit > GET getSearchAuditKeywords", () => {
  function seedCrawlable(cols, n) {
    for (let i = 0; i < n; i++) cols.google_audit_keywords.docs.push({ _id: i + 1, keyword: `kw${i}`, keywordNorm: `kw${i}`, status: 0, country: null, user_id: null, process_date: null, hit_count: 0 });
    cols.google_audit_keywords.seq = n;
  }
  it("returns the legacy row shape and advances the cursor across calls", async () => {
    const cols = installFakeMongo();
    seedCrawlable(cols, 12);
    const r1 = await getSearchAuditKeywords({}, {}, fakeLogger);
    expect(r1.code).toBe(200);
    expect(r1.data).toHaveLength(5);
    expect(Object.keys(r1.data[0]).sort()).toEqual(["country", "hit_count", "id", "keyword", "process_date", "status", "user_id"]);
    expect(r1.data.map((d) => d.id)).toEqual(["1", "2", "3", "4", "5"]);
    const r2 = await getSearchAuditKeywords({}, {}, fakeLogger);
    expect(r2.data.map((d) => d.id)).toEqual(["6", "7", "8", "9", "10"]);
  });
  it("loops back to the start when the cursor reaches the end", async () => {
    const cols = installFakeMongo();
    seedCrawlable(cols, 3);
    await repo.writeCursor("crawl", 3); // pretend we already handed out everything
    const r = await getSearchAuditKeywords({}, {}, fakeLogger);
    expect(r.code).toBe(200);
    expect(r.data.map((d) => d.id)).toEqual(["1", "2", "3"]);
  });
  it("404 when there are no crawlable keywords", async () => {
    installFakeMongo();
    const r = await getSearchAuditKeywords({}, {}, fakeLogger);
    expect(r).toEqual({ code: 404, message: "No Keywords Found" });
  });
  it("only returns crawlable statuses (0/2), not others", async () => {
    const cols = installFakeMongo();
    cols.google_audit_keywords.docs.push({ _id: 1, keyword: "done", keywordNorm: "done", status: 1 });
    cols.google_audit_keywords.docs.push({ _id: 2, keyword: "todo", keywordNorm: "todo", status: 2 });
    const r = await getSearchAuditKeywords({}, {}, fakeLogger);
    expect(r.data.map((d) => d.keyword)).toEqual(["todo"]);
  });
});

// ── POST insert ──────────────────────────────────────────────────────────────────
describe("searchAudit > POST insertKeywords", () => {
  it("inserts JSON keywords, dedupes, and enforces the cap", async () => {
    const cols = installFakeMongo();
    const out = await insertKeywords({ body: { keywords: ["cat", "Cat", "dog"] } }, {}, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data.received).toBe(3);
    expect(out.data.inserted).toBe(2);
    expect(out.data.duplicatesIgnored).toBe(1);
    expect(cols.google_audit_keywords.docs.map((d) => d.keywordNorm).sort()).toEqual(["cat", "dog"]);
  });
  it("inserts from a CSV file and unlinks the temp file", async () => {
    installFakeMongo();
    const tmp = path.join(os.tmpdir(), `gka_post_${Date.now()}.csv`);
    fs.writeFileSync(tmp, "Apple\nbanana\nAPPLE\n");
    const out = await insertKeywords({ file: { path: tmp } }, {}, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data.inserted).toBe(2); // apple, banana
    expect(fs.existsSync(tmp)).toBe(false); // cleaned up
  });
  it("400 when no keywords are supplied", async () => {
    installFakeMongo();
    const out = await insertKeywords({ body: {} }, {}, fakeLogger);
    expect(out.code).toBe(400);
  });
});

// ── import from keyword_searches (google only) ─────────────────────────────────
describe("searchAudit > importGoogleUserSearches + cron", () => {
  it("imports only google keyword(type=1) terms, deduped against existing", async () => {
    const cols = installFakeMongo({
      source: [
        { type: 1, networks: ["google", "facebook"], value: "Shoes", valueNorm: "shoes" },
        { type: 1, networks: ["facebook"], value: "NotGoogle", valueNorm: "notgoogle" }, // wrong network
        { type: 2, networks: ["google"], value: "AdvertiserX", valueNorm: "advertiserx" }, // wrong type
        { type: 1, networks: ["google"], value: "shoes", valueNorm: "shoes" }, // dupe of #1 (case)
      ],
    });
    const r = await repo.importGoogleUserSearches();
    expect(r.inserted).toBe(1); // only "Shoes"
    expect(cols.google_audit_keywords.docs.map((d) => d.keywordNorm)).toEqual(["shoes"]);
    expect(cols.google_audit_keywords.docs[0].source).toBe("user_search");
  });
  it("cron runs import then cap enforcement and returns a summary", async () => {
    installFakeMongo({ source: [{ type: 1, networks: ["google"], value: "cron-kw", valueNorm: "cron-kw" }] });
    const summary = await runGoogleKeywordAudit();
    expect(summary.imported).toBe(1);
    expect(summary.total).toBe(1);
    expect(summary.deletedOverCap).toBe(0);
  });
});

// ── synchronous dual-write hook ──────────────────────────────────────────────
describe("searchAudit > syncGoogleKeyword (dual-write)", () => {
  it("upserts a google keyword search into the audit collection", async () => {
    const cols = installFakeMongo();
    const r = await syncGoogleKeyword({ value: "Nike", type: 1, networks: ["google", "facebook"] }, fakeLogger);
    expect(r).toEqual({ synced: true, inserted: 1 });
    expect(cols.google_audit_keywords.docs.map((d) => d.keywordNorm)).toEqual(["nike"]);
    expect(cols.google_audit_keywords.docs[0].source).toBe("user_search");
  });
  it("dedupes case-insensitively against an existing row (no second copy)", async () => {
    const cols = installFakeMongo();
    await syncGoogleKeyword({ value: "Nike", type: 1, networks: ["google"] }, fakeLogger);
    const r = await syncGoogleKeyword({ value: "nike", type: 1, networks: ["google"] }, fakeLogger);
    expect(r.inserted).toBe(0);
    expect(cols.google_audit_keywords.docs).toHaveLength(1);
  });
  it("skips non-google networks", async () => {
    const cols = installFakeMongo();
    const r = await syncGoogleKeyword({ value: "Nike", type: 1, networks: ["facebook", "instagram"] }, fakeLogger);
    expect(r).toEqual({ synced: false });
    expect(cols.google_audit_keywords.docs).toHaveLength(0);
  });
  it("skips non-keyword types (advertiser/domain)", async () => {
    const cols = installFakeMongo();
    await syncGoogleKeyword({ value: "Adidas", type: 2, networks: ["google"] }, fakeLogger);
    expect(cols.google_audit_keywords.docs).toHaveLength(0);
  });
  it("is non-fatal when the upsert throws", async () => {
    installFakeMongo();
    vi.spyOn(repo, "bulkUpsertKeywords").mockRejectedValue(new Error("mongo-down"));
    const r = await syncGoogleKeyword({ value: "Nike", type: 1, networks: ["google"] }, fakeLogger);
    expect(r).toEqual({ synced: false });
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

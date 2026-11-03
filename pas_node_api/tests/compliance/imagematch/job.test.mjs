import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import http from "node:http";
const require = createRequire(import.meta.url);

const { HashJob, STATUS } = require("../../../src/compliance/imagematch/job");
const { sourceFor } = require("../../../src/compliance/imagematch/sources");
const { OUTCOME } = require("../../../src/compliance/imagematch/client");

const V = "sscd-simhash-v1";
const CDN = "https://media.example.test/pas-dev/stream";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const silent = { info() {}, warn() {}, error() {} };
const noSleep = () => Promise.resolve();

// ── a tiny in-memory ad database that answers the job's queries ──────────────────────────────
function makeDb({ owners, ads, variants, carousel = [] }) {
  const calls = [];
  const sql = {
    calls,
    async query(text, params) {
      const t = text.replace(/\s+/g, " ");
      calls.push({ text: t, params });
      if (/FROM `facebook_ad_post_owners`/.test(t)) {
        const rows = /`post_owner_lower` IN/.test(t)
          ? owners.filter((o) => params.includes(o.name.toLowerCase()))
          : owners.filter((o) => params.includes(o.id));
        return rows.map((o) => ({ id: o.id, name: o.name, ads_count: o.ads_count }));
      }
      if (/FROM `facebook_ad` WHERE `id` IN/.test(t)) return params.map((id) => ({ id, platform_id: `P${id}` }));
      if (/FROM `facebook_ad` /.test(t)) {
        const [ownerId, after] = params;
        const limit = Number(/LIMIT (\d+)$/.exec(t)[1]);
        return ads.filter((a) => a.owner === ownerId && a.id > after).sort((a, b) => a.id - b.id).slice(0, limit).map((a) => ({ id: a.id }));
      }
      if (/FROM `facebook_ad_variants`/.test(t)) return variants.filter((v) => params.includes(v.ad_id));
      if (/FROM `facebook_ad_image_video`/.test(t)) return carousel.filter((v) => params.includes(v.ad_id));
      throw new Error(`unexpected query: ${t}`);
    },
  };
  return sql;
}

/** 25 ads of owner 1 (ids 1..25), one stored image each; ad 3 has a default image, ad 4 none. */
function standardDb(over = {}) {
  const ads = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, owner: 1 }));
  const variants = ads.map((a) => ({
    ad_id: a.id,
    image_url: a.id === 3 ? "fb/adImage/DefaultImage.jpg" : a.id === 4 ? null : `fb/adImage/202610/${a.id}.jpeg`,
    image_url_original: `https://platform.example/${a.id}.jpg`,
  }));
  return makeDb({
    owners: [{ id: 1, name: "Twinkling Tree", ads_count: 25 }, { id: 2, name: "Other Brand", ads_count: 0 }],
    ads, variants, ...over,
  });
}

const okResult = (url) => ({ ok: true, outcome: OUTCOME.OK, sscdHash: sha(`p${url}`), words: new Uint32Array(8), sha256: sha(url) });

function makeClient(handler = (url) => okResult(url), over = {}) {
  return {
    isConfigured: () => true,
    health: async () => ({ ok: true, ready: true, hashVersion: V, hashBits: 256 }),
    hashUrl: vi.fn(async (url) => handler(url)),
    ...over,
  };
}

function makeBlocklist() {
  const bySha = new Map();
  const adds = [];
  return {
    bySha, adds,
    add: vi.fn(async (entries) => {
      adds.push(entries);
      for (const e of entries) bySha.set(e.imageSha256, e);
      return { rejected: [], results: [{ network: "facebook", ok: true, count: entries.length, entries: [] }] };
    }),
  };
}

function makeCheckpoint() {
  const store = new Map();
  return {
    store,
    load: vi.fn(async (id) => (store.has(id) ? JSON.parse(store.get(id)) : null)),
    save: vi.fn(async (id, state) => { store.set(id, JSON.stringify(state)); }),
  };
}

function makeJob(over = {}) {
  const sql = over.sql || standardDb();
  const client = over.client || makeClient();
  const blocklist = over.blocklist || makeBlocklist();
  const checkpoint = over.checkpoint || makeCheckpoint();
  const sleep = over.sleep || vi.fn(noSleep);
  const job = new HashJob({
    network: "facebook", source: sourceFor("facebook"), sql, client, blocklist, cdnBase: CDN, hashVersion: V,
    config: { pageSize: 10, pageDelayMs: 50, maxImages: 1000, ...over.config }, checkpoint, log: silent, sleep,
  });
  return { job, sql, client, blocklist, checkpoint, sleep };
}

const APPLY = { names: ["Twinkling Tree"], apply: true, jobId: "j1", addedBy: "tester", reason: "test", complaintId: "11111111-1111-1111-1111-111111111111" };

describe("imagematch/job > dry run", () => {
  it("finds the advertiser and shows a sample, with no hashing, no write and no checkpoint", async () => {
    const { job, client, blocklist, checkpoint } = makeJob();
    const out = await job.run({ names: ["Twinkling Tree"] });
    expect(out.status).toBe(STATUS.DRY_RUN);
    expect(out.owners).toEqual([{ id: 1, name: "Twinkling Tree", adsCount: 25 }]);
    expect(out.sample[0]).toMatchObject({ ownerId: 1, adsInSample: 20 });
    expect(out.sample[0].images[0]).toEqual({ adId: 1, stored: "fb/adImage/202610/1.jpeg", url: `${CDN}/fb/adImage/202610/1.jpeg` });
    expect(out.sample[0].skipped).toEqual({ "no stored image": 2 });
    expect(client.hashUrl).not.toHaveBeenCalled();
    expect(blocklist.add).not.toHaveBeenCalled();
    expect(checkpoint.save).not.toHaveBeenCalled();
  });

  it("finds an advertiser written another way, and by owner id", async () => {
    const byName = await makeJob().job.run({ names: ["twinkling-tree"] });
    expect(byName.owners.map((o) => o.id)).toEqual([1]);
    for (const written of ["TwinklingTree", "Twinkling_Tree", "Twinkling.Tree"]) {
      expect((await makeJob().job.run({ names: [written] })).owners.map((o) => o.id)).toEqual([1]);
    }
    // all lowercase and run together there is no word boundary to find: it needs the owner id or the exact stored spelling
    expect((await makeJob().job.run({ names: ["twinklingtree"] })).status).toBe(STATUS.NO_OWNER);
    const spaced = await makeJob().job.run({ names: ["TWINKLING   TREE"] });
    expect(spaced.owners.map((o) => o.id)).toEqual([1]);
    const byId = await makeJob().job.run({ ownerIds: [2] });
    expect(byId.owners.map((o) => o.name)).toEqual(["Other Brand"]);
    const both = await makeJob().job.run({ names: ["Twinkling Tree"], ownerIds: [1, 2] });
    expect(both.owners.map((o) => o.id).sort()).toEqual([1, 2]); // owner 1 once, not twice
  });

  it("reports an advertiser that does not exist, with the spellings it tried", async () => {
    const out = await makeJob().job.run({ names: ["No Such Brand"] });
    expect(out).toMatchObject({ status: STATUS.NO_OWNER });
    expect(out.triedNames).toContain("nosuchbrand");
  });

  it("refuses a call with neither a name nor an owner id", async () => {
    expect((await makeJob().job.run({})).status).toBe(STATUS.INVALID_INPUT);
  });

  it("refuses a name that matches more owners than allowed", async () => {
    const owners = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Brand ${i}`, ads_count: 1 }));
    const sql = makeDb({ owners, ads: [], variants: [] });
    const { job } = makeJob({ sql, config: { maxOwners: 3 } });
    const out = await job.run({ ownerIds: [1, 2, 3, 4, 5] });
    expect(out.status).toBe(STATUS.TOO_MANY_OWNERS);
  });
});

describe("imagematch/job > what must be true before anything is written", () => {
  it("needs addedBy and a job id", async () => {
    const { job, client } = makeJob();
    expect((await job.run({ ...APPLY, addedBy: "  " })).status).toBe(STATUS.INVALID_INPUT);
    expect((await job.run({ ...APPLY, jobId: undefined })).status).toBe(STATUS.INVALID_INPUT);
    expect(client.hashUrl).not.toHaveBeenCalled();
  });

  it("stops when the service has no address or key, is not ready, or makes another hash version", async () => {
    for (const [client, status] of [
      [makeClient(undefined, { isConfigured: () => false }), STATUS.NOT_CONFIGURED],
      [makeClient(undefined, { health: async () => ({ ok: false, ready: false, hashVersion: null }) }), STATUS.SERVICE_NOT_READY],
      [makeClient(undefined, { health: async () => ({ ok: true, ready: false, hashVersion: V }) }), STATUS.SERVICE_NOT_READY],
      [makeClient(undefined, { health: async () => ({ ok: true, ready: true, hashVersion: "sscd-simhash-v2" }) }), STATUS.HASH_VERSION_MISMATCH],
    ]) {
      const { job, blocklist } = makeJob({ client });
      expect((await job.run(APPLY)).status).toBe(status);
      expect(client.hashUrl).not.toHaveBeenCalled();
      expect(blocklist.add).not.toHaveBeenCalled();
    }
  });

  it("will not overwrite a job that already exists, and cannot resume one that does not", async () => {
    const t = makeJob();
    expect((await t.job.run(APPLY)).status).toBe(STATUS.DONE);
    expect((await t.job.run(APPLY)).status).toBe(STATUS.JOB_EXISTS);
    expect((await makeJob().job.run({ ...APPLY, resume: true })).status).toBe(STATUS.NO_CHECKPOINT);
  });
});

describe("imagematch/job > a full run", () => {
  it("reads the ads in pages, hashes each stored image once and writes one entry per distinct image", async () => {
    const { job, sql, client, blocklist, sleep } = makeJob();
    const out = await job.run(APPLY);
    expect(out.status).toBe(STATUS.DONE);

    // 25 ads, 2 without a usable image -> 23 images
    expect(out.stats).toMatchObject({ ads: 25, imagesFound: 23, requested: 23, hashed: 23, added: 23, failed: 0, duplicates: 0, rejectedByAdd: 0 });
    expect(out.stats.skipped).toEqual({ "no stored image": 2 });
    expect(client.hashUrl).toHaveBeenCalledTimes(23);
    expect(client.hashUrl).toHaveBeenCalledWith(`${CDN}/fb/adImage/202610/1.jpeg`);
    expect(client.hashUrl).not.toHaveBeenCalledWith(expect.stringContaining("DefaultImage"));
    expect(blocklist.bySha.size).toBe(23);

    // 3 pages of ads (10, 10, 5): the third is short, so there is no fourth query
    const pageQueries = sql.calls.filter((c) => /FROM `facebook_ad` WHERE `post_owner_id`/.test(c.text));
    // one lookup of the platform ad ids per page, by primary key
    expect(sql.calls.filter((c) => /FROM `facebook_ad` WHERE `id` IN/.test(c.text))).toHaveLength(3);
    expect(pageQueries.map((c) => c.params[1])).toEqual([0, 10, 20]);
    // a pause between pages, not after the last
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("writes entries with the hashes, the hash version, who added them and where each image came from", async () => {
    const { job, blocklist } = makeJob();
    await job.run(APPLY);
    const url = `${CDN}/fb/adImage/202610/1.jpeg`;
    const entry = blocklist.bySha.get(sha(url));
    expect(entry).toMatchObject({
      entryType: "image_hash", imageSha256: sha(url), imagePhash: sha(`p${url}`), imagePhashAlgo: V, network: "facebook",
      addedBy: "tester", reason: "test", complaintId: "11111111-1111-1111-1111-111111111111", source: "imagematch:job",
    });
    expect(JSON.parse(entry.details)).toEqual({ job: "j1", owner_id: 1, ad_id: "P1", internal_ad_id: 1, image_url: "fb/adImage/202610/1.jpeg" });
    expect(entry.details.length).toBeLessThan(500);
  });

  it("only reads the ad tables: every query is a SELECT with an index lookup and a bound", async () => {
    const { job, sql } = makeJob();
    await job.run(APPLY);
    for (const { text } of sql.calls) {
      expect(text).toMatch(/^SELECT /);
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b|OFFSET|LIKE|SELECT \*/i);
      expect(text).toMatch(/LIMIT \d+|IN \(/);
    }
  });

  it("hashes one image once even when many ads share it, and writes one entry for identical images", async () => {
    const ads = [1, 2, 3, 4].map((id) => ({ id, owner: 1 }));
    const variants = [
      { ad_id: 1, image_url: "fb/a/same.jpeg", image_url_original: "" },
      { ad_id: 2, image_url: "fb/a/same.jpeg", image_url_original: "" },        // same stored file
      { ad_id: 3, image_url: "fb/a/copy.jpeg", image_url_original: "" },        // another file with identical bytes
      { ad_id: 4, image_url: "fb/a/other.jpeg", image_url_original: "" },
    ];
    const sql = makeDb({ owners: [{ id: 1, name: "Twinkling Tree", ads_count: 4 }], ads, variants });
    const client = makeClient((url) => (url.endsWith("copy.jpeg") ? okResult(`${CDN}/fb/a/same.jpeg`) : okResult(url)));
    const { job, blocklist } = makeJob({ sql, client });
    const out = await job.run(APPLY);
    expect(client.hashUrl).toHaveBeenCalledTimes(3);       // the shared URL once
    expect(blocklist.bySha.size).toBe(2);                    // copy.jpeg has the same sha256 as same.jpeg
    expect(out.stats.duplicates).toBe(2);
    expect(out.stats.added).toBe(2);
  });

  it("does nothing, and writes nothing, for an advertiser with no ads", async () => {
    const { job, client, blocklist, checkpoint } = makeJob();
    const out = await job.run({ ...APPLY, names: [], ownerIds: [2] });
    expect(out.status).toBe(STATUS.DONE);
    expect(client.hashUrl).not.toHaveBeenCalled();
    expect(blocklist.add).not.toHaveBeenCalled();
    expect(JSON.parse(checkpoint.store.get("j1")).owners["2"].done).toBe(true);
  });

  it("includes the carousel images only when asked", async () => {
    const carousel = [{ ad_id: 1, image_url: "fb/c/extra.jpeg", image_url_original: null }];
    const off = makeJob({ sql: standardDb({ carousel }) });
    await off.job.run(APPLY);
    expect(off.client.hashUrl).not.toHaveBeenCalledWith(`${CDN}/fb/c/extra.jpeg`);
    expect(off.sql.calls.some((c) => /facebook_ad_image_video/.test(c.text))).toBe(false);

    const on = makeJob({ sql: standardDb({ carousel }), config: { includeCarousel: true } });
    await on.job.run(APPLY);
    expect(on.client.hashUrl).toHaveBeenCalledWith(`${CDN}/fb/c/extra.jpeg`);
  });

  it("writes in batches of the configured size", async () => {
    const { job, blocklist } = makeJob({ config: { addBatchSize: 7 } });
    await job.run(APPLY);
    expect(blocklist.adds.every((batch) => batch.length <= 7)).toBe(true);
    expect(blocklist.bySha.size).toBe(23);
  });
});

describe("imagematch/job > images the service cannot or will not hash", () => {
  it("counts an image it cannot hash and carries on", async () => {
    const client = makeClient((url) => (url.endsWith("/5.jpeg")
      ? { ok: false, outcome: OUTCOME.SKIP, status: 422, reason: "Image is smaller than 32x32" }
      : okResult(url)));
    const { job } = makeJob({ client });
    const out = await job.run(APPLY);
    expect(out.status).toBe(STATUS.DONE);
    expect(out.stats.skipped["image is smaller than 32x32"]).toBe(1);
    expect(out.stats.hashed).toBe(22);
    expect(out.stats.failed).toBe(0);
  });

  it("stops at once when the key is refused, and does not move past that page", async () => {
    const client = makeClient((url) => (url.endsWith("/5.jpeg") ? { ok: false, outcome: OUTCOME.UNAUTHORIZED, status: 401, reason: "the API key was refused" } : okResult(url)));
    const { job, checkpoint } = makeJob({ client });
    const out = await job.run(APPLY);
    expect(out.status).toBe(STATUS.UNAUTHORIZED);
    expect(JSON.parse(checkpoint.store.get("j1")).owners["1"].lastAdId).toBe(0);
  });

  it("stops after too many failures in a row, but a success or a skip in between starts the count again", async () => {
    const down = { ok: false, outcome: OUTCOME.UNAVAILABLE, status: 503, reason: "service returned 503" };
    const allDown = makeJob({ client: makeClient(() => down), config: { maxConsecutiveFailures: 5 } });
    const out = await allDown.job.run(APPLY);
    expect(out.status).toBe(STATUS.SERVICE_UNAVAILABLE);
    expect(out.stats.failed).toBeGreaterThanOrEqual(5);
    expect(allDown.blocklist.add).not.toHaveBeenCalled();

    // every 3rd image fails: never 4 in a row, so it finishes
    let n = 0;
    const flaky = makeJob({ client: makeClient((url) => (++n % 3 === 0 ? down : okResult(url))), config: { maxConsecutiveFailures: 4 } });
    const done = await flaky.job.run(APPLY);
    expect(done.status).toBe(STATUS.DONE);
    expect(done.stats.failed).toBeGreaterThan(0);
    expect(done.stats.hashed + done.stats.failed).toBe(23);
  });

  it("writes the images it did hash before it stops", async () => {
    let n = 0;
    const down = { ok: false, outcome: OUTCOME.UNAVAILABLE, status: 503, reason: "x" };
    const client = makeClient((url) => (++n <= 4 ? okResult(url) : down));
    const { job, blocklist } = makeJob({ client, config: { maxConsecutiveFailures: 3 } });
    const out = await job.run(APPLY);
    expect(out.status).toBe(STATUS.SERVICE_UNAVAILABLE);
    expect(blocklist.bySha.size).toBe(4);
  });
});

describe("imagematch/job > when the blocklist cannot be written", () => {
  it("stops and does not move past the page if the write throws", async () => {
    const blocklist = { add: vi.fn(async () => { throw new Error("blocklist is not initialised"); }) };
    const { job, checkpoint } = makeJob({ blocklist });
    const out = await job.run(APPLY);
    expect(out.status).toBe(STATUS.DATABASE_WRITE_FAILED);
    expect(JSON.parse(checkpoint.store.get("j1")).owners["1"].lastAdId).toBe(0);
  });

  it("stops if the database reports the write failed", async () => {
    const blocklist = { add: vi.fn(async () => ({ rejected: [], results: [{ network: "facebook", ok: false, count: 5, error: "Table doesn't exist", entries: [] }] })) };
    const out = await makeJob({ blocklist }).job.run(APPLY);
    expect(out.status).toBe(STATUS.DATABASE_WRITE_FAILED);
  });

  it("counts entries the blocklist refuses, without stopping", async () => {
    const blocklist = { add: vi.fn(async (entries) => ({ rejected: [{ entry: entries[0], reason: "bad" }], results: [{ network: "facebook", ok: true, count: entries.length - 1, entries: [] }] })) };
    const out = await makeJob({ blocklist }).job.run(APPLY);
    expect(out.status).toBe(STATUS.DONE);
    expect(out.stats.rejectedByAdd).toBeGreaterThan(0);
  });
});

describe("imagematch/job > the image cap, stopping and resuming", () => {
  it("stops at the cap, repeats the unfinished page on resume, and ends with every image written exactly once", async () => {
    const shared = { sql: standardDb(), blocklist: makeBlocklist(), checkpoint: makeCheckpoint() };

    const first = makeJob({ ...shared, config: { maxImages: 12 } });
    const a = await first.job.run(APPLY);
    expect(a.status).toBe(STATUS.LIMIT_REACHED);
    expect(a.stats.requested).toBe(12);
    const saved = JSON.parse(shared.checkpoint.store.get("j1"));
    expect(saved.status).toBe(STATUS.LIMIT_REACHED);
    expect(saved.owners["1"].lastAdId).toBe(10); // page 1 finished; page 2 was cut and will be repeated

    const second = makeJob({ ...shared, config: { maxImages: 1000 } });
    const b = await second.job.run({ ...APPLY, resume: true });
    expect(b.status).toBe(STATUS.DONE);
    expect(shared.blocklist.bySha.size).toBe(23);               // every image, once
    const firstCalls = first.client.hashUrl.mock.calls.length;
    expect(second.client.hashUrl.mock.calls.length).toBeLessThanOrEqual(23 - 8);   // page 1 (8 images) is not hashed again
    expect(firstCalls + second.client.hashUrl.mock.calls.length).toBeGreaterThanOrEqual(23);
    // the cap counts across the whole job
    expect(b.stats.requested).toBeGreaterThanOrEqual(23);
  });

  it("stops after the current page when asked, saves its place, and resumes from there", async () => {
    const shared = { sql: standardDb(), blocklist: makeBlocklist(), checkpoint: makeCheckpoint() };
    const first = makeJob({ ...shared });
    first.sleep.mockImplementation(async () => { first.job.requestStop(); });   // stop during the first pause
    const a = await first.job.run(APPLY);
    expect(a.status).toBe(STATUS.STOPPED);
    expect(JSON.parse(shared.checkpoint.store.get("j1")).owners["1"].lastAdId).toBe(10);

    const before = shared.sql.calls.length; // the fake database is shared, so look only at what the resumed run asked
    const second = makeJob({ ...shared });
    const b = await second.job.run({ ...APPLY, resume: true });
    expect(b.status).toBe(STATUS.DONE);
    expect(shared.blocklist.bySha.size).toBe(23);
    const queries = shared.sql.calls.slice(before).filter((c) => /FROM `facebook_ad` /.test(c.text)).map((c) => c.params[1]);
    expect(queries[0]).toBe(10); // resumed after the last finished page, not from the start
  });

  it("a finished owner is not read again on resume", async () => {
    const shared = { sql: standardDb(), blocklist: makeBlocklist(), checkpoint: makeCheckpoint() };
    await makeJob({ ...shared }).job.run(APPLY);
    const before = shared.sql.calls.length;
    const again = makeJob({ ...shared });
    const out = await again.job.run({ ...APPLY, resume: true });
    expect(out.status).toBe(STATUS.DONE);
    expect(again.client.hashUrl).not.toHaveBeenCalled();
    expect(shared.sql.calls.slice(before).filter((c) => /FROM `facebook_ad` /.test(c.text))).toHaveLength(0);
  });
});

describe("imagematch/job > with the real blocklist service", () => {
  it("the entries it builds are accepted by BlocklistService.add() and reach the database layer as image_hash rows", async () => {
    const { BlocklistService } = require("../../../src/compliance/blocklist/service");
    const repository = {
      upsertEntries: vi.fn(async (_sql, rows) => ({ affected: rows.length })),
      findIds: vi.fn(async () => new Map()),
    };
    const blocklist = new BlocklistService({ config: { enabled: false, networks: ["facebook"] }, repository, getSql: () => ({}), log: silent });
    const { job } = makeJob({ blocklist });
    const out = await job.run(APPLY);

    expect(out.status).toBe(STATUS.DONE);
    expect(out.stats).toMatchObject({ added: 23, rejectedByAdd: 0 });
    const rows = repository.upsertEntries.mock.calls.flatMap((c) => c[1]);
    expect(rows).toHaveLength(23);
    const url = `${CDN}/fb/adImage/202610/1.jpeg`;
    expect(rows.find((r) => r.image_sha256 === sha(url))).toMatchObject({
      network: "facebook", entry_type: "image_hash", value: sha(url), image_phash: sha(`p${url}`), image_phash_algo: V,
      added_by: "tester", reason: "test", source: "imagematch:job", complaint_id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("a hash the blocklist would refuse is counted, not fatal (here: a wrong-length perceptual hash)", async () => {
    const { BlocklistService } = require("../../../src/compliance/blocklist/service");
    const repository = { upsertEntries: vi.fn(async (_s, rows) => ({ affected: rows.length })), findIds: vi.fn(async () => new Map()) };
    const blocklist = new BlocklistService({ config: { enabled: false, networks: ["facebook"] }, repository, getSql: () => ({}), log: silent });
    const client = makeClient((url) => (url.endsWith("/7.jpeg") ? { ...okResult(url), sscdHash: "abc" } : okResult(url)));
    const out = await makeJob({ blocklist, client }).job.run(APPLY);
    expect(out.status).toBe(STATUS.DONE);
    expect(out.stats.rejectedByAdd).toBe(1);
    expect(out.stats.added).toBe(22);
  });
});

describe("imagematch/job > pace", () => {
  it("does not pause when the delay is 0, and never calls the service more than the cap allows", async () => {
    const { job, sleep, client } = makeJob({ config: { pageDelayMs: 0, maxImages: 5 } });
    const out = await job.run(APPLY);
    expect(out.status).toBe(STATUS.LIMIT_REACHED);
    expect(sleep).not.toHaveBeenCalled();
    expect(client.hashUrl).toHaveBeenCalledTimes(5);
  });
});

describe("imagematch job helpers (names, tables, queries)", () => {
const { nameCandidates, MAX_CANDIDATES } = require("../../../src/compliance/imagematch/sources");
const { sourceFor, SOURCES } = require("../../../src/compliance/imagematch/sources");
const repo = require("../../../src/compliance/imagematch/sources");

const FB = sourceFor("facebook");

function fakeSql(rowsFor = () => []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
      return rowsFor(text, params);
    },
  };
}

describe("imagematch/names > nameCandidates", () => {
  it("gives the usual spellings of a name that has spaces", () => {
    expect(nameCandidates("Twinkling Tree").sort()).toEqual(
      ["twinkling tree", "twinklingtree", "twinkling-tree", "twinkling_tree", "twinkling.tree"].sort()
    );
  });

  it("keeps a one-word name as it is", () => {
    expect(nameCandidates("Nike")).toEqual(["nike"]);
  });

  it("finds the words of a name written with '-', '_', '.' or in CamelCase, so it also finds the spaced name", () => {
    for (const written of ["twinkling-tree", "Twinkling_Tree", "twinkling.tree", "TwinklingTree", "Twinkling  Tree"]) {
      expect(nameCandidates(written)).toContain("twinkling tree");
      expect(nameCandidates(written)).toContain("twinklingtree");
    }
  });

  it("cannot split a name run together in lowercase: it stays as it is", () => {
    expect(nameCandidates("twinklingtree")).toEqual(["twinklingtree"]);
  });

  it("does not turn a one-word CamelCase brand into nonsense", () => {
    const out = nameCandidates("McDonald");
    expect(out).toContain("mcdonald");
    expect(out).toContain("mc donald");
  });

  it("normalizes case, spaces and Unicode, and joins every word of a long name", () => {
    expect(nameCandidates("  TWINKLING   Tree  ")).toContain("twinklingtree");
    expect(nameCandidates("Blue Moon Shop")).toContain("blue-moon-shop");
    expect(nameCandidates("ＮＩＫＥ")).toEqual(["nike"]); // full-width letters
  });

  it("takes several names, with no repeats", () => {
    const out = nameCandidates(["Twinkling Tree", "twinkling tree", "Twinkle Tree"]);
    expect(new Set(out).size).toBe(out.length);
    expect(out).toContain("twinkle tree");
    expect(out).toContain("twinkletree");
  });

  it("ignores anything that is not a usable name", () => {
    expect(nameCandidates([null, undefined, "", "   ", {}, [], NaN, "a".repeat(256)])).toEqual([]);
    expect(nameCandidates(undefined)).toEqual([]);
    expect(nameCandidates("")).toEqual([]);
  });

  it("treats a number as its text (some networks use a numeric advertiser id as the name)", () => {
    expect(nameCandidates(123456789)).toEqual(["123456789"]);
  });

  it("never returns more than the cap", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Brand Number ${i}`);
    expect(nameCandidates(many).length).toBeLessThanOrEqual(MAX_CANDIDATES);
  });
});

describe("imagematch/sources > sourceFor", () => {
  it("has the checked Facebook tables", () => {
    expect(FB.owners.table).toBe("facebook_ad_post_owners");
    expect(FB.ads).toMatchObject({ table: "facebook_ad", owner: "post_owner_id" });
    expect(FB.variants).toMatchObject({ table: "facebook_ad_variants", ad: "facebook_ad_id", image: "image_url" });
  });

  it("says clearly that another network is not supported yet", () => {
    for (const bad of ["reddit", "", undefined, null, 5, "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(() => sourceFor(bad)).toThrow(/not supported by the image-hashing job yet/);
    }
  });

  it("refuses an identifier that could change the SQL", () => {
    for (const evil of ["a; DROP TABLE x", "a`b", "a b", "A", "1abc", "", null, "a".repeat(65), "tbl--"]) {
      const sources = { net: { ...structuredClone(SOURCES.facebook), ads: { table: evil, id: "id", owner: "post_owner_id" } } };
      expect(() => sourceFor("net", sources)).toThrow(/invalid identifier/);
    }
  });

  it("every identifier in the shipped map is valid", () => {
    for (const network of Object.keys(SOURCES)) expect(() => sourceFor(network)).not.toThrow();
  });
});

describe("imagematch/sourceRepository > the queries only read, by index, with a limit", () => {
  const noWrites = (text) => expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|REPLACE)\b/i);

  it("findOwners looks up exact lowercase names, nothing else", async () => {
    const sql = fakeSql();
    await repo.findOwners(sql, FB, ["twinkling tree", "twinklingtree"]);
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/FROM `facebook_ad_post_owners` WHERE `post_owner_lower` IN \(\?, \?\) LIMIT 200/);
    expect(text).not.toMatch(/LIKE|OFFSET|SELECT \*/i);
    expect(params).toEqual(["twinkling tree", "twinklingtree"]);
    noWrites(text);
  });

  it("findOwners and ownersByIds make no query for an empty list, and ignore blanks", async () => {
    const sql = fakeSql();
    expect(await repo.findOwners(sql, FB, [])).toEqual([]);
    expect(await repo.findOwners(sql, FB, ["", null, undefined])).toEqual([]);
    expect(await repo.ownersByIds(sql, FB, [])).toEqual([]);
    expect(await repo.ownersByIds(sql, FB, [null, "", undefined])).toEqual([]);
    expect(sql.calls).toHaveLength(0);
  });

  it("ownersByIds uses the primary key", async () => {
    const sql = fakeSql();
    await repo.ownersByIds(sql, FB, [5, "6"]);
    expect(sql.calls[0].text).toMatch(/WHERE `id` IN \(\?, \?\)/);
    expect(sql.calls[0].params).toEqual([5, "6"]);
  });

  it("adIdsPage is a keyset page on the owner index: no OFFSET, ordered by id, with a LIMIT", async () => {
    const sql = fakeSql(() => [{ id: 11 }, { id: 12 }]);
    const ids = await repo.adIdsPage(sql, FB, 7, 10, 200);
    expect(ids).toEqual([11, 12]);
    const { text, params } = sql.calls[0];
    expect(text).toBe("SELECT `id` AS id FROM `facebook_ad` WHERE `post_owner_id` = ? AND `id` > ? ORDER BY `id` LIMIT 200");
    expect(params).toEqual([7, 10]);
    expect(text).not.toMatch(/OFFSET/i);
    noWrites(text);
  });

  it("adIdsPage starts at 0 when no id is given, and keeps the page size in range", async () => {
    const sql = fakeSql();
    await repo.adIdsPage(sql, FB, 7, undefined, 200);
    expect(sql.calls[0].params).toEqual([7, 0]);
    for (const [asked, used] of [[99999, 500], [0, 200], [-5, 1], ["abc", 200], [undefined, 200], [10, 10]]) {
      await repo.adIdsPage(sql, FB, 7, 0, asked);
      expect(sql.calls.at(-1).text).toMatch(new RegExp(`LIMIT ${used}$`));
    }
  });

  it("variantImages looks up the ads' images by the ad id index, and never more than the cap at once", async () => {
    const sql = fakeSql();
    const ids = Array.from({ length: 800 }, (_, i) => i + 1);
    await repo.variantImages(sql, FB, ids);
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/^SELECT `facebook_ad_id` AS ad_id, `image_url` AS image_url, `image_url_original` AS image_url_original FROM `facebook_ad_variants` WHERE `facebook_ad_id` IN \(/);
    expect(params).toHaveLength(500);
    noWrites(text);
    expect(await repo.variantImages(sql, FB, [])).toEqual([]);
    expect(sql.calls).toHaveLength(1);
  });

  it("platformIds maps our row ids to the platform's (scraper's) ad ids by primary key, null when a row has none", async () => {
    const sql = fakeSql(() => [{ id: 1, platform_id: "1234567890123" }, { id: 2, platform_id: null }, { id: 3, platform_id: "" }]);
    const map = await repo.platformIds(sql, FB, [1, 2, 3, 4]);
    expect(sql.calls[0].text).toBe("SELECT `id` AS id, `ad_id` AS platform_id FROM `facebook_ad` WHERE `id` IN (?, ?, ?, ?)");
    expect(sql.calls[0].params).toEqual([1, 2, 3, 4]);
    noWrites(sql.calls[0].text);
    expect(map.get("1")).toBe("1234567890123");
    expect(map.get("2")).toBeNull();
    expect(map.get("3")).toBeNull();
    expect(map.has("4")).toBe(false);
    expect((await repo.platformIds(sql, FB, [])).size).toBe(0);
    expect(sql.calls).toHaveLength(1);
  });

  it("carouselImages reads the extra images, and does nothing for a network without that table", async () => {
    const sql = fakeSql();
    await repo.carouselImages(sql, FB, [1, 2]);
    expect(sql.calls[0].text).toMatch(/FROM `facebook_ad_image_video` WHERE `facebook_ad_id` IN \(\?, \?\)/);
    const { carousel, ...withoutCarousel } = FB; // eslint-disable-line no-unused-vars
    expect(await repo.carouselImages(sql, withoutCarousel, [1])).toEqual([]);
    expect(sql.calls).toHaveLength(1);
  });
});
});

describe("imagematch full pipeline", () => {
// The whole automatic path, with the REAL cron runner, worker, job, client and blocklist service:
//   a blocked advertiser appears in the blocklist -> a cron tick -> a job -> the advertiser's ads and images
//   -> the hashing service (a real HTTP server on a local port, standing in for the DS team's) -> image_hash entries.
// Only the databases are in memory.

const { createRunner } = require("../../../src/compliance/imagematch/worker");
const { BlocklistService } = require("../../../src/compliance/blocklist/service");
const { idKey } = require("../../../src/compliance/blocklist/repository");

const V = "sscd-simhash-v1";
const CDN = "https://media.example.test/pas-dev/stream";
const KEY = "right-key";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const COMPLAINT = "11111111-1111-1111-1111-111111111111";
const silent = { info() {}, warn() {}, error() {} };

// ── the hashing service: a real HTTP server ──────────────────────────────────────────────────
let server;
let base;
let dsCalls;
let dsMode; // 'ok' | 'down'
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && req.url === "/health") return send(200, { status: "ready", hash_version: V, hash_bits: 256 });
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      dsCalls.push({ url: req.url, key: req.headers["x-api-key"] });
      if (req.headers["x-api-key"] !== KEY) return send(401, { detail: "bad key" });
      if (dsMode === "down") return send(503, { detail: "down" });
      const image = JSON.parse(raw).image_url;
      if (/tiny/.test(image)) return send(422, { detail: "Image is smaller than 32x32" });
      return send(200, { sscd_hash: sha(`hash:${image}`), sha256: sha(image) });
    });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

// ── the in-memory databases ──────────────────────────────────────────────────────────────────
function makeWorld() {
  const blocklistRows = [];                 // copyright_blocklist (written through the real BlocklistService)
  const jobs = [];                          // copyright_image_hash_jobs
  let nextJob = 1;
  let nextEntry = 500;
  const entries = [                         // blocklist entries of type advertiser the worker should notice
    { id: 1, network: "facebook", entry_type: "advertiser", value: "Twinkling Tree", status: "active", complaint_id: COMPLAINT },
    { id: 2, network: "facebook", entry_type: "url", value: "https://bad.example.com/x", status: "active" },
  ];
  const ads = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, owner: 9 }));
  const variants = ads.map((a) => ({
    ad_id: a.id,
    image_url: a.id === 5 ? "fb/a/tiny.jpeg" : a.id === 6 ? null : `fb/adImage/${a.id}.jpeg`,
    image_url_original: "",
  }));

  const sql = {
    async query(text, params) {
      const t = text.replace(/\s+/g, " ");
      if (/FROM `facebook_ad_post_owners`/.test(t)) return /post_owner_lower/.test(t) && params.includes("twinkling tree") ? [{ id: 9, name: "Twinkling Tree", ads_count: 30 }] : [];
      if (/FROM `facebook_ad` WHERE `id` IN/.test(t)) return params.map((id) => ({ id, platform_id: `P${id}` }));
      if (/FROM `facebook_ad` /.test(t)) {
        const [owner, after] = params; const limit = Number(/LIMIT (\d+)$/.exec(t)[1]);
        return ads.filter((a) => a.owner === owner && a.id > after).slice(0, limit).map((a) => ({ id: a.id }));
      }
      if (/FROM `facebook_ad_variants`/.test(t)) return variants.filter((v) => params.includes(v.ad_id));
      throw new Error(`unexpected query: ${t.slice(0, 80)}`);
    },
  };
  const claimed = (j, w) => j && j.claimed_by === w && j.status === "running";
  const jobRepository = {
    async findNewAdvertisers(_s, network) {
      return entries.filter((e) => (e.network === network) && e.status === "active" && ["advertiser", "page"].includes(e.entry_type)
        && !jobs.some((j) => j.network === network && j.blocklist_id === e.id)).map((e) => ({ id: e.id, value: e.value, complaint_id: e.complaint_id || null }));
    },
    async createJobs(_s, network, list) {
      for (const e of list) jobs.push({ id: nextJob++, network, blocklist_id: e.id, advertiser_name: e.value, complaint_id: e.complaint_id, status: "pending", attempts: 0, claimed_by: null, heartbeat_at: null, state: null, last_error: null });
      return { created: list.length };
    },
    async claimNext(_s, network, worker, staleBefore) {
      const j = jobs.find((x) => x.network === network && (x.status === "pending" || (x.status === "running" && x.heartbeat_at < staleBefore.getTime())));
      if (!j) return null;
      Object.assign(j, { status: "running", claimed_by: worker, heartbeat_at: Date.now(), attempts: j.attempts + 1 });
      return { ...j };
    },
    async loadState(_s, id) { return jobs.find((j) => j.id === id)?.state ?? null; },
    async saveProgress(_s, id, w, state) { const j = jobs.find((x) => x.id === id); if (!claimed(j, w)) return false; j.state = state; j.heartbeat_at = Date.now(); return true; },
    async finish(_s, id, w, status, { error } = {}) { const j = jobs.find((x) => x.id === id); if (!claimed(j, w)) return false; Object.assign(j, { status, last_error: error ?? null }); return true; },
    async release(_s, id, w, { error, refundAttempt = false } = {}) {
      const j = jobs.find((x) => x.id === id); if (!claimed(j, w)) return false;
      Object.assign(j, { status: "pending", claimed_by: null, heartbeat_at: null, last_error: error ?? null, attempts: refundAttempt ? Math.max(j.attempts - 1, 0) : j.attempts });
      return true;
    },
  };
  const blocklistRepository = {
    async upsertEntries(_s, rows) {
      for (const r of rows) {
        const hit = blocklistRows.find((b) => b.network === r.network && b.entry_type === r.entry_type && b.value_sha256 === r.value_sha256);
        if (hit) Object.assign(hit, r); else blocklistRows.push({ id: nextEntry++, ...r, status: "active" });
      }
      return { affected: rows.length };
    },
    async findIds(_s, rows) {
      return new Map(rows.map((r) => [idKey(r.network, r.entry_type, r.value_sha256), blocklistRows.find((b) => b.network === r.network && b.entry_type === r.entry_type && b.value_sha256 === r.value_sha256).id]));
    },
  };
  const blocklist = new BlocklistService({ config: { enabled: false, networks: ["facebook"] }, repository: blocklistRepository, getSql: () => sql, log: silent });
  return { sql, jobs, entries, blocklistRows, jobRepository, blocklist };
}

function makeRunner(world, { key = KEY, imageJob = {}, worker = {} } = {}) {
  return createRunner({
    config: {
      compliance: { imageMatch: {
        baseUrl: base, apiKey: key, timeoutMs: 5000, concurrency: 3, retries: 0, retryDelayMs: 1, maxFileBytes: 50 * 1024 * 1024, hashVersion: V,
        job: { pageSize: 10, pageDelayMs: 0, maxImages: 1000, includeCarousel: false, maxConsecutiveFailures: 5, addBatchSize: 50, maxOwners: 20, ...imageJob },
        worker: { networks: [], maxImagesPerJob: 1000, staleClaimMinutes: 60, maxAttempts: 3, pauseSeconds: 300, newJobsPerTick: 100, addedBy: "imagematch-worker", ...worker },
      } },
      crons: { timezone: "Asia/Kolkata" }, cdn: { baseUrl: CDN },
    },
    databaseManager: { getSQL: () => world.sql },
    sources: { facebook: {} }, // the real sourceFor is used: it needs the real facebook table map
    networksConfig: { facebook: { database: { sql: { enabled: true } } } },
    blocklist: world.blocklist, jobRepository: world.jobRepository, log: silent,
    sourcesModule: undefined,
  });
}

beforeEach(() => { dsCalls = []; dsMode = "ok"; });

describe("pipeline > a blocked advertiser is hashed by the cron, by itself", () => {
  it("a tick finds the advertiser, hashes its images and puts them in the blocklist with the same complaint id", async () => {
    const world = makeWorld();
    const run = makeRunner(world);
    const out = await run({ timeBudgetSeconds: 60 });

    expect(out.created).toBe(1);                                  // only the advertiser entry; the url entry is not an advertiser
    expect(world.jobs).toHaveLength(1);
    expect(world.jobs[0]).toMatchObject({ status: "done", attempts: 1, advertiser_name: "Twinkling Tree", complaint_id: COMPLAINT, last_error: null });

    // 30 ads: ad 5 is too small for the service (skipped), ad 6 has no stored image -> 28 images hashed
    const hashes = world.blocklistRows.filter((r) => r.entry_type === "image_hash");
    expect(hashes).toHaveLength(28);
    const first = hashes.find((h) => h.image_sha256 === sha(`${CDN}/fb/adImage/1.jpeg`));
    expect(first).toMatchObject({
      network: "facebook", value: sha(`${CDN}/fb/adImage/1.jpeg`), image_phash: sha(`hash:${CDN}/fb/adImage/1.jpeg`),
      image_phash_algo: V, complaint_id: COMPLAINT, added_by: "imagematch-worker", source: "imagematch:job", status: "active",
    });
    expect(JSON.parse(first.details)).toMatchObject({ owner_id: 9, ad_id: "P1", internal_ad_id: 1, image_url: "fb/adImage/1.jpeg" });
    expect(first.reason).toBe('auto: advertiser "Twinkling Tree" is blocked');
    expect(dsCalls.every((c) => c.key === KEY && c.url === "/v1/hash-url?embedding=false")).toBe(true);
    expect(dsCalls).toHaveLength(29); // 29 images were sent (the tiny one is refused by the service, not skipped before)
  });

  it("the next tick has nothing left to do: no new job, no call to the service", async () => {
    const world = makeWorld();
    const run = makeRunner(world);
    await run({ timeBudgetSeconds: 60 });
    const calls = dsCalls.length;
    const again = await run({ timeBudgetSeconds: 60 });
    expect(again).toMatchObject({ created: 0, ran: [] });
    expect(dsCalls.length).toBe(calls);
    expect(world.jobs).toHaveLength(1);
  });

  it("a new advertiser added later is picked up on the next tick", async () => {
    const world = makeWorld();
    const run = makeRunner(world);
    await run({ timeBudgetSeconds: 60 });
    world.entries.push({ id: 3, network: "facebook", entry_type: "page", value: "No Such Page", status: "active" });
    const out = await run({ timeBudgetSeconds: 60 });
    expect(out.created).toBe(1);
    expect(world.jobs[1]).toMatchObject({ advertiser_name: "No Such Page", status: "no_owner" }); // nothing to hash, and it says why
  });

  it("a wrong API key does no harm: the job waits, nothing is written, and it is not counted as a failed try", async () => {
    const world = makeWorld();
    const run = makeRunner(world, { key: "wrong-key" });
    const out = await run({ timeBudgetSeconds: 60 });
    expect(out.ran[0]).toMatchObject({ outcome: "pending", paused: true });
    expect(world.jobs[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(world.jobs[0].last_error).toContain("unauthorized");
    expect(world.blocklistRows.filter((r) => r.entry_type === "image_hash")).toHaveLength(0);
    // and it stays quiet until the pause is over: the service is not called again
    const calls = dsCalls.length;
    await run({ timeBudgetSeconds: 60 });
    expect(dsCalls.length).toBe(calls);
  });

  it("a service that is down: the job gives up the pass without writing, and is tried again later", async () => {
    dsMode = "down";
    const world = makeWorld();
    const run = makeRunner(world);
    const out = await run({ timeBudgetSeconds: 60 });
    expect(out.ran[0].outcome).toBe("pending");
    expect(world.jobs[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(world.blocklistRows.filter((r) => r.entry_type === "image_hash")).toHaveLength(0);
  });

  it("does nothing at all while the service has no key", async () => {
    const world = makeWorld();
    const run = makeRunner(world, { key: "" });
    expect(await run({ timeBudgetSeconds: 60 })).toEqual({ skipped: "the hashing service is not configured" });
    expect(world.jobs).toHaveLength(0);
    expect(dsCalls).toHaveLength(0);
  });

  it("a big advertiser is finished across several short ticks: each tick stops after a page, no try is counted, and every image is hashed once", async () => {
    const world = makeWorld();
    const { HashWorker } = require("../../../src/compliance/imagematch/worker");
    const { HashJob } = require("../../../src/compliance/imagematch/job");
    const { ImageHashClient } = require("../../../src/compliance/imagematch/client");
    const { sourceFor } = require("../../../src/compliance/imagematch/sources");
    const client = new ImageHashClient({ config: { baseUrl: base, apiKey: KEY, timeoutMs: 5000, concurrency: 1, retries: 0, retryDelayMs: 1 }, log: silent });
    const worker = new HashWorker({
      networks: ["facebook"], getSql: () => world.sql, repo: world.jobRepository, log: silent,
      makeJob: ({ network, sql, checkpoint }) => new HashJob({
        network, source: sourceFor(network), sql, client, blocklist: world.blocklist, cdnBase: CDN, hashVersion: V,
        config: { pageSize: 10, pageDelayMs: 40, maxImages: 1000, addBatchSize: 50 }, checkpoint, log: silent,
      }),
    });
    // a budget (30 ms) shorter than one page plus its pause: every tick stops after one page and the next continues
    let ticks = 0;
    for (; ticks < 30 && world.jobs[0]?.status !== "done"; ticks += 1) await worker.tick({ budgetMs: 30 });
    expect(world.jobs[0].status).toBe("done");
    expect(ticks).toBeGreaterThan(1);
    expect(world.jobs[0].attempts).toBe(1);   // the stops were not counted as tries
    expect(world.blocklistRows.filter((r) => r.entry_type === "image_hash")).toHaveLength(28);
  });
});
});

describe("HashJob > paths that are not image files", () => {
  it("does not call the service for a stored path with no image extension (a video id), and counts it", async () => {
    const variants = [
      { ad_id: 1, image_url: "fb/adImage/202610/1.jpeg", image_url_original: "" },
      { ad_id: 2, image_url: "pasvideos/fb/998877", image_url_original: "" },
      { ad_id: 3, image_url: "pasimages/fb/ads/5555", image_url_original: "" },
    ];
    const { job, client } = makeJob({ sql: standardDb({ variants }) });
    const out = await job.run(APPLY);
    expect(client.hashUrl).toHaveBeenCalledTimes(1);
    expect(out.stats.skipped["not an image file"]).toBe(2);
  });
});

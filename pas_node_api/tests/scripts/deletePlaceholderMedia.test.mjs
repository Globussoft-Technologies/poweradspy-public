import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const m = require("../../scripts/delete-placeholder-media");

const OPTS = { maxHeap: 80, maxCpu: 70, maxWriteQueue: 50, esTargetMs: 1000, esMaxBatch: 2000, esParallel: 4 };

describe("delete-placeholder-media", () => {
  it("dry run by default; --apply = ES + SQL; --apply=es / --apply=sql / --apply sql", () => {
    const o = m.parseArgs([]);
    expect(o.apply).toBe(false);
    expect(o.networks).toEqual(["facebook", "instagram", "youtube", "linkedin", "reddit", "tiktok", "gdn", "quora", "google"]);
    expect(o).toMatchObject({ mode: "date", only: "both", doEs: true, doSql: true, before: "2024-01-01", dateColumn: "last_seen", dbqParallel: 2 });
    expect(() => m.parseArgs(["--mode=everything"])).toThrow(/--mode/);
    expect(m.parseArgs(["--apply"])).toMatchObject({ apply: true, doEs: true, doSql: true });
    expect(m.parseArgs(["--apply=es"])).toMatchObject({ apply: true, doEs: true, doSql: false });
    expect(m.parseArgs(["--apply", "sql"])).toMatchObject({ apply: true, doEs: false, doSql: true });
    expect(m.parseArgs(["--apply", "--networks=quora"])).toMatchObject({ apply: true, only: "both", networks: ["quora"] });
    expect(() => m.parseArgs(["--apply=nas"])).toThrow(/es, sql or both/);
    expect(() => m.parseArgs(["--limit=1000"])).toThrow(/Unknown option/);
    expect(() => m.parseArgs(["--networks=pinterest"])).toThrow(/Unknown network/);
    expect(m.parseArgs(["--es-index=facebook:fb2,google:g2"]).esIndex).toEqual({ facebook: "fb2", google: "g2" });
    expect(() => m.parseArgs(["--before=01-01-2023"])).toThrow();
    expect(() => m.parseArgs(["--google-date-column=last_seen;x"])).toThrow();
    expect(() => m.parseArgs(["--exclude-tables=a;drop"])).toThrow();
  });

  it("date mode: every network by its own ES last_seen field, no type filter (also Google)", () => {
    const opts = { mode: "date", before: "2024-01-01", dateColumn: "last_seen" };
    const fields = { facebook: "facebook_ad.last_seen", instagram: "instagram_ad.last_seen", youtube: "last_seen", linkedin: "last_seen",
      reddit: "reddit_ad.last_seen", tiktok: "last_seen", gdn: "gdn_ad.last_seen", quora: "quora_ad.last_seen", google: "last_seen" };
    for (const [n, f] of Object.entries(fields)) {
      expect(m.dateEsQuery(m.NETWORKS[n], opts)).toEqual({ bool: { filter: [{ range: { [f]: { lt: "2024-01-01", format: "yyyy-MM-dd" } } }] } });
    }
  });

  it("placeholder mode keeps the old Google organic-only rule", () => {
    expect(m.dateEsQuery(m.NETWORKS.google, { mode: "placeholder", before: "2023-01-01", dateColumn: "last_seen" })).toEqual({
      bool: { filter: [{ term: { type: "organic search" } }, { range: { last_seen: { lt: "2023-01-01", format: "yyyy-MM-dd" } } }] },
    });
    expect(m.NETWORKS.google).toMatchObject({ mainTable: "google_text_ad", idField: "id" });
  });

  it("finds ES docs with no media fields, and checks their SQL media by ad id", async () => {
    expect(m.missingMediaQuery(m.NETWORKS.quora)).toEqual({
      bool: { must_not: [{ exists: { field: "new_nas_image_url" } }, { exists: { field: "thumbnail" } }] },
    });
    const seen = [];
    const sql = { pool: { query: async (text, params) => { seen.push([text, params]); return [[{ id: 7 }, { id: "9" }]]; } } };
    const plan = [{ table: "quora_ad_variants", col: "quora_ad_id", cols: ["image_url"] }];
    const found = await m.sqlPlaceholderAds(sql, plan, ["pasimage", "DefaultImage"], [7, 8, 9]);
    expect([...found]).toEqual([7, 9]);
    expect(seen[0][0]).toBe("SELECT DISTINCT `quora_ad_id` AS id FROM `quora_ad_variants` WHERE `quora_ad_id` IN (7,8,9) AND (`image_url` LIKE ? OR `image_url` LIKE ?)");
    expect(seen[0][1]).toEqual(["%pasimage%", "%DefaultImage%"]);
  });

  it("formats durations as d/h/m and sizes as MB/GB/TB", () => {
    expect(m.fmtDuration(45000)).toBe("45s");
    expect(m.fmtDuration(125000)).toBe("2m 5s");
    expect(m.fmtDuration(3 * 3600e3 + 4 * 60e3)).toBe("3h 4m");
    expect(m.fmtDuration(26 * 3600e3 + 60e3)).toBe("1d 2h 1m");
    expect(m.fmtBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(m.fmtBytes(3.5 * 1024 ** 3)).toBe("3.5 GB");
    expect(m.fmtBytes(2 * 1024 ** 4)).toBe("2.0 TB");
  });

  it("overrides replace config.json values only where set (TikTok uses its own ES)", () => {
    const base = {
      elastic: { node: "http://cfg:9200", index: "fb_cfg", auth: { username: "u" } },
      elastic_tiktok: { node: "http://tt:9200", index: "tt_cfg" },
      sql: { host: "cfg-sql", port: 3306, database: "facebook_sql", user: "x" },
    };
    const none = m.applyOverrides("facebook", base, {});
    expect(none.elastic).toMatchObject({ node: "http://cfg:9200", index: "fb_cfg", enabled: true });
    expect(none.sql).toMatchObject({ host: "cfg-sql", database: "facebook_sql", enabled: true });
    expect(none.overridden).toEqual({ es: false, sql: false });

    const ov = { es: { node: "http://other:9200" }, esIndex: { facebook: "fb_other" }, sql: { facebook: { host: "10.0.0.9" } } };
    const fb = m.applyOverrides("facebook", base, ov);
    expect(fb.elastic).toMatchObject({ node: "http://other:9200", index: "fb_other", auth: { username: "u" } });
    expect(fb.sql).toMatchObject({ host: "10.0.0.9", database: "facebook_sql" });
    expect(fb.overridden).toEqual({ es: true, sql: true });

    const tt = m.applyOverrides("tiktok", base, ov);
    expect(tt.elastic.node).toBe("http://tt:9200"); // the main ES override does not move TikTok
    expect(tt.sql).toBeNull();
  });

  it("tells placeholder docs, real-media docs and no-media docs apart", () => {
    const spec = m.NETWORKS.facebook;
    const P = ["pasimage", "pasvideo", "bydefault", "DefaultImage"];
    expect(m.isPlaceholderDoc({ new_nas_image_url: "https://x/pasimages/1.jpg" }, spec, P)).toBe(true);
    expect(m.isPlaceholderDoc({ othermedia: [{ url: "a.jpg" }, { url: "DefaultImage.jpg" }] }, spec, P)).toBe(true);
    expect(m.isPlaceholderDoc({ new_nas_image_url: "https://nas/facebook/123.webp", Thumbnail: "t.webp" }, spec, P)).toBe(false);
    expect(m.hasRealMedia({ new_nas_image_url: "https://nas/facebook/123.webp" }, spec, P)).toBe(true);
    expect(m.hasRealMedia({ new_nas_image_url: "x/DefaultImage.jpg" }, spec, P)).toBe(false);
    expect(m.hasRealMedia({}, spec, P)).toBe(false); // no media fields → nothing to show
    expect(m.hasRealMedia({ new_nas_image_url: "  " }, spec, P)).toBe(false);
  });

  it("reads the ID file one batch at a time and resumes from the saved byte offset", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phm-"));
    const f = path.join(dir, "ids.jsonl");
    const lines = Array.from({ length: 2500 }, (_, i) => JSON.stringify({ _id: `d${i}`, ad_id: i + 1, note: "ü€" }));
    fs.writeFileSync(f, `${lines.join("\n")}\n`);
    const seen = [];
    let offset = 0;
    for (;;) {
      const { records, next } = m.readChunk(f, offset, 333);
      if (!records.length) break;
      seen.push(...records.map((r) => r.ad_id));
      offset = next;
    }
    expect(seen).toHaveLength(2500);
    expect(seen[0]).toBe(1);
    expect(seen[2499]).toBe(2500);
    expect(new Set(seen).size).toBe(2500);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ES controller: grows when healthy, halves + pauses when the node is loaded or red", () => {
    const D = m.EsController.decide;
    const ok = { status: "yellow", heap: 40, cpu: 20, writeQueue: 0, newRejections: 0 };
    expect(D({ capacity: 1, batch: 500, load: ok, avgLatency: 200, opts: OPTS })).toMatchObject({ capacity: 1, batch: 625, pauseMs: 0 });
    expect(D({ capacity: 1, batch: 2000, load: ok, avgLatency: 200, opts: OPTS })).toMatchObject({ capacity: 2, batch: 2000 });
    expect(D({ capacity: 4, batch: 2000, load: ok, avgLatency: 200, opts: OPTS }).capacity).toBe(4); // capped at --es-parallel
    const hot = D({ capacity: 4, batch: 1000, load: { ...ok, heap: 91 }, avgLatency: 200, opts: OPTS });
    expect(hot).toMatchObject({ capacity: 2, batch: 600, pauseMs: 30000 });
    expect(hot.reasons[0]).toMatch(/heap/);
    expect(D({ capacity: 2, batch: 1000, load: { ...ok, status: "red" }, avgLatency: 0, opts: OPTS }).pauseMs).toBe(30000);
    expect(D({ capacity: 3, batch: 1000, load: { ...ok, newRejections: 5 }, avgLatency: 0, opts: OPTS }).capacity).toBe(1);
    expect(D({ capacity: 3, batch: 1000, load: ok, avgLatency: 2500, opts: OPTS })).toMatchObject({ capacity: 2, batch: 700, pauseMs: 0 });
  });

  it("semaphore capacity can change while requests wait", async () => {
    const s = new m.Semaphore(1);
    await s.acquire();
    let got = false;
    const p = s.acquire().then(() => { got = true; });
    await Promise.resolve();
    expect(got).toBe(false);
    s.setCapacity(2);
    await p;
    expect(got).toBe(true);
    expect(s.active).toBe(2);
  });

  it("treats outages and overload as wait-and-retry, real bugs as failures", () => {
    expect(m.isTransient(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(m.isTransient(Object.assign(new Error("x"), { code: "ER_LOCK_DEADLOCK" }))).toBe(true);
    expect(m.isTransient(Object.assign(new Error("x"), { meta: { statusCode: 429 } }))).toBe(true);
    expect(m.isTransient(Object.assign(new Error("No Living connections"), { name: "NoLivingConnectionsError" }))).toBe(true);
    expect(m.isTransient(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }))).toBe(false);
  });

  it("flags unindexed child tables that are big by rows OR by size (real prod cases)", () => {
    const MB = 1048576;
    const plan = { children: [
      { table: "single_ad_analytics", indexed: false, tableRows: 11025974, tableBytes: 450 * MB },
      { table: "youtube_comments", indexed: false, tableRows: 149475, tableBytes: 854 * MB },
      { table: "facebook_nas_update", indexed: false, tableRows: 51199, tableBytes: 69 * MB },
      { table: "facebook_ad_users", indexed: true, tableRows: 229668045, tableBytes: 25429 * MB },
    ] };
    expect(m.unsafeUnindexed(plan).map((c) => c.table)).toEqual(["single_ad_analytics", "youtube_comments"]);
  });

  it("SQL ids are validated integers only", () => {
    expect(m.idList([1, "2", "3; DROP TABLE x", -4, 0, 2 ** 60, null])).toBe("1,2");
  });

  it("deletes children then the ad in one transaction, and rolls back on error", async () => {
    const calls = [];
    const conn = {
      query: async (q) => { calls.push(q); if (/FROM `bad`/.test(q)) throw new Error("boom"); return [{ affectedRows: 2 }]; },
      beginTransaction: async () => calls.push("BEGIN"),
      commit: async () => calls.push("COMMIT"),
      rollback: async () => calls.push("ROLLBACK"),
      release: () => calls.push("RELEASE"),
    };
    const sql = { getConnection: async () => conn };
    const r = await m.deleteSqlBatch(sql, "quora_ad", [{ table: "quora_ad_url", col: "quora_ad_id" }], [5, 6]);
    expect(r).toEqual({ ads: 2, rows: 4 });
    expect(calls).toEqual([
      "SET SESSION innodb_lock_wait_timeout = 10", "BEGIN",
      "DELETE FROM `quora_ad_url` WHERE `quora_ad_id` IN (5,6)", "DELETE FROM `quora_ad` WHERE id IN (5,6)", "COMMIT", "RELEASE",
    ]);
    calls.length = 0;
    await expect(m.deleteSqlBatch(sql, "quora_ad", [{ table: "bad", col: "x" }], [5])).rejects.toThrow("boom");
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });

  it("keeps an ad in SQL only when another, non-deleted ES doc shows real media", async () => {
    const spec = m.NETWORKS.quora;
    const elastic = {
      indexName: "quora_search_mix",
      client: {
        search: async () => ({
          hits: {
            total: 5,
            hits: [
              { _source: { quora_ad: { id: 1 }, new_nas_image_url: "x/DefaultImage.jpg" } },
              { _source: { quora_ad: { id: 2 }, new_nas_image_url: "x/pasimages/a.jpg" } },
              { _source: { quora_ad: { id: 2 }, new_nas_image_url: "https://nas/quora/2.webp" } }, // ad 2 keeps a good doc
              { _source: { quora_ad: { id: 3 } } }, // no media in ES (media only in SQL) → delete
              { _source: { quora_ad: { id: 4 }, new_nas_image_url: "https://nas/q/4.webp", thumbnail: "x/pasimage/t.jpg" } }, // deleted from ES too → delete
            ],
          },
        }),
      },
    };
    const keep = await m.adsWithRealMedia(elastic, spec, ["pasimage", "DefaultImage"], [1, 2, 3, 4]);
    expect([...keep]).toEqual([2]);
  });
});

describe("parallel ID scan governor", () => {
  const O = { scanParallel: 8, maxHeap: 80, maxCpu: 70, maxSearchQueue: 100, scanTargetMs: 3000 };
  const ok = { status: "green", heap: 40, cpu: 20, searchQueue: 0, newSearchRejections: 0 };
  it("adds a slot only with headroom and requests waiting, up to --scan-parallel", () => {
    expect(m.ScanGovernor.decide({ capacity: 2, load: ok, avgLatency: 500, waiting: 3, opts: O }).capacity).toBe(3);
    expect(m.ScanGovernor.decide({ capacity: 2, load: ok, avgLatency: 500, waiting: 0, opts: O }).capacity).toBe(2);
    expect(m.ScanGovernor.decide({ capacity: 8, load: ok, avgLatency: 500, waiting: 5, opts: O }).capacity).toBe(8);
  });
  it("halves and pauses on heap / cpu / search queue / rejections, with the reason", () => {
    const d = m.ScanGovernor.decide({ capacity: 6, load: { ...ok, heap: 85 }, avgLatency: 500, waiting: 5, opts: O });
    expect(d).toMatchObject({ capacity: 3, pauseMs: 20000 });
    expect(d.reasons[0]).toMatch(/heap 85%/);
    expect(m.ScanGovernor.decide({ capacity: 4, load: { ...ok, newSearchRejections: 2 }, avgLatency: 0, waiting: 0, opts: O }).capacity).toBe(2);
    expect(m.ScanGovernor.decide({ capacity: 4, load: ok, avgLatency: 7000, waiting: 5, opts: O }).capacity).toBe(3);
  });
  it("splits big scans into sliced scrolls", () => {
    expect(m.scanSlices(27640258, 4)).toBe(4);
    expect(m.scanSlices(400000, 4)).toBe(2);
    expect(m.scanSlices(5000, 4)).toBe(1);
  });
});

describe("SQL placeholder patterns", () => {
  it("default to real placeholder files only — SQL stores real media as pasimages/... paths", () => {
    expect(m.parseArgs([]).sqlPatterns).toEqual(["DefaultImage", "bydefault"]);
    expect(() => m.parseArgs(["--sql-patterns=pasimage,DefaultImage"])).toThrow(/must not contain pasimage/);
  });
});

describe("keep rule: a placeholder in one field is not enough (production cases 2026-11-05)", () => {
  const P = ["pasimage", "pasvideo", "bydefault", "DefaultImage"];
  it("keeps docs whose real NAS image sits in another field", () => {
    const ig = { new_nas_image_url: "/PowerAdspy/n2/insta/adImage/202507/51695252.jpg", thumbnail: "pasimages/insta/thumbnails/DDXfCH1Agdd" };
    expect(m.hasRealMedia(ig, m.NETWORKS.instagram, P)).toBe(true);
    const li = { new_nas_image_url: "/PowerAdspy/n2/linkedin/adImage/202508/707948826.webp", ad_video: "pasimages/linkedin/ads/7000939707815645185" };
    expect(m.hasRealMedia(li, m.NETWORKS.linkedin, P)).toBe(true);
    const fb = { othermedia: ["/DefaultImage.jpg", "/pas-prod/stream/fb/otherMultiMedia/202606/38441901_1.jpg"] };
    expect(m.hasRealMedia(fb, m.NETWORKS.facebook, P)).toBe(true);
  });
  it("deletes docs where every media field is a placeholder / non-NAS path", () => {
    expect(m.hasRealMedia({ new_nas_image_url: "/DefaultImage.jpg", Thumbnail: "pasimages/fb/thumbnails/1" }, m.NETWORKS.facebook, P)).toBe(false);
    expect(m.hasRealMedia({ new_nas_image_url: "pasimages/quora/185964.webp" }, m.NETWORKS.quora, P)).toBe(false);
  });
  it("tiktok: an expiring tiktokcdn video_url does not count as real media", () => {
    expect(m.hasRealMedia({ video_cover: "pasvideos/tiktok/7405873109050802177.webp", video_url: "https://v16m-default.tiktokcdn.com/x" }, m.NETWORKS.tiktok, P)).toBe(false);
  });
});

describe("binlog safety (deleted rows are written to the MySQL binlog)", () => {
  it("each delete batch asks for binlog_row_image=MINIMAL on its own session, and still works if denied", async () => {
    const seen = [];
    const conn = {
      query: async (t) => { seen.push(t); if (/binlog_row_image/.test(t)) throw Object.assign(new Error("denied"), { code: "ER_SPECIFIC_ACCESS_DENIED_ERROR" }); return [{ affectedRows: 2 }]; },
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    };
    const r = await m.deleteSqlBatch({ getConnection: async () => conn }, "x_ad", [], [1, 2], { binlogMinimal: true });
    expect(r.ads).toBe(2);
    expect(seen.some((t) => /binlog_row_image = 'MINIMAL'/.test(t))).toBe(true);
  });

  it("pauses a host once its binlogs grew past --max-binlog-growth-gb, with the reason", async () => {
    let size = 10 * 1073741824;
    const sql = { pool: { query: async (t) => [/BINARY LOGS/.test(t) ? [{ File_size: size }] : [{ Value: "3" }]] } };
    const mon = new m.HostMonitor(sql, 16, 5);
    const notes = [];
    mon.name = "h"; mon.onDecision = (x) => notes.push(x);
    expect(await mon.busy()).toBe(false);          // start = 10 GB
    size += 6 * 1073741824; mon.binlogAt = 0; mon.at = 0;
    expect(await mon.busy()).toBe(true);           // +6 GB > 5 GB
    expect(mon.reason).toMatch(/binlog grew 6.0 GB/);
    expect(notes.at(-1)).toMatch(/pausing deletes/);
  });
});

describe("parallel SQL deletes per host (self-tuning, CPU cap via Threads_running)", () => {
  const O = { sqlParallel: 8, sqlTargetMs: 1500, maxThreadsRunning: 16, maxDbCpu: 60, dbVcpus: { "92.4.75.196": 16, "*": 8 } };
  it("caps Threads_running at --max-db-cpu % of the host's vCPUs", () => {
    expect(m.threadsLimitFor("92.4.75.196:3306", O)).toBe(9);   // 60% of 16
    expect(m.threadsLimitFor("10.0.0.1:3306", O)).toBe(4);      // 60% of 8 (default for other hosts)
    expect(m.threadsLimitFor("10.0.0.1:3306", { ...O, dbVcpus: {} })).toBe(16); // unknown → --max-threads-running
  });
  it("adds a parallel batch with headroom, slows on slow batches, halves when busy", () => {
    const D = (x) => m.SqlGovernor.decide({ capacity: 4, busy: false, threads: 3, limit: 10, avgLatency: 400, waiting: 2, opts: O, ...x });
    expect(D({}).capacity).toBe(5);
    expect(D({ threads: 7 }).capacity).toBe(4);           // above 60% of the limit: hold
    expect(D({ avgLatency: 4000 }).capacity).toBe(3);     // slow batches
    expect(D({ busy: true }).capacity).toBe(2);           // host busy: halve
    expect(D({ capacity: 8 }).capacity).toBe(8);          // capped at --sql-parallel
  });
  it("parses --db-vcpus for all hosts or per host", () => {
    expect(m.parseArgs(["--db-vcpus=16"]).dbVcpus).toEqual({ "*": 16 });
    expect(m.parseArgs(["--db-vcpus=92.4.75.196:32,152.67.3.243:8"]).dbVcpus).toEqual({ "92.4.75.196": 32, "152.67.3.243": 8 });
  });
});

describe("sharded SQL lane", () => {
  it("splits the id range, deletes every old ad exactly once, and continues an old single-cursor run", async () => {
    const os = await import("node:os"); const fs = await import("node:fs"); const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dpm-"));
    const HI = 400000;
    const old = (id) => id % 3 === 0; // ads last seen before the cutoff
    const deleted = new Map();
    const sql = {
      pool: { query: async (t, p = []) => {
        if (/MIN\(id\)/.test(t)) return [[{ lo: 1, hi: HI }]];
        const mm = t.match(/WHERE id > \? AND id <= \? .* LIMIT (\d+)/);
        if (mm) { const out = []; for (let id = p[0] + 1; id <= p[1] && out.length < Number(mm[1]); id += 1) if (old(id) && !deleted.has(id)) out.push({ id }); return [out]; }
        throw new Error(`unexpected ${t}`);
      } },
      getConnection: async () => ({
        query: async (t) => { const m2 = t.match(/DELETE FROM `x_ad` WHERE id IN \(([^)]*)\)/); let n = 0; if (m2) for (const id of m2[1].split(',').map(Number)) { deleted.set(id, (deleted.get(id) || 0) + 1); n += 1; } return [{ affectedRows: n }]; },
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
      }),
    };
    const opts = { mode: "date", before: "2024-01-01", dateColumn: "last_seen", sqlBatch: 300, sqlMaxBatch: 2000, sqlTargetMs: 1500, sqlShards: 4, sqlParallel: 3, maxLocalLoad: 99, binlogMinimal: false };
    // an older run had already walked ids 1..100000 with a single cursor (those ads are gone already)
    for (let id = 1; id <= 100000; id += 1) if (old(id)) deleted.set(id, 1);
    const state = { sql: { hi: HI, cursor: 100000, ads: 0, rows: 0, done: 0, finished: false }, es: {} };
    const RateMeterLike = { add() {}, rate: () => 0 };
    const job = { network: "x", sql, state, status: { sql: { state: "", meter: RateMeterLike } }, plan: { children: [] }, dir, spec: { mainTable: "x_ad" } };
    const monitor = { busy: async () => false, reason: "", threadsRunning: 1, limit: 16 };
    const gov = new m.SqlGovernor("h", monitor, opts, () => {});
    await m.runDateSqlLane(job, opts, monitor, gov);
    expect(state.sql.shards.length).toBe(4);
    expect(state.sql.shards[0].start).toBe(100000);               // continued where the old run stopped
    const expected = []; for (let id = 1; id <= HI; id += 1) if (old(id)) expected.push(id);
    expect(expected.every((id) => deleted.get(id) === 1)).toBe(true); // all old ads gone, none twice
    expect([...deleted.keys()].every(old)).toBe(true);                 // nothing new deleted
    expect(state.sql.finished).toBe(true);
    expect(state.sql.cursor).toBe(HI);
  }, 20000);
});

describe("MySQL CPU % (INNODB_METRICS module_cpu) drives the SQL speed", () => {
  it("computes the machine CPU share for ms or µs counters", () => {
    const prev = { at: 0, u: 0, s: 0, n: 8 };
    expect(m.cpuPercent(prev, { at: 10000, u: 30000, s: 10000, n: 8 })).toBeCloseTo(50); // ms: 4 cores of 8 busy
    expect(m.cpuPercent(prev, { at: 10000, u: 30000000, s: 10000000, n: 8 })).toBeCloseTo(50); // µs
  });
  it("pauses above the cap and only grows with CPU headroom", async () => {
    let t = 0; let cpuMs = 0;
    const sql = { pool: { query: async (q) => [/INNODB_METRICS/.test(q)
      ? [{ n: "cpu_utime_abs", c: cpuMs, st: "enabled" }, { n: "cpu_stime_abs", c: 0, st: "enabled" }, { n: "cpu_n", c: 8, st: "enabled" }]
      : [{ Value: "2" }]] } };
    const realNow = Date.now; Date.now = () => t;
    try {
      const mon = new m.HostMonitor(sql, 16, 0, 60);
      t = 20000; await mon.busy();                          // first sample
      t = 40000; cpuMs = 20000 * 8 * 0.7; mon.cpuAt = 0; mon.at = 0;
      expect(await mon.busy()).toBe(true);                   // 70% > 60%
      expect(mon.reason).toMatch(/MySQL CPU 70% > 60%/);
    } finally { Date.now = realNow; }
    const O = { sqlParallel: 8, sqlTargetMs: 1500, maxDbCpu: 60 };
    const D = (cpu) => m.SqlGovernor.decide({ capacity: 4, busy: false, threads: 2, limit: 16, avgLatency: 300, waiting: 3, opts: O, cpu }).capacity;
    expect(D(30)).toBe(5);   // well under the cap: faster
    expect(D(50)).toBe(4);   // close: hold
    expect(D(57)).toBe(3);   // near the cap: slower
  });
});

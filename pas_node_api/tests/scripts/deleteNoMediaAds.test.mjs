import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const m = require("../../scripts/delete-placeholder-media");
const wrapper = require("../../scripts/delete-no-media-ads");
const { getDisplayableMediaFilter, YOUTUBE_DISPLAY_UNDER_GDN } = require("../../src/services/common/helpers/displayableMediaFilters");

const NO_MEDIA_NETWORKS = ["facebook", "instagram", "youtube", "linkedin", "reddit", "gdn", "quora", "google", "pinterest", "native"];

const tmpFile = (lines) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomedia-"));
  const file = path.join(dir, "x.ids.jsonl");
  fs.writeFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  return { dir, file };
};

describe("--mode=no-media: arguments and networks", () => {
  it("runs every network except tiktok / chatgptads / admob, in its own state folder", () => {
    const o = m.parseArgs(["--mode=no-media"]);
    expect(o.networks).toEqual(NO_MEDIA_NETWORKS);
    expect(o).toMatchObject({ mode: "no-media", run: "no-media", keepSqlPatterns: ["PowerAdspy", "pas-prod"] });
    expect(() => m.parseArgs(["--mode=no-media", "--networks=tiktok"])).toThrow(/Unknown network/);
    expect(() => m.parseArgs(["--mode=no-media", "--networks=chatgptads"])).toThrow(/Unknown network/);
    expect(m.parseArgs(["--mode=no-media", "--run=x"]).run).toBe("x");
    expect(m.parseArgs(["--mode=no-media", "--keep-sql-patterns=a,b"]).keepSqlPatterns).toEqual(["a", "b"]);
  });

  it("the date / placeholder runs never pick up the no-media-only networks", () => {
    expect(m.parseArgs([]).networks).not.toContain("pinterest");
    expect(m.parseArgs(["--networks=all"]).networks).toEqual(m.networksFor("date"));
    expect(() => m.parseArgs(["--networks=native"])).toThrow(/Unknown network/);
  });

  it("wrapper forces the mode and adds fast ceilings only where the caller set nothing", () => {
    const a = wrapper.buildArgv(["--apply", "--es-parallel=2"]);
    expect(a[0]).toBe("--mode=no-media");
    expect(a).toContain("--es-parallel=2");
    expect(a).not.toContain("--es-parallel=8");
    expect(a).toContain("--sql-parallel=12");
    expect(() => wrapper.buildArgv(["--mode=date"])).toThrow(/no-media/);
    expect(m.parseArgs(a)).toMatchObject({ mode: "no-media", apply: true, esParallel: 2, sqlParallel: 12, scanSlices: 8 });
  });
});

describe("--mode=no-media: what is selected", () => {
  it("= a media type of the network AND not shown by the search gate", () => {
    for (const n of NO_MEDIA_NETWORKS) {
      const q = m.noMediaQuery(n);
      expect(q.bool.filter).toEqual([{ terms: { [m.NO_MEDIA[n].typeField]: m.NO_MEDIA[n].types } }]);
      expect(q.bool.must_not).toEqual([m.visibleQuery(n)]);
    }
    expect(m.visibleQuery("instagram")).toEqual({ bool: { should: [{ bool: { filter: getDisplayableMediaFilter("instagram") } }], minimum_should_match: 1 } });
  });

  it("youtube: an ad shown under GDN (DISPLAY / IMAGE) is visible too", () => {
    expect(m.visibleQuery("youtube").bool.should).toEqual([
      { bool: { filter: getDisplayableMediaFilter("youtube") } },
      { bool: { filter: YOUTUBE_DISPLAY_UNDER_GDN } },
    ]);
  });

  it("never selects types the search hides on purpose", () => {
    expect(m.NO_MEDIA.google.types).toEqual(["image"]); // not organic search / text / video
    expect(m.NO_MEDIA.youtube.types).not.toContain("BANNER");
    expect(m.NO_MEDIA.youtube.types).not.toContain("TEXT");
    for (const n of NO_MEDIA_NETWORKS) expect(m.NO_MEDIA[n].types).not.toContain("TEXT");
  });

  it("refuses to run against the old gate (duplicate must_not / stories without thumbnail)", () => {
    expect(() => m.assertGateUpToDate()).not.toThrow();
  });
});

describe("--mode=no-media: SQL fail-safe during the ID scan", () => {
  it("keeps ads whose SQL media holds a NAS path, writes the rest", async () => {
    const { dir, file } = tmpFile([]);
    const hits = [
      { _id: "a", _index: "i", _type: "doc", _source: { "instagram_ad.id": 1 } },
      { _id: "b", _index: "i", _type: "doc", _source: { "instagram_ad.id": 2 } }, // SQL has /PowerAdspy/... → keep
      { _id: "c", _index: "i", _type: "doc", _source: {} }, // no SQL id → ES only
    ];
    const sqlCalls = [];
    const job = {
      network: "instagram", spec: m.NETWORKS.instagram, dir, idsFile: file,
      elastic: {
        indexName: "i",
        client: {
          count: async () => ({ count: 3 }),
          search: async () => ({ _scroll_id: "s", hits: { hits } }),
          scroll: async () => ({ _scroll_id: "s", hits: { hits: [] } }),
          clearScroll: async () => ({}),
        },
      },
      sqlRead: { pool: { query: async (text, params) => { sqlCalls.push([text, params]); return [[{ id: 2 }]]; } } },
      mediaPlan: [{ table: "instagram_ad_variants", col: "instagram_ad_id", cols: ["image_url"] }],
    };
    const r = await m.collectNoMediaIds(job, m.parseArgs(["--mode=no-media"]), null);
    expect(r).toMatchObject({ total: 2, keptReal: 1, uniqueAds: 1 });
    const written = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(written.map((x) => x._id)).toEqual(["a", "c"]);
    const kept = fs.readFileSync(path.join(dir, "instagram.kept-sql-media.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(kept).toEqual([{ _id: "b", ad_id: 2, reason: "SQL media has a NAS path" }]);
    expect(sqlCalls[0][0]).toContain("`instagram_ad_id` IN (1,2)");
    expect(sqlCalls[0][1]).toEqual(["%PowerAdspy%", "%pas-prod%"]);
  });

  it("keeps a SQL ad while another ES doc of it is shown by the search", async () => {
    let body;
    const elastic = { indexName: "search_mix", client: { search: async (p) => { body = p.body; return { hits: { total: 1, hits: [{ _source: { "facebook_ad.id": 5 } }] } }; } } };
    const keep = await m.adsVisibleInEs(elastic, "facebook", m.NETWORKS.facebook, [5, 6]);
    expect([...keep]).toEqual([5]);
    expect(body.query.bool.filter).toEqual([{ terms: { "facebook_ad.id": [5, 6] } }, m.visibleQuery("facebook")]);
  });
});

describe("ordered parallel pool (resumable cursors with batches in flight)", () => {
  const lines = Array.from({ length: 10 }, (_, i) => ({ _id: String(i), ad_id: i + 1 }));

  it("runs batches in parallel but saves the offset in file order", async () => {
    const { file } = tmpFile(lines);
    const commits = [];
    let inFlight = 0;
    let maxInFlight = 0;
    await m.runOrderedPool({
      file, offset: 0, workers: 3, size: () => 2,
      acquire: async () => {}, release: () => {},
      process: async (records) => {
        inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, Number(records[0]._id) === 0 ? 30 : 5)); // first batch is the slowest
        inFlight -= 1;
        return records.map((x) => x._id);
      },
      onCommit: ({ result, next }) => commits.push([result.join(","), next]),
    });
    expect(maxInFlight).toBe(3);
    expect(commits.map((c) => c[0])).toEqual(["0,1", "2,3", "4,5", "6,7", "8,9"]);
    expect(commits.map((c) => c[1])).toEqual([...commits.map((c) => c[1])].sort((a, b) => a - b));
    expect(commits.at(-1)[1]).toBe(fs.statSync(file).size);
  });

  it("an error stops new work and the saved offset never passes the failed batch", async () => {
    const { file } = tmpFile(lines);
    const commits = [];
    await expect(m.runOrderedPool({
      file, offset: 0, workers: 2, size: () => 2,
      acquire: async () => {}, release: () => {},
      process: async (records) => { if (records[0]._id === "2") throw new Error("boom"); return records.length; },
      onCommit: (d) => commits.push(d.next),
    })).rejects.toThrow("boom");
    expect(commits.length).toBe(1); // only the batch before the failed one
  });
});

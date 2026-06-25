import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { parseOtherMultimedia } = require("../../../../src/services/reddit/insertion/normalize");
const repo = require("../../../../src/services/reddit/insertion/repository");

// ───────────────────────────────────────────────────────────────────────────
// parseOtherMultimedia — pure carousel parser (split order ||, → || → |)
// ───────────────────────────────────────────────────────────────────────────
describe("reddit/insertion/normalize > parseOtherMultimedia", () => {
  it("empty / missing → { present:false, images:[] }", () => {
    for (const v of [undefined, null, "", "   ", "\t\n"]) {
      expect(parseOtherMultimedia(v)).toEqual({ present: false, images: [] });
    }
  });

  it("single URL, no delimiter → one-element array", () => {
    expect(parseOtherMultimedia("https://a.com/1.jpg")).toEqual({
      present: true,
      images: ["https://a.com/1.jpg"],
    });
  });

  it("splits on '||'", () => {
    expect(parseOtherMultimedia("https://a/1.jpg||https://a/2.jpg||https://a/3.jpg")).toEqual({
      present: true,
      images: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"],
    });
  });

  it("'||,' takes precedence over '||' (legacy split order)", () => {
    // splits ONLY on '||,', so the inner '||' stays inside the second part
    expect(parseOtherMultimedia("a||,b||c")).toEqual({
      present: true,
      images: ["a", "b||c"],
    });
  });

  it("splits on single '|' only when no '||' present", () => {
    expect(parseOtherMultimedia("a|b|c")).toEqual({ present: true, images: ["a", "b", "c"] });
  });

  it("trims whitespace and drops empty entries (e.g. trailing delimiter)", () => {
    expect(parseOtherMultimedia(" a || b ||  || ")).toEqual({ present: true, images: ["a", "b"] });
  });

  it("whitespace-only entries all dropped → present:false", () => {
    expect(parseOtherMultimedia(" || || ")).toEqual({ present: false, images: [] });
  });

  it("coerces non-strings (number) defensively", () => {
    expect(parseOtherMultimedia(12345)).toEqual({ present: true, images: ["12345"] });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// upsertAdImageVideo — writes the carousel JSON into reddit_ad_image_video
// exec.query returns rows directly (SELECT) / ResultSetHeader (INSERT/UPDATE),
// matching the db.sql wrapper in DatabaseManager.
// ───────────────────────────────────────────────────────────────────────────
function mkExec(selectRows, writeResult = { affectedRows: 1 }) {
  return {
    query: vi.fn(async (sql) =>
      /^\s*SELECT/i.test(sql) ? selectRows : writeResult
    ),
  };
}

describe("reddit/insertion/repository > upsertAdImageVideo", () => {
  it("returns 0 and runs no query when reddit_ad_id is missing", async () => {
    const exec = mkExec([]);
    expect(await repo.upsertAdImageVideo(exec, {})).toBe(0);
    expect(await repo.upsertAdImageVideo(exec, null)).toBe(0);
    expect(exec.query).not.toHaveBeenCalled();
  });

  it("INSERTs when no existing row for the ad", async () => {
    const exec = mkExec([] /* SELECT → no rows */, { affectedRows: 1 });
    const r = await repo.upsertAdImageVideo(exec, {
      reddit_ad_id: 10,
      ad_type: "IMAGE",
      ad_image_video: '["/image/otherImage_10_0.jpg","/image/otherImage_10_1.jpg"]',
    });
    expect(r).toBe(1);
    expect(exec.query).toHaveBeenCalledTimes(2);
    const [selSql] = exec.query.mock.calls[0];
    const [insSql, insParams] = exec.query.mock.calls[1];
    expect(selSql).toMatch(/SELECT id FROM reddit_ad_image_video WHERE reddit_ad_id = \?/);
    expect(insSql).toMatch(/INSERT INTO reddit_ad_image_video \(reddit_ad_id, ad_type, ad_image_video\)/);
    expect(insParams).toEqual([10, "IMAGE", '["/image/otherImage_10_0.jpg","/image/otherImage_10_1.jpg"]']);
  });

  it("UPDATEs when a row already exists (carousel refresh)", async () => {
    const exec = mkExec([{ id: 5 }] /* SELECT → exists */, { affectedRows: 1 });
    const r = await repo.upsertAdImageVideo(exec, {
      reddit_ad_id: 10,
      ad_type: "VIDEO",
      ad_image_video: '["/image/otherImage_10_0.jpg"]',
    });
    expect(r).toBe(1);
    const [updSql, updParams] = exec.query.mock.calls[1];
    expect(updSql).toMatch(/UPDATE reddit_ad_image_video SET ad_type = \?, ad_image_video = \? WHERE reddit_ad_id = \?/);
    expect(updParams).toEqual(["VIDEO", '["/image/otherImage_10_0.jpg"]', 10]);
  });

  it("passes nulls through when ad_type / ad_image_video are absent", async () => {
    const exec = mkExec([], { affectedRows: 1 });
    await repo.upsertAdImageVideo(exec, { reddit_ad_id: 7 });
    const [, insParams] = exec.query.mock.calls[1];
    expect(insParams).toEqual([7, null, null]);
  });
});

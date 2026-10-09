import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { timeCapHint } = require("../../../src/services/common/helpers/sqlTimeCap");

const normalized = (sql) => sql.replace(/\s+/g, " ").trim();
const repoOf = (net) => require(`../../../src/services/${net}/ocr/repository`);

describe("common/helpers/sqlTimeCap > timeCapHint", () => {
  it("renders the hint for a positive integer only", () => {
    expect(timeCapHint(10000)).toBe(" /*+ MAX_EXECUTION_TIME(10000) */");
    for (const bad of [undefined, null, 0, -1, 1.5, NaN, "10000"]) {
      expect(timeCapHint(bad)).toBe("");
    }
  });
});

// Every non-Facebook lease query carries the configured time cap right after SELECT.
const LEASES = [
  { net: "gdn", call: (r, exec, cap) => r.leaseImageAds(exec, 0, false, cap) },
  { net: "linkedin", call: (r, exec, cap) => r.leaseImageAds(exec, 0, false, cap) },
  { net: "instagram", call: (r, exec, cap) => r.getImagesUrl(exec, 0, false, cap) },
  { net: "native", call: (r, exec, cap) => r.getImagesUrl(exec, 0, false, cap) },
  { net: "quora", call: (r, exec, cap) => r.getImagesUrl(exec, 0, false, cap) },
  { net: "reddit", call: (r, exec, cap) => r.getImagesUrl(exec, 0, false, cap) },
  { net: "pinterest", call: (r, exec, cap) => r.getImagesUrl(exec, 0, false, cap) },
  { net: "youtube", call: (r, exec, cap) => r.leaseImageAds(exec, 0, cap) },
];

describe("OCR lease queries > MAX_EXECUTION_TIME cap", () => {
  for (const { net, call } of LEASES) {
    it(`${net}: capped when a cap is given, uncapped otherwise`, async () => {
      const repo = repoOf(net);

      const capped = { query: vi.fn().mockResolvedValue([]) };
      await call(repo, capped, 10000);
      expect(normalized(capped.query.mock.calls[0][0])).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(10000\) \*\/ /);

      const uncapped = { query: vi.fn().mockResolvedValue([]) };
      await call(repo, uncapped, undefined);
      const sql = normalized(uncapped.query.mock.calls[0][0]);
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toContain("MAX_EXECUTION_TIME");
    });
  }
});

// Report writers fit the latin1 OCR/OCB columns (image_ocr included — it is latin1 on
// prod) so an emoji/CJK value cannot fail the UPDATE (the 401 "Image Object not updated"
// backlog).
const REPORT_NETS = ["facebook", "gdn", "native", "quora", "reddit", "pinterest", "instagram"];

describe("OCR report writers > latin1 OCR/OCB columns", () => {
  for (const net of REPORT_NETS) {
    it(`${net}: strips >U+00FF from image_ocr/object/celebrity/brand_logo`, async () => {
      const exec = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
      const data = {
        image_object: "Shoe||Café||Bag👜",
        image_celebrity: "Shah Rukh Khan||शाहरुख",
        image_brand_logo: "Nike™||ナイキ",
        image_ocr: "50% OFF 🔥||今日だけ",
        image_url_status: 1,
      };

      await expect(repoOf(net).updateVariant(exec, 42, data)).resolves.toBe(1);

      const [sql, params] = exec.query.mock.calls[0];
      const cols = normalized(sql).match(/SET (.*) WHERE/)[1].split(", ").map((c) => c.split(" = ")[0]);
      const sent = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      expect(sent.image_object).toBe("Shoe||Café||Bag");
      expect(sent.image_celebrity).toBe("Shah Rukh Khan||");
      expect(sent.image_brand_logo).toBe("Nike||");
      expect(sent.image_ocr).toBe("50% OFF ||");
      expect(params[params.length - 1]).toBe(42);
    });
  }
});

// Over-long values fail the UPDATE under STRICT_TRANS_TABLES. varchar(256) networks trim
// to 256 on a whole `||` item; text-column fields are left at full length.
const sentCols = (exec) => {
  const [sql, params] = exec.query.mock.calls[0];
  const cols = normalized(sql).match(/SET (.*) WHERE/)[1].split(", ").map((c) => c.split(" = ")[0]);
  return Object.fromEntries(cols.map((c, i) => [c, params[i]]));
};
const longList = Array.from({ length: 40 }, (_, i) => `item${String(i).padStart(3, "0")}`).join("||"); // 318 chars

describe("OCR report writers > column length", () => {
  for (const net of ["facebook", "native", "quora", "reddit", "instagram"]) {
    it(`${net}: trims every OCR/OCB column to 256 on a whole item`, async () => {
      const exec = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
      await repoOf(net).updateVariant(exec, 1, {
        image_ocr: longList, image_object: longList, image_celebrity: longList, image_brand_logo: longList,
      });
      for (const v of Object.values(sentCols(exec)).slice(0, 4)) {
        expect(v.length).toBeLessThanOrEqual(256);
        expect(v.endsWith("||")).toBe(false);
        expect(longList.startsWith(v)).toBe(true);
      }
    });
  }

  it("gdn: trims image_object only (other columns are text)", async () => {
    const exec = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
    await repoOf("gdn").updateVariant(exec, 1, { image_object: longList, image_ocr: longList });
    const sent = sentCols(exec);
    expect(sent.image_object.length).toBeLessThanOrEqual(256);
    expect(sent.image_ocr).toBe(longList);
  });

  it("pinterest: no trimming (text columns)", async () => {
    const exec = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
    await repoOf("pinterest").updateVariant(exec, 1, { image_ocr: longList, image_object: longList });
    expect(sentCols(exec)).toMatchObject({ image_ocr: longList, image_object: longList });
  });

  it("instagram: a JSON-array value stays valid JSON when trimmed", async () => {
    const exec = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
    const json = JSON.stringify(longList.split("||"));
    await repoOf("instagram").updateVariant(exec, 1, { image_object: json });
    const stored = sentCols(exec).image_object;
    expect(stored.length).toBeLessThanOrEqual(256);
    const arr = JSON.parse(stored);
    expect(arr.length).toBeGreaterThan(0);
    expect(arr).toEqual(longList.split("||").slice(0, arr.length));
  });

  it("linkedin updateOcrDetail: keeps utf8mb4 chars, trims to 255", async () => {
    const exec = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
    await repoOf("linkedin").updateOcrDetail(exec, 1, { image_ocr: "हिन्दी 🔥", image_object: longList });
    const sent = sentCols(exec);
    expect(sent.image_ocr).toBe("हिन्दी 🔥");
    expect(sent.image_object.length).toBeLessThanOrEqual(255);
    expect(longList.startsWith(sent.image_object)).toBe(true);
  });

  it("youtube insertOcb/updateOcb: keeps utf8mb4 chars, trims ocr/object/celebrity/brand_logo to 255", async () => {
    const yt = repoOf("youtube");
    const ins = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
    await yt.insertOcb(ins, 9, { ocr: longList, ocr_update_date: "2026-10-09 12:00:00" });
    const [insSql, insParams] = ins.query.mock.calls[0];
    expect(insSql).toMatch(/^INSERT INTO youtube_ad_ocb \(youtube_ad_id, ocr, ocr_update_date\)/);
    expect(insParams[1].length).toBeLessThanOrEqual(255);
    expect(longList.startsWith(insParams[1])).toBe(true);

    const upd = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
    await yt.updateOcb(upd, 9, { object: "हिन्दी 🔥", brand_logo: longList });
    const sent = sentCols(upd);
    expect(sent.object).toBe("हिन्दी 🔥");
    expect(sent.brand_logo.length).toBeLessThanOrEqual(255);
  });

  it("short latin1 values are passed through unchanged", async () => {
    const exec = { query: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
    await repoOf("facebook").updateVariant(exec, 1, { image_ocr: "SALE||50% OFF", image_object: null });
    expect(sentCols(exec)).toMatchObject({ image_ocr: "SALE||50% OFF", image_object: null });
  });
});

// Native saves to MySQL before the ES lookup: an ad with no search doc is already saved,
// so it must not be reported as a failure (the worker would retry it forever).
describe("native updateImageOcrDetails > ad missing from search index", () => {
  const { updateImageOcrDetails } = require("../../../src/services/native/ocr/services/updateImageOcrService");

  it("saves to MySQL and returns 200 'not in search index'", async () => {
    const variant = { native_ad_id: 52216198, image_text_final_status: 1, image_ocr: null };
    const sql = { query: vi.fn().mockResolvedValueOnce([variant]).mockResolvedValue({ affectedRows: 1 }) };
    const elastic = { indexName: "native_search_mix_v2", search: vi.fn().mockResolvedValue({ hits: { hits: [] } }), update: vi.fn() };
    const log = { error: vi.fn() };

    const out = await updateImageOcrDetails({ ad_id: 52216198, status: 4, ocr: "" }, { sql, elastic }, log);

    expect(out).toEqual({ code: 200, message: "Image Data Updated Successfully (ad not in search index)" });
    expect(normalized(sql.query.mock.calls[1][0])).toMatch(/^UPDATE native_ad_variants SET /);
    expect(elastic.update).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });
});

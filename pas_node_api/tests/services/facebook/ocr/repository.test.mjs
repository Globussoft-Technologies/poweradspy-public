import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repo = require("../../../../src/services/facebook/ocr/repository");

const normalized = (sql) => sql.replace(/\s+/g, " ").trim();

describe("services/facebook/ocr/repository > leaseImageAds (10-day lease)", () => {
  it("drives the join from the bounded 10-day IMAGE window, with an execution-time cap", async () => {
    const exec = { query: vi.fn().mockResolvedValue([{ ad_id: 42, image_url: "/a.jpg" }]) };

    await expect(repo.leaseImageAds(exec, 0, false, 10000)).resolves.toEqual([
      { ad_id: 42, image_url: "/a.jpg" },
    ]);

    const [sql, params] = exec.query.mock.calls[0];
    const query = normalized(sql);
    expect(query).toContain("SELECT /*+ MAX_EXECUTION_TIME(10000) */ STRAIGHT_JOIN variants.facebook_ad_id AS ad_id");
    expect(query).toContain(
      "FROM facebook_ad AS ads FORCE INDEX (idx_type_last_seen) " +
        "INNER JOIN facebook_ad_variants AS variants FORCE INDEX (idx_image_url_status_facebook_ad_id) " +
        "ON variants.facebook_ad_id = ads.id AND variants.image_url_status = ?"
    );
    expect(query).toContain("ORDER BY ads.id DESC LIMIT 20");
    expect(query).not.toContain("image_ocr");
    expect(params).toEqual([0]);
  });

  it("omits the cap when no positive integer is given", async () => {
    for (const cap of [undefined, 0, -5, NaN, "10000"]) {
      const exec = { query: vi.fn().mockResolvedValue([]) };
      await repo.leaseImageAds(exec, 0, false, cap);
      const query = normalized(exec.query.mock.calls[0][0]);
      expect(query).toContain("SELECT STRAIGHT_JOIN variants.facebook_ad_id AS ad_id");
      expect(query).not.toContain("MAX_EXECUTION_TIME");
    }
  });

  it("includes image_ocr for the OCR queue", async () => {
    const exec = { query: vi.fn().mockResolvedValue([]) };

    await repo.leaseImageAds(exec, 4, true, 10000);

    expect(normalized(exec.query.mock.calls[0][0])).toContain(
      "variants.image_url, variants.image_ocr"
    );
    expect(exec.query.mock.calls[0][1]).toEqual([4]);
  });
});

describe("services/facebook/ocr/repository > getMinAdIdSince", () => {
  it("returns the first id created inside the window (created_date index)", async () => {
    const exec = { query: vi.fn().mockResolvedValue([{ id: 37294160 }]) };

    await expect(repo.getMinAdIdSince(exec, 180)).resolves.toBe(37294160);

    expect(normalized(exec.query.mock.calls[0][0])).toBe(
      "SELECT id FROM facebook_ad WHERE created_date >= NOW() - INTERVAL 180 DAY ORDER BY created_date LIMIT 1"
    );
  });

  it("returns null when no ad is in the window", async () => {
    const exec = { query: vi.fn().mockResolvedValue([]) };
    await expect(repo.getMinAdIdSince(exec, 180)).resolves.toBeNull();
  });

  it("never queries with an invalid window", async () => {
    const exec = { query: vi.fn() };
    for (const days of [undefined, 0, -1, 1.5, "180"]) {
      await expect(repo.getMinAdIdSince(exec, days)).resolves.toBeNull();
    }
    expect(exec.query).not.toHaveBeenCalled();
  });
});

describe("services/facebook/ocr/repository > leaseImageAdsFromId (id-window lease)", () => {
  it("walks the status index from minAdId with a deferred join and the batch size", async () => {
    const exec = { query: vi.fn().mockResolvedValue([{ ad_id: 41000000, image_url: "/a.jpg" }]) };

    await expect(
      repo.leaseImageAdsFromId(exec, 0, false, { minAdId: 37294160, batchSize: 20, maxExecutionMs: 10000 })
    ).resolves.toEqual([{ ad_id: 41000000, image_url: "/a.jpg" }]);

    const [sql, params] = exec.query.mock.calls[0];
    const query = normalized(sql);
    expect(query).toContain("SELECT /*+ MAX_EXECUTION_TIME(10000) */ v.facebook_ad_id AS ad_id, v.image_url FROM (");
    expect(query).toContain(
      "SELECT STRAIGHT_JOIN v.id AS variant_id " +
        "FROM facebook_ad_variants AS v FORCE INDEX (idx_image_url_status_facebook_ad_id) " +
        "INNER JOIN facebook_ad AS a ON a.id = v.facebook_ad_id " +
        "WHERE v.image_url_status = ? AND v.facebook_ad_id >= ? AND a.type = 'IMAGE' " +
        "ORDER BY v.facebook_ad_id DESC LIMIT 20"
    );
    expect(query).toContain(
      ") AS t INNER JOIN facebook_ad_variants AS v ON v.id = t.variant_id ORDER BY v.facebook_ad_id DESC"
    );
    expect(query).not.toContain("image_ocr");
    expect(params).toEqual([0, 37294160]);
  });

  it("uses the configured batch size and selects image_ocr for the OCR queue", async () => {
    const exec = { query: vi.fn().mockResolvedValue([]) };

    await repo.leaseImageAdsFromId(exec, 4, true, { minAdId: 100, batchSize: 50 });

    const query = normalized(exec.query.mock.calls[0][0]);
    expect(query).toContain("v.image_url, v.image_ocr FROM (");
    expect(query).toContain("LIMIT 50");
    expect(query).not.toContain("MAX_EXECUTION_TIME");
    expect(exec.query.mock.calls[0][1]).toEqual([4, 100]);
  });

  it("never queries without a valid minAdId and batch size", async () => {
    const exec = { query: vi.fn() };
    const bad = [
      { minAdId: 0, batchSize: 20 },
      { minAdId: null, batchSize: 20 },
      { minAdId: 100, batchSize: 0 },
      { minAdId: 100, batchSize: "20" },
      {},
    ];
    for (const opts of bad) {
      await expect(repo.leaseImageAdsFromId(exec, 0, false, opts)).resolves.toEqual([]);
    }
    expect(exec.query).not.toHaveBeenCalled();
  });
});

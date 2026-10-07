import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const config = require("../../../../src/config");
const repo = require("../../../../src/services/facebook/ocr/repository");

const normalized = (sql) => sql.replace(/\s+/g, " ").trim();

describe("services/facebook/ocr/repository > leaseImageAds", () => {
  let savedFacebookOcr;
  beforeEach(() => {
    savedFacebookOcr = config.facebookOcr;
    config.facebookOcr = { leaseMaxExecutionMs: 10000 };
  });
  afterEach(() => {
    config.facebookOcr = savedFacebookOcr;
  });

  it("drives the join from the bounded 10-day IMAGE window, with an execution-time cap", async () => {
    const exec = { query: vi.fn().mockResolvedValue([{ ad_id: 42, image_url: "/a.jpg" }]) };

    await expect(repo.leaseImageAds(exec, 0, false)).resolves.toEqual([
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

  it("takes the cap from config on every call (reload applies without restart)", async () => {
    const exec = { query: vi.fn().mockResolvedValue([]) };

    config.facebookOcr.leaseMaxExecutionMs = 7500;
    await repo.leaseImageAds(exec, 0, false);
    expect(normalized(exec.query.mock.calls[0][0])).toContain("SELECT /*+ MAX_EXECUTION_TIME(7500) */ STRAIGHT_JOIN");
  });

  it("omits the cap when config has no leaseMaxExecutionMs", async () => {
    const exec = { query: vi.fn().mockResolvedValue([]) };

    config.facebookOcr = {};
    await repo.leaseImageAds(exec, 0, false);
    const query = normalized(exec.query.mock.calls[0][0]);
    expect(query).toContain("SELECT STRAIGHT_JOIN variants.facebook_ad_id AS ad_id");
    expect(query).not.toContain("MAX_EXECUTION_TIME");
  });

  it("includes image_ocr for the OCR queue", async () => {
    const exec = { query: vi.fn().mockResolvedValue([]) };

    await repo.leaseImageAds(exec, 4, true);

    expect(normalized(exec.query.mock.calls[0][0])).toContain(
      "variants.image_url, variants.image_ocr"
    );
    expect(exec.query.mock.calls[0][1]).toEqual([4]);
  });
});

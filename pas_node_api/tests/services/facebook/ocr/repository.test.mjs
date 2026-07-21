import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repo = require("../../../../src/services/facebook/ocr/repository");

const normalized = (sql) => sql.replace(/\s+/g, " ").trim();

describe("services/facebook/ocr/repository > leaseImageAds", () => {
  it("drives the join from the status/ad-id index so LIMIT can stop the scan early", async () => {
    const exec = { query: vi.fn().mockResolvedValue([{ ad_id: 42, image_url: "/a.jpg" }]) };

    await expect(repo.leaseImageAds(exec, 0, false)).resolves.toEqual([
      { ad_id: 42, image_url: "/a.jpg" },
    ]);

    const [sql, params] = exec.query.mock.calls[0];
    const query = normalized(sql);
    expect(query).toContain("SELECT STRAIGHT_JOIN variants.facebook_ad_id AS ad_id");
    expect(query).toContain("FORCE INDEX (idx_image_url_status_facebook_ad_id)");
    expect(query).toContain("INNER JOIN facebook_ad AS ads ON ads.id = variants.facebook_ad_id");
    expect(query).toContain("ORDER BY variants.facebook_ad_id DESC LIMIT 20");
    expect(query).not.toContain("image_ocr");
    expect(params).toEqual([0]);
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

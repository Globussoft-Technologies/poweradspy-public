import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { updateAdMedia, NETWORK_CONFIG } = require("../../../src/services/common/services/updateAdMediaService");

describe("common/services/updateAdMediaService > input validation", () => {
  it("rejects missing network", async () => {
    const out = await updateAdMedia({ ad_id: "1", image: "url" }, null);
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(expect.arrayContaining([expect.stringContaining("network")]));
  });

  it("rejects invalid network", async () => {
    const out = await updateAdMedia({ network: "tiktok", ad_id: "1", image: "url" }, null);
    expect(out.code).toBe(400);
  });

  it("rejects missing ad_id", async () => {
    const out = await updateAdMedia({ network: "facebook", image: "url" }, null);
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(expect.arrayContaining([expect.stringContaining("ad_id")]));
  });

  it("rejects request with no media fields", async () => {
    const out = await updateAdMedia({ network: "facebook", ad_id: "1" }, null);
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(expect.arrayContaining([expect.stringContaining("image, thumbnail, video")]));
  });

  it("rejects non-array other_multimedia", async () => {
    const out = await updateAdMedia({ network: "facebook", ad_id: "1", other_multimedia: "url" }, null);
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(expect.arrayContaining([expect.stringContaining("other_multimedia")]));
  });
});

describe("common/services/updateAdMediaService > network config", () => {
  it("has config for all 10 networks", () => {
    expect(Object.keys(NETWORK_CONFIG).sort()).toEqual([
      "facebook", "gdn", "google", "instagram", "linkedin",
      "native", "pinterest", "quora", "reddit", "youtube",
    ].sort());
  });

  it("every config has ad and variant table info", () => {
    for (const [net, cfg] of Object.entries(NETWORK_CONFIG)) {
      expect(cfg.tableAd).toBeTruthy();
      expect(cfg.tableVariant).toBeTruthy();
      expect(cfg.fkVariant).toBeTruthy();
      expect(cfg.colImage).toBeTruthy();
      expect(cfg.colImageOriginal).toBeTruthy();
    }
  });
});

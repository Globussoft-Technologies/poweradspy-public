import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock the repository ──────────────────────────────────────────────
const repoPath = require.resolve("../../../../../src/services/reddit/ocr/repository");
const repo = {
  getImagesUrl: vi.fn(),
  updateStatusMultiple: vi.fn(),
  getVariantByAdId: vi.fn(),
  updateVariant: vi.fn(),
};
require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repo };

// ── Mock nasClient.resolveMediaUrl (deterministic) ───────────────────
const nasPath = require.resolve("../../../../../src/insertion/helpers/nasClient");
require.cache[nasPath] = {
  id: nasPath, filename: nasPath, loaded: true,
  exports: {
    resolveMediaUrl: (p) => (!p ? p : /^https?:\/\//i.test(p) ? p : `https://media.test${p}`),
    storeInNas: vi.fn(),
    DEFAULT_IMAGE: "",
    TYPE_SUBFOLDER: {},
  },
};

const svc = require("../../../../../src/services/reddit/ocr/services/getImageUrlService");
const fakeLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  repo.getImagesUrl.mockReset();
  repo.updateStatusMultiple.mockReset();
});

describe("services/reddit/ocr/getImageUrlService > resolveImageUrl", () => {
  it("leaves absolute URLs untouched", () => {
    expect(svc.resolveImageUrl("https://cdn.x.com/a.jpg")).toBe("https://cdn.x.com/a.jpg");
  });
  it("resolves a relative path through nasClient", () => {
    expect(svc.resolveImageUrl("/reddit/a.jpg")).toBe("https://media.test/reddit/a.jpg");
  });
  it("uses only the segment before '||'", () => {
    expect(svc.resolveImageUrl("/reddit/a.jpg||/reddit/b.jpg")).toBe("https://media.test/reddit/a.jpg");
  });
  it("passes through falsy values", () => {
    expect(svc.resolveImageUrl("")).toBe("");
    expect(svc.resolveImageUrl(null)).toBe(null);
  });
});

describe("services/reddit/ocr/getImageUrlService > getImageUrl", () => {
  it("returns 401 when db.sql missing", async () => {
    const out = await svc.getImageUrl({}, 4, fakeLog);
    expect(out).toEqual({ code: 401, message: "No More Image are present", data: [] });
    expect(repo.getImagesUrl).not.toHaveBeenCalled();
  });

  it("returns 400 when queue empty", async () => {
    repo.getImagesUrl.mockResolvedValue([]);
    const out = await svc.getImageUrl({ sql: {} }, 4, fakeLog);
    expect(out).toEqual({ code: 400, message: "No More Image are present", data: [] });
    expect(repo.updateStatusMultiple).not.toHaveBeenCalled();
  });

  it("status 4 → withOcr true, filter 4, resolves urls, flips to in-progress (2)", async () => {
    repo.getImagesUrl.mockResolvedValue([{ ad_id: 10, image_url: "/r/10.jpg", image_ocr: "x" }]);
    repo.updateStatusMultiple.mockResolvedValue(1);
    const out = await svc.getImageUrl({ sql: {} }, 4, fakeLog);

    expect(repo.getImagesUrl).toHaveBeenCalledWith({}, 4, true);
    expect(repo.updateStatusMultiple).toHaveBeenCalledWith({}, [10], 2);
    expect(out.code).toBe(200);
    expect(out.message).toBe("Image Url fetched successfully");
    expect(out.data).toEqual([{ ad_id: 10, image_url: "https://media.test/r/10.jpg", image_ocr: "x" }]);
  });

  it("status 0 → withOcr false, filter 0", async () => {
    repo.getImagesUrl.mockResolvedValue([{ ad_id: 5, image_url: "/r/5.jpg" }]);
    repo.updateStatusMultiple.mockResolvedValue(1);
    await svc.getImageUrl({ sql: {} }, 0, fakeLog);
    expect(repo.getImagesUrl).toHaveBeenCalledWith({}, 0, false);
    expect(repo.updateStatusMultiple).toHaveBeenCalledWith({}, [5], 2);
  });

  it("any non-4 status maps to filter 0 / withOcr false", async () => {
    repo.getImagesUrl.mockResolvedValue([{ ad_id: 1, image_url: "/r/1.jpg" }]);
    repo.updateStatusMultiple.mockResolvedValue(1);
    await svc.getImageUrl({ sql: {} }, 9, fakeLog);
    expect(repo.getImagesUrl).toHaveBeenCalledWith({}, 0, false);
  });
});

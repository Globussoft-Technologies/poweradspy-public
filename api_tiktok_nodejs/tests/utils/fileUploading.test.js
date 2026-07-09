import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  readdirSpy,
  readFileSpy,
  sharpSpy,
  axiosPostSpy,
  loggerErrorSpy,
  toBufferSpy,
  webpSpy,
} = vi.hoisted(() => {
  const toBufferSpy = vi.fn(async () => Buffer.from([1, 2, 3]));
  const webpSpy = vi.fn(() => ({ toBuffer: toBufferSpy }));
  return {
    readdirSpy: vi.fn(),
    readFileSpy: vi.fn(),
    sharpSpy: vi.fn(() => ({ webp: webpSpy })),
    axiosPostSpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
    toBufferSpy,
    webpSpy,
  };
});

vi.mock("fs", () => ({
  default: { promises: { readdir: readdirSpy, readFile: readFileSpy } },
  promises: { readdir: readdirSpy, readFile: readFileSpy },
}));

vi.mock("sharp", () => ({ default: sharpSpy }));

vi.mock("axios", () => ({ default: { post: axiosPostSpy } }));

vi.mock("../../resources/logs/logger.log.js", () => ({
  default: { error: loggerErrorSpy },
}));

// Newer NAS contract config keys (flat, guarded by config.has()).
const NAS_CONFIG = {
  nas_media_url: "https://media.test",
  nas_origin_url: "http://origin.test:8119",
  nas_media_token: "test-token",
  nas_bucket: "pas-test",
  nas_media_upload_path: "/{bucket}/upload",
  nas_upload_transport: ["http", "httpOrigin"],
  nas_verify_tls: false,
  nas_upload_timeout_ms: 15000,
};

vi.mock("config", () => ({
  default: {
    has: (key) => Object.prototype.hasOwnProperty.call(NAS_CONFIG, key),
    get: (key) => {
      if (Object.prototype.hasOwnProperty.call(NAS_CONFIG, key)) return NAS_CONFIG[key];
      throw new Error(`unstubbed: ${key}`);
    },
  },
}));

let uploadFile;

beforeEach(async () => {
  vi.resetModules();
  readdirSpy.mockReset();
  readFileSpy.mockReset();
  sharpSpy.mockClear();
  webpSpy.mockClear();
  toBufferSpy.mockClear().mockResolvedValue(Buffer.from([1, 2, 3]));
  axiosPostSpy.mockReset();
  loggerErrorSpy.mockClear();
  ({ uploadFile } = await import("../../utils/fileUploading.js"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("utils/fileUploading > uploadFile", () => {
  it("throws + logs 'No files found' when the temp folder is empty", async () => {
    readdirSpy.mockResolvedValueOnce([]);
    await expect(
      uploadFile("/tmp/empty", "ad-1", "facebook", "IMAGE")
    ).rejects.toThrow("No files found in the temp folder.");
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "No files found in the temp folder."
    );
  });

  it("reads file -> sharp.webp({quality:4}) -> POSTs { key, file } with Bearer token -> returns NAS path", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([9, 9]));
    axiosPostSpy.mockResolvedValueOnce({
      data: { ok: true, path: "/pas-test/stream/tiktok/thumbnail/ad-42.webp" },
    });

    const result = await uploadFile("/tmp/x", "ad-42", "tiktok", "THUMBNAIL");

    expect(readdirSpy).toHaveBeenCalledWith("/tmp/x");
    expect(sharpSpy).toHaveBeenCalledWith(Buffer.from([9, 9]));
    expect(webpSpy).toHaveBeenCalledWith({ quality: 4 });

    // Uploads to the 'http' base first, with the bucket-substituted upload path + Bearer token.
    const [calledUrl, , calledOpts] = axiosPostSpy.mock.calls[0];
    expect(calledUrl).toBe("https://media.test/pas-test/upload");
    expect(calledOpts.headers.Authorization).toBe("Bearer test-token");
    expect(result).toBe("/pas-test/stream/tiktok/thumbnail/ad-42.webp");
  });

  it("returns the deterministic predicted path when NAS answers 200 without a path", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([1]));
    axiosPostSpy.mockResolvedValueOnce({ status: 200, data: {} });

    const result = await uploadFile("/tmp/x", "ad9", "tiktok", "THUMBNAIL");
    expect(result).toMatch(
      /^\/pas-test\/stream\/tiktok\/thumbnail\/\d{6}\/ad9\.webp$/
    );
  });

  it("falls back to httpOrigin when the http transport returns a non-retryable status", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([1]));
    axiosPostSpy
      .mockResolvedValueOnce({ status: 400, data: { ok: false } }) // http → non-retryable
      .mockResolvedValueOnce({ status: 200, data: { ok: true, path: "/from/origin.webp" } });

    const result = await uploadFile("/tmp/x", "ad1", "tiktok", "THUMBNAIL");

    expect(axiosPostSpy).toHaveBeenCalledTimes(2);
    expect(axiosPostSpy.mock.calls[0][0]).toBe("https://media.test/pas-test/upload");
    expect(axiosPostSpy.mock.calls[1][0]).toBe("http://origin.test:8119/pas-test/upload");
    expect(result).toBe("/from/origin.webp");
  });

  it("retries a transient status on the same transport before failing over", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([1]));
    axiosPostSpy
      .mockResolvedValueOnce({ status: 503, data: { ok: false } }) // http attempt 1 (retryable)
      .mockResolvedValueOnce({ status: 200, data: { ok: true, path: "/ok.webp" } }); // http attempt 2

    const result = await uploadFile("/tmp/x", "ad1", "tiktok", "THUMBNAIL");

    expect(axiosPostSpy).toHaveBeenCalledTimes(2);
    expect(result).toBe("/ok.webp");
  });

  it("throws + logs when every transport is exhausted", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([1]));
    axiosPostSpy.mockResolvedValue({ status: 500, data: { ok: false } });

    await expect(
      uploadFile("/tmp/x", "ad1", "tiktok", "THUMBNAIL")
    ).rejects.toThrow(/NAS upload failed/);
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("logs and rethrows a hard network error from the whole chain", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([1]));
    axiosPostSpy.mockRejectedValue(new Error("nas-down"));

    await expect(
      uploadFile("/tmp/x", "a", "tiktok", "THUMBNAIL")
    ).rejects.toThrow(/NAS upload failed/);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error uploading file:",
      expect.stringContaining("nas-down")
    );
  });
});

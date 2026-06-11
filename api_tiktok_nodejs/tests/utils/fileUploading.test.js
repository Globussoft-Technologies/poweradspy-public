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

vi.mock("config", () => ({
  default: {
    get: (key) => {
      if (key === "nas_url") return "https://nas.test/upload";
      if (key === "nas_mode") return "PROD";
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

  it("reads file -> sharp.webp({quality:4}) -> POSTs to nas_url -> returns response.data.data on success", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([9, 9]));
    axiosPostSpy.mockResolvedValueOnce({
      data: { data: "/nas/path/ad.webp" },
    });

    const result = await uploadFile("/tmp/x", "ad-42", "tiktok", "VIDEO");

    expect(readdirSpy).toHaveBeenCalledWith("/tmp/x");
    expect(sharpSpy).toHaveBeenCalledWith(Buffer.from([9, 9]));
    expect(webpSpy).toHaveBeenCalledWith({ quality: 4 });
    expect(axiosPostSpy).toHaveBeenCalledWith(
      "https://nas.test/upload",
      expect.anything(),
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result).toBe("/nas/path/ad.webp");
  });

  it("returns undefined when response.data lacks a .data field (optional chaining)", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([1]));
    axiosPostSpy.mockResolvedValueOnce({ data: {} });
    const result = await uploadFile("/tmp/x", "a", "n", "t");
    expect(result).toBeUndefined();
  });

  it("logs and rethrows when axios.post rejects with an Error (has .message)", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([1]));
    const err = new Error("nas-down");
    axiosPostSpy.mockRejectedValueOnce(err);
    await expect(
      uploadFile("/tmp/x", "a", "n", "t")
    ).rejects.toThrow("nas-down");
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error uploading file:",
      "nas-down"
    );
  });

  it("logs the raw error (no .message) when caught value is not an Error", async () => {
    readdirSpy.mockResolvedValueOnce(["ad.png"]);
    readFileSpy.mockResolvedValueOnce(Buffer.from([1]));
    axiosPostSpy.mockRejectedValueOnce("string-error");
    await expect(
      uploadFile("/tmp/x", "a", "n", "t")
    ).rejects.toBe("string-error");
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error uploading file:",
      "string-error"
    );
  });
});

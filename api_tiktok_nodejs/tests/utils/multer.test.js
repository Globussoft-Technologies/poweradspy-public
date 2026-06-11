import { describe, it, expect, vi, beforeEach } from "vitest";

const { S3ClientCtor, multerSpy, multerS3Spy, configValues } = vi.hoisted(
  () => ({
    S3ClientCtor: vi.fn(function () {}),
    multerSpy: vi.fn(() => ({ __upload: true })),
    multerS3Spy: vi.fn(() => ({ __storage: true })),
    configValues: {
      region: "ap-south-1",
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secret",
      bucketName: "poweradspy-tiktok-test",
    },
  })
);

vi.mock("@aws-sdk/client-s3", () => ({ S3Client: S3ClientCtor }));

vi.mock("multer", () => ({ default: multerSpy }));

vi.mock("multer-s3", () => ({ default: multerS3Spy }));

vi.mock("config", () => ({
  default: {
    get: (key) => {
      if (!(key in configValues)) {
        throw new Error(`config key not stubbed: ${key}`);
      }
      return configValues[key];
    },
  },
}));

let upload;

beforeEach(async () => {
  vi.resetModules();
  S3ClientCtor.mockClear();
  multerSpy.mockClear();
  multerS3Spy.mockClear();
  ({ default: upload } = await import("../../utils/multer.js"));
});

describe("utils/multer > module shape", () => {
  it("exports the multer instance returned by multer()", () => {
    expect(upload).toEqual({ __upload: true });
  });
});

describe("utils/multer > S3 client construction", () => {
  it("constructs S3Client with region + accessKeyId/secretAccessKey from config", () => {
    expect(S3ClientCtor).toHaveBeenCalledTimes(1);
    expect(S3ClientCtor).toHaveBeenCalledWith({
      region: "ap-south-1",
      credentials: {
        accessKeyId: "AKIA-TEST",
        secretAccessKey: "secret",
      },
    });
  });
});

describe("utils/multer > multer-s3 storage configuration", () => {
  it("passes the s3 instance and the configured bucket", () => {
    expect(multerS3Spy).toHaveBeenCalledTimes(1);
    const opts = multerS3Spy.mock.calls[0][0];
    expect(opts.s3).toBeInstanceOf(S3ClientCtor);
    expect(opts.bucket).toBe("poweradspy-tiktok-test");
  });

  it("passes the storage config to multer()", () => {
    expect(multerSpy).toHaveBeenCalledTimes(1);
    expect(multerSpy.mock.calls[0][0]).toEqual({
      storage: { __storage: true },
    });
  });

  describe("metadata callback", () => {
    it("calls back with { fieldName: file.fieldname }", () => {
      const opts = multerS3Spy.mock.calls[0][0];
      const cb = vi.fn();
      opts.metadata({}, { fieldname: "creative" }, cb);
      expect(cb).toHaveBeenCalledWith(null, { fieldName: "creative" });
    });
  });

  describe("key callback", () => {
    it("calls back with `${Date.now()}_${file.originalname}`", () => {
      const opts = multerS3Spy.mock.calls[0][0];
      const cb = vi.fn();
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
      try {
        opts.key({}, { originalname: "ad.mp4" }, cb);
        expect(cb).toHaveBeenCalledWith(null, "1700000000000_ad.mp4");
      } finally {
        dateSpy.mockRestore();
      }
    });
  });
});

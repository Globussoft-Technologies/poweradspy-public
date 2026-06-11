import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);

// Mock axios BEFORE the SUT loads
const axiosPath = require.resolve("axios");
const axiosGet = vi.fn();
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { get: axiosGet, default: { get: axiosGet } },
};

const { proxyTikTokVideo, isAllowedTikTokCdnHost } = require(
  "../../../../src/services/tiktok/controllers/videoProxyController"
);

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.setHeader = vi.fn(() => res);
  res.end = vi.fn(() => res);
  res.write = vi.fn(() => true);
  res.on = vi.fn(() => res);
  res.once = vi.fn(() => res);
  res.emit = vi.fn(() => true);
  res.headersSent = false;
  return res;
}

function makeUpstream({ status = 200, headers = {}, body = "bytes" } = {}) {
  const stream = Readable.from([Buffer.from(body)]);
  return { status, headers, data: stream };
}

beforeEach(() => {
  axiosGet.mockReset();
  log.info.mockClear(); log.warn.mockClear(); log.error.mockClear();
});

describe("videoProxyController > isAllowedTikTokCdnHost", () => {
  it("accepts canonical TikTok CDN hosts", () => {
    expect(isAllowedTikTokCdnHost("v16.tiktokcdn.com")).toBe(true);
    expect(isAllowedTikTokCdnHost("p16-sign-va.tiktokcdn-us.com")).toBe(true);
    expect(isAllowedTikTokCdnHost("v9-default.byteoversea.com")).toBe(true);
    expect(isAllowedTikTokCdnHost("api.tiktokv.com")).toBe(true);
    expect(isAllowedTikTokCdnHost("tiktokcdn.com")).toBe(true);
  });
  it("rejects look-alike or unrelated hosts", () => {
    expect(isAllowedTikTokCdnHost("tiktokcdn.com.evil.com")).toBe(false);
    expect(isAllowedTikTokCdnHost("eviltiktokcdn.com")).toBe(false);
    expect(isAllowedTikTokCdnHost("example.com")).toBe(false);
    expect(isAllowedTikTokCdnHost("")).toBe(false);
    expect(isAllowedTikTokCdnHost(null)).toBe(false);
  });
});

describe("videoProxyController > validation", () => {
  it("400 when url query param missing", async () => {
    const res = mockRes();
    await proxyTikTokVideo({ query: {}, headers: {} }, res, log);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ code: 400, message: "url query param is required" });
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it("400 when url is not a valid URL", async () => {
    const res = mockRes();
    await proxyTikTokVideo({ query: { url: "not a url" }, headers: {} }, res, log);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ code: 400, message: "url is not a valid URL" });
  });

  it("400 when url has non-http(s) protocol", async () => {
    const res = mockRes();
    await proxyTikTokVideo({ query: { url: "file:///etc/passwd" }, headers: {} }, res, log);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ code: 400, message: "url must be http(s)" });
  });

  it("403 when host is outside the TikTok allowlist", async () => {
    const res = mockRes();
    await proxyTikTokVideo({ query: { url: "https://evil.example.com/x.mp4" }, headers: {} }, res, log);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ code: 403, message: "host not allowed" });
    expect(log.warn).toHaveBeenCalled();
    expect(axiosGet).not.toHaveBeenCalled();
  });
});

describe("videoProxyController > streaming", () => {
  it("streams upstream body to response and forwards whitelisted headers", async () => {
    const upstream = makeUpstream({
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": "5",
        "accept-ranges": "bytes",
        "etag": "abc",
        "set-cookie": "leak=1", // not in forward list → must NOT propagate
      },
      body: "hello",
    });
    axiosGet.mockResolvedValueOnce(upstream);

    const res = mockRes();
    await proxyTikTokVideo(
      { query: { url: "https://v16.tiktokcdn.com/video/tos/x.mp4" }, headers: {} },
      res, log
    );

    expect(axiosGet).toHaveBeenCalledTimes(1);
    const [calledUrl, cfg] = axiosGet.mock.calls[0];
    expect(calledUrl).toBe("https://v16.tiktokcdn.com/video/tos/x.mp4");
    expect(cfg.responseType).toBe("stream");
    expect(cfg.decompress).toBe(false);
    expect(cfg.validateStatus()).toBe(true);
    expect(cfg.headers.Range).toBeUndefined();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith("content-type", "video/mp4");
    expect(res.setHeader).toHaveBeenCalledWith("content-length", "5");
    expect(res.setHeader).toHaveBeenCalledWith("accept-ranges", "bytes");
    expect(res.setHeader).toHaveBeenCalledWith("etag", "abc");
    const headerNames = res.setHeader.mock.calls.map((c) => c[0]);
    expect(headerNames).not.toContain("set-cookie");

    // Wait one tick so the piped stream finishes flushing
    await new Promise((r) => setImmediate(r));
  });

  it("forwards client Range header upstream and propagates 206 + content-range", async () => {
    const upstream = makeUpstream({
      status: 206,
      headers: { "content-type": "video/mp4", "content-range": "bytes 0-9/100" },
    });
    axiosGet.mockResolvedValueOnce(upstream);

    const res = mockRes();
    await proxyTikTokVideo(
      { query: { url: "https://v16.tiktokcdn.com/x.mp4" }, headers: { range: "bytes=0-9" } },
      res, log
    );

    expect(axiosGet.mock.calls[0][1].headers.Range).toBe("bytes=0-9");
    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.setHeader).toHaveBeenCalledWith("content-range", "bytes 0-9/100");
  });

  it("502 when upstream request throws", async () => {
    axiosGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = mockRes();
    await proxyTikTokVideo(
      { query: { url: "https://v16.tiktokcdn.com/x.mp4" }, headers: {} },
      res, log
    );
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ code: 502, message: "upstream fetch failed" });
    expect(log.error).toHaveBeenCalled();
  });

  it("502 + ends response when upstream stream emits error after pipe begins", async () => {
    // Build an upstream whose stream emits 'error' synchronously on next tick.
    const stream = new Readable({ read() {} });
    axiosGet.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "video/mp4" },
      data: stream,
    });

    const res = mockRes();
    res.headersSent = false;
    await proxyTikTokVideo(
      { query: { url: "https://v16.tiktokcdn.com/x.mp4" }, headers: {} },
      res, log
    );

    stream.emit("error", new Error("upstream blew up"));
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.end).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });
});

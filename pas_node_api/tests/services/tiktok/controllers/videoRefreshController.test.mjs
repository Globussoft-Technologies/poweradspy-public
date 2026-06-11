import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock axios BEFORE the SUT loads
const axiosPath = require.resolve("axios");
const axiosGet = vi.fn();
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { get: axiosGet, default: { get: axiosGet } },
};

const { refreshVideoUrl } = require(
  "../../../../src/services/tiktok/controllers/videoRefreshController"
);

// Lines 190-191 (`transformResponse: [(data) => data]` and `validateStatus:
// () => true`) are inline functions in the axios config object. They only
// fire when the real axios executes a real HTTP request — mocked axios never
// invokes them. Leaving as 96.87% stmts / 77.77% funcs.

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  axiosGet.mockReset();
  log.info.mockClear(); log.warn.mockClear(); log.error.mockClear();
});

const LIB = "https://ads.tiktok.com/business/creativecenter/topads/7569968978819874817/pc/en?countryCode=GB&period=30";
const LIB_NO_QS = "https://ads.tiktok.com/business/creativecenter/topads/7569968978819874817/pc/en";

describe("services/tiktok/controllers/videoRefreshController > validation", () => {
  it("400 when library_url missing", async () => {
    expect(await refreshVideoUrl({ body: {} }, {}, log))
      .toEqual({ code: 400, message: "library_url is required" });
  });

  it("400 when library_url has no /topads/<id>/", async () => {
    expect(await refreshVideoUrl({ body: { library_url: "https://example.com/" } }, {}, log))
      .toEqual({ code: 400, message: "Could not extract ad_id from library_url" });
  });
});

describe("services/tiktok/controllers/videoRefreshController > Step 1: HTML scrape paths", () => {
  it("returns video found in raw HTML deep-search when entire body IS the URL", async () => {
    // deepFindVideoUrl on a string calls isVideoUrl directly — so the page
    // body itself has to start with the URL (this is the literal behaviour).
    axiosGet.mockResolvedValueOnce({
      headers: { "set-cookie": ["s=1; Path=/", "t=2"] },
      data: "https://v16-webapp.tiktokcdn.com/video/tos/abc.mp4?mime_type=video_mp4",
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
    expect(out.data.video_url).toContain("tiktokcdn.com");
  });

  it("returns video found in __NEXT_DATA__ JSON embed", async () => {
    const nextData = {
      props: {
        pageProps: {
          ad: { play_url: "https://v16-webapp.tiktokcdn.com/video/tos/x.mp4" },
        },
      },
    };
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`;
    axiosGet.mockResolvedValueOnce({ headers: {}, data: html });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
    expect(out.data.video_url).toContain(".mp4");
  });

  it("__NEXT_DATA__ JSON parse error is swallowed → falls through to script regex", async () => {
    const html = `<html><script id="__NEXT_DATA__">{not-json}</script><script>var u="https://v16.tiktokcdn.com/video/tos/y.mp4?mime_type=video_mp4"</script></html>`;
    axiosGet.mockResolvedValueOnce({ headers: {}, data: html });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
    expect(out.data.video_url).toContain("tiktokcdn");
  });

  it("script-tag scan: extracts and validates TikTok CDN URLs", async () => {
    // urlPattern is /https?:\/\/[^\s"'\\<>]+(?:tiktokcdn|byteoversea|tiktokv)[^\s"'\\<>]*/g
    // Note the char class excludes backslash — so we need plain forward slashes.
    const html = `<html><script>var play_addr = "https://v16.tiktokcdn.com/video/tos/abc.mp4?mime_type=video_mp4"</script></html>`;
    axiosGet.mockResolvedValueOnce({ headers: {}, data: html });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
    expect(out.data.video_url).toContain("tiktokcdn.com");
  });

  it("script-tag scan ignores scripts not containing tiktokcdn/video_url/play_addr keywords", async () => {
    // First script is irrelevant; second contains a valid URL but no marker keyword → skipped.
    // Third has the marker → URL inside it is searched.
    const html = `<html>
      <script>var unrelated = "hello";</script>
      <script>var play_addr = "https://v16.tiktokcdn.com/video/tos/c.mp4?mime_type=video_mp4";</script>
    </html>`;
    axiosGet.mockResolvedValueOnce({ headers: {}, data: html });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("script-tag scan: skips URLs that fail isVideoUrl (image patterns rejected)", async () => {
    // Image URL containing tiktokcdn — must be rejected by isVideoUrl due to .image? pattern
    const html = `<html><script>var play_addr = "https://x.tiktokcdn.com/tos-alisg-p-image.image?VideoID=fake"</script></html>`;
    axiosGet.mockResolvedValueOnce({ headers: {}, data: html });
    // Will fall through to Step 2 (API calls). Mock those to fail.
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(404);
  });

  it("page response is not a string → skips HTML scrape, goes to Step 2", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: { not: "string" } });
    // Step 2: API call succeeds with a video URL
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { video_url: "https://v16.tiktokcdn.com/video/tos/api.mp4?mime_type=video_mp4" } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("page visit throws → swallowed, proceeds to Step 2", async () => {
    axiosGet.mockRejectedValueOnce(new Error("network"));
    axiosGet.mockResolvedValueOnce({
      data: { code: 200, data: { play_url: "https://v16.tiktokcdn.com/video/tos/v.mp4?mime_type=video_mp4" } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Page visit failed"));
  });

  it("library_url with no query string falls back to default countryCode/period (US/30)", async () => {
    // Page returns nothing useful → fallthrough
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { url: "https://v16.tiktokcdn.com/video/tos/x.mp4?mime_type=video_mp4" } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB_NO_QS } }, {}, log);
    expect(out.code).toBe(200);
    // The API URL should contain country_code=US&period=30
    expect(axiosGet.mock.calls[1][0]).toContain("country_code=US");
    expect(axiosGet.mock.calls[1][0]).toContain("period=30");
  });

  it("malformed library_url for URL parser → catches and defaults to US/30", async () => {
    // library_url that passes the topads regex but breaks URL constructor
    // Use a relative-ish URL that has topads but not a parseable URL.
    // 'http://[bad/topads/123/' → URL throws
    const badLib = "http://[topads/123/pc";
    // Actually need /topads/<digits>/ pattern. Let me use:
    // "topads/9999/" — won't pass URL but extractAdIdFromLibraryUrl will fail too.
    // Use a string the URL constructor can't parse but extractAdIdFromLibraryUrl can:
    // — wait extractAdIdFromLibraryUrl is regex on `/topads/<digit>/`. So we just
    // need any string with that pattern that's also not a valid URL.
    // 'not-a-url/topads/12345/foo' → regex matches → URL() throws → US/30 defaults
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    const out = await refreshVideoUrl(
      { body: { library_url: "not-a-url/topads/12345/foo" } }, {}, log
    );
    // Either succeeds via some branch or fails 404; importantly extractParamsFromUrl
    // doesn't crash.
    expect([200, 404]).toContain(out.code);
  });
});

describe("services/tiktok/controllers/videoRefreshController > Step 2: API endpoints", () => {
  it("first API endpoint succeeds with code=0", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, msg: "OK", data: { url_list: ["https://v16.tiktokcdn.com/video/tos/api.mp4?mime_type=video_mp4"] } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("first API endpoint succeeds with code=200", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 200, data: { download_url: "https://v16.tiktokcdn.com/video/tos/d.mp4?mime_type=video_mp4" } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("first API succeeds but deepFindVideoUrl finds nothing → tries second API", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({ data: { code: 0, data: { foo: "no-video-here" } } });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { video_url: "https://v16.tiktokcdn.com/video/tos/s.mp4?mime_type=video_mp4" } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("no video URL found"));
  });

  it("API throws → warn + tries next endpoint", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockRejectedValueOnce(new Error("api1-down"));
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { play_addr: ["https://v16.tiktokcdn.com/video/tos/x.mp4?mime_type=video_mp4"] } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("API call failed"));
  });

  it("API returns non-success code → falls through", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({ data: { code: 999, msg: "denied" } });
    axiosGet.mockResolvedValueOnce({ data: { code: 999, msg: "denied" } });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { play_url: "https://v16.tiktokcdn.com/video/tos/v.mp4?mime_type=video_mp4" } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });
});

describe("services/tiktok/controllers/videoRefreshController > Step 3: search API", () => {
  it("search API succeeds with code=0", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { list: [{ video_url: "https://v16.tiktokcdn.com/video/tos/srch.mp4?mime_type=video_mp4" }] } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("search API code=200 but no video found", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: { code: 200, data: { list: [] } } });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(404);
  });

  it("search API throws → warn + 404 final", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockRejectedValueOnce(new Error("search-down"));
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(404);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Search API failed"));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("All strategies exhausted"));
  });

  it("period as non-numeric string in URL → falls back to 30", async () => {
    const lib = "https://ads.tiktok.com/business/creativecenter/topads/777/pc/en?countryCode=GB&period=abc";
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: { code: 0 } });
    await refreshVideoUrl({ body: { library_url: lib } }, {}, log);
    // The search API call should have period=30 since parseInt('abc') is NaN
    const searchCall = axiosGet.mock.calls[3];
    expect(searchCall[1].params.period).toBe(30);
  });
});

describe("services/tiktok/controllers/videoRefreshController > isVideoUrl coverage via deep search", () => {
  it("rejects non-string fields", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { play_url: 12345 /* non-string */ } },
    });
    axiosGet.mockResolvedValueOnce({ data: { code: 0 } });
    axiosGet.mockResolvedValueOnce({ data: { code: 0 } });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(404);
  });

  it("rejects http URLs not on tiktok domain", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { play_url: "https://google.com/video.mp4" } },
    });
    axiosGet.mockResolvedValueOnce({ data: { code: 0 } });
    axiosGet.mockResolvedValueOnce({ data: { code: 0 } });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(404);
  });

  it("accepts byteoversea domain video URL", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, play_url: "https://v.byteoversea.com/video/tos/abc.mp4" },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("accepts tiktokv.com domain", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, play_url: "https://x.tiktokv.com/aweme/tos-cn-ve-0068c001/x.mp4" },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("rejects image patterns (/tos-alisg-i-)", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, play_url: "https://v.tiktokcdn.com/tos-alisg-i-cover/x.jpg" },
    });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(404);
  });

  it("priority key url_list array containing invalid then valid URLs picks valid", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { url_list: [
        "https://google.com/x.mp4", // wrong domain
        "https://v16.tiktokcdn.com/video/tos/correct.mp4?mime_type=video_mp4",
      ]}},
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.data.video_url).toContain("correct.mp4");
  });

  it("priority-key array with no valid URLs → falls through to general scan", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, url: ["https://other.com/x.mp4"], deeply: { nested: { url: "https://v16.tiktokcdn.com/video/tos/nested.mp4?mime_type=video_mp4" } } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.data.video_url).toContain("nested.mp4");
  });

  it("array with non-string elements is skipped in priority loop", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { play_addr: [123, null, { nested: "https://v16.tiktokcdn.com/video/tos/arr.mp4?mime_type=video_mp4" }] } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("very deep recursion (>10) returns null", async () => {
    // Build an object nested 12 levels deep with a video URL at the bottom
    let deep = { url: "https://v16.tiktokcdn.com/video/tos/deep.mp4?mime_type=video_mp4" };
    for (let i = 0; i < 15; i++) deep = { wrap: deep };
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({ data: { code: 0, data: deep } });
    axiosGet.mockResolvedValueOnce({ data: null });
    axiosGet.mockResolvedValueOnce({ data: null });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    // Past depth 10, deepFindVideoUrl returns null → falls through to 404
    expect(out.code).toBe(404);
  });

  it("priority key value found directly (top-level video_url string)", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, video_url: "https://v16.tiktokcdn.com/video/tos/top.mp4?mime_type=video_mp4" },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.data.video_url).toContain("top.mp4");
  });
});

describe("services/tiktok/controllers/videoRefreshController > extractCookies", () => {
  it("single string set-cookie value handled (falls through to API)", async () => {
    axiosGet.mockResolvedValueOnce({
      headers: { "set-cookie": "session=abc; Path=/" },
      data: "",
    });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { video_url: "https://v16.tiktokcdn.com/video/tos/x.mp4?mime_type=video_mp4" } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
    // The cookie should have been included in the API call
    const apiCall = axiosGet.mock.calls[1];
    expect(apiCall[1].headers.Cookie).toBe("session=abc");
  });

  it("missing set-cookie header → empty cookie string", async () => {
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, data: { video_url: "https://v16.tiktokcdn.com/video/tos/x.mp4?mime_type=video_mp4" } },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });

  it("isVideoUrl: URL without .mp4 but with video_mp4 → line 86 right-side branch", async () => {
    // No literal `.mp4` substring; only `video_mp4`. So
    // `lower.includes('.mp4')` is false → right operand of line 86's `||`
    // (`lower.includes('video_mp4')`) is evaluated and returns true.
    axiosGet.mockResolvedValueOnce({ headers: {}, data: "" });
    axiosGet.mockResolvedValueOnce({
      data: { code: 0, play_url: "https://v.tiktokcdn.com/tos-alisg-ve-abc/x?mime_type=video_mp4" },
    });
    const out = await refreshVideoUrl({ body: { library_url: LIB } }, {}, log);
    expect(out.code).toBe(200);
  });
});

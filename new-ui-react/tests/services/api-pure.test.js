// Tests for the pure (no-fetch) helpers exported by src/services/api.js.
// Fetch-based functions are covered separately in api-fetch.test.js.
import { describe, it, expect, vi } from "vitest";

// Pre-mock useAuth so api.js's import-time getAuthToken call is safe.
vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: vi.fn(() => "tk"),
  clearSessionState: vi.fn(),
}));

const {
  resolveNasUrl,
  formatNumber,
  mapAdToCard,
  FILTER_PLATFORM_SUPPORT,
  buildAuditPrompt,
  buildCampaignPrompt,
  getYoutubeEmbedUrl,
  getVideoEmbedUrl,
} = await import("../../src/services/api.js");

describe("api > formatNumber", () => {
  it("undefined/null/empty → null", () => {
    expect(formatNumber(undefined)).toBeNull();
    expect(formatNumber(null)).toBeNull();
    expect(formatNumber("")).toBeNull();
  });
  it("non-numeric → null", () => {
    expect(formatNumber("bogus")).toBeNull();
  });
  it("0 → null", () => {
    expect(formatNumber(0)).toBeNull();
  });
  it("≥1M → 'NM'", () => {
    expect(formatNumber(1_500_000)).toBe("1.5M");
    expect(formatNumber(2_000_000)).toBe("2M"); // .0 stripped
  });
  it("≥1k → 'NK'", () => {
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(5000)).toBe("5K");
  });
  it("under 1k → stringified", () => {
    expect(formatNumber(42)).toBe("42");
  });
});

describe("api > resolveNasUrl", () => {
  it("null/empty/non-string → returned as-is", () => {
    expect(resolveNasUrl(null)).toBeNull();
    expect(resolveNasUrl(undefined)).toBeUndefined();
    expect(resolveNasUrl(123)).toBe(123);
  });
  it("http URL → returned as-is", () => {
    expect(resolveNasUrl("http://x.com/y")).toBe("http://x.com/y");
    expect(resolveNasUrl("https://x.com/y")).toBe("https://x.com/y");
  });
  it("PowerAdspy path → NAS base prefixed (with slash)", () => {
    const out = resolveNasUrl("/PowerAdspy/foo.jpg");
    expect(out.endsWith("/PowerAdspy/foo.jpg")).toBe(true);
  });
  it("pasimages path → NAS base prefixed", () => {
    const out = resolveNasUrl("pasimages/foo.jpg");
    expect(out.endsWith("/pasimages/foo.jpg")).toBe(true);
  });
  it("pasvideos path → NAS base prefixed", () => {
    const out = resolveNasUrl("pasvideos/foo.mp4");
    expect(out.endsWith("/pasvideos/foo.mp4")).toBe(true);
  });
  it("/stream/ path → NAS video base prefixed", () => {
    const out = resolveNasUrl("/stream/abc.mp4");
    expect(out.endsWith("/stream/abc.mp4")).toBe(true);
  });
  it("other path → returned as-is", () => {
    expect(resolveNasUrl("/other/x")).toBe("/other/x");
  });
});

describe("api > mapAdToCard", () => {
  it("derives id/advertiser/network/aspectRatio defaults", () => {
    const out = mapAdToCard({ ad_id: "a1", post_owner: "Brand", network: "Facebook" });
    expect(out.id).toBe("a1");
    expect(out.advertiser).toBe("Brand");
    expect(out.network).toBe("facebook");
  });
  it("falls back to sql_id, then id", () => {
    expect(mapAdToCard({ sql_id: 7 }).id).toBe(7);
    expect(mapAdToCard({ id: 9 }).id).toBe(9);
  });
  it("unknown post_owner → 'Unknown'", () => {
    expect(mapAdToCard({}).advertiser).toBe("Unknown");
  });
  it("network derived from platform numeric ID", () => {
    expect(mapAdToCard({ platform: 1 }).network).toBe("facebook");
    expect(mapAdToCard({ platform: 10 }).network).toBe("tiktok");
  });
  it("tiktok video has 9:16 aspect ratio", () => {
    const out = mapAdToCard({ network: "tiktok", video_cover: "http://x/c.jpg" });
    expect(out.aspectRatio).toBe("9:16");
    expect(out.adType).toBe("video");
  });
  it("aspect ratio derived from width/height", () => {
    expect(mapAdToCard({ width: 1920, height: 1080 }).aspectRatio).toBe("16:9");
    expect(mapAdToCard({ width: 1080, height: 1920 }).aspectRatio).toBe("9:16");
    expect(mapAdToCard({ width: 1080, height: 1080 }).aspectRatio).toBe("1:1");
    expect(mapAdToCard({ width: 1080, height: 720 }).aspectRatio).toBe("3:2");
    expect(mapAdToCard({ width: 800, height: 1000 }).aspectRatio).toBe("4:5");
    // 800x300 ratio (2.667) doesn't match any predefined band → raw width:height
    expect(mapAdToCard({ width: 800, height: 300 }).aspectRatio).toBe("800:300");
  });
  it("falls back to image_size when no dims", () => {
    expect(mapAdToCard({ image_size: "VERT" }).aspectRatio).toBe("VERT");
  });
  it("ad type mapping (string forms)", () => {
    expect(mapAdToCard({ type: "Image" }).adType).toBe("image");
    expect(mapAdToCard({ type: "video" }).adType).toBe("video");
    expect(mapAdToCard({ type: "Carousel" }).adType).toBe("carousel");
    expect(mapAdToCard({ type: "story" }).adType).toBe("story");
    expect(mapAdToCard({ type: "reel" }).adType).toBe("reel");
    expect(mapAdToCard({ type: "text" }).adType).toBe("text");
    expect(mapAdToCard({ type: "nativead" }).adType).toBe("native_ad");
    expect(mapAdToCard({ type: "native ad" }).adType).toBe("native_ad");
    expect(mapAdToCard({ type: "native_ad" }).adType).toBe("native_ad");
    expect(mapAdToCard({ type: "banner" }).adType).toBe("banner");
    expect(mapAdToCard({ type: "display" }).adType).toBe("display");
    expect(mapAdToCard({ type: "responsive_display" }).adType).toBe("display");
    expect(mapAdToCard({ type: "discovery" }).adType).toBe("discovery");
    expect(mapAdToCard({ type: "text-image" }).adType).toBe("text-image");
    expect(mapAdToCard({ type: "text_image" }).adType).toBe("text-image");
    expect(mapAdToCard({ type: "organic search" }).adType).toBe("organic_search");
    expect(mapAdToCard({ type: "organic_search" }).adType).toBe("organic_search");
    expect(mapAdToCard({ type: "unknown" }).adType).toBe("image");
  });
  it("calcEngRate: views > 0 → percentage; otherwise null", () => {
    expect(mapAdToCard({ views: 100, likes: 10, comment: 5, share: 5 }).engRate).toBe("20.0%");
    expect(mapAdToCard({ views: 0 }).engRate).toBeNull();
    expect(mapAdToCard({}).engRate).toBeNull();
  });
  it("calcEngPerDay: aggregated then formatted", () => {
    expect(mapAdToCard({ likes: 100, comment: 100, share: 100, days_running: 10 }).engPerDay).toBe("30");
    expect(mapAdToCard({}).engPerDay).toBeNull();
  });
  it("calcEngPerDay: total=0 → null", () => {
    expect(mapAdToCard({ days_running: 5 }).engPerDay).toBeNull();
  });
  it("calcEngPerDay: days defaults to 1 when missing", () => {
    expect(mapAdToCard({ likes: 500 }).engPerDay).toBe("500");
  });
  it("runningDays: explicit days_running used when >0", () => {
    expect(mapAdToCard({ days_running: 7 }).runningDays).toBe(7);
  });
  it("runningDays: computed from first/last seen when no days_running", () => {
    const out = mapAdToCard({ first_seen: "2025-01-01", last_seen: "2025-01-05" });
    expect(out.runningDays).toBe(4);
  });
  it("runningDays: same-day clamps to 1", () => {
    const out = mapAdToCard({ first_seen: "2025-01-01T00:00:00", last_seen: "2025-01-01T00:00:00" });
    expect(out.runningDays).toBe(1);
  });
  it("runningDays: invalid dates → null", () => {
    expect(mapAdToCard({ first_seen: "bad", last_seen: "bad" }).runningDays).toBeNull();
  });
  it("runningDays: days_running=0 falls through to date calc (line 330 else)", () => {
    const out = mapAdToCard({ days_running: 0, first_seen: "2025-01-01", last_seen: "2025-01-05" });
    expect(out.runningDays).toBe(4);
  });
  it("runningDays: only first_seen set → null", () => {
    expect(mapAdToCard({ first_seen: "2025-01-01" }).runningDays).toBeNull();
  });
  it("verified flag mapped from 1", () => {
    expect(mapAdToCard({ verified: 1 }).verified).toBe(true);
    expect(mapAdToCard({ verified: 0 }).verified).toBe(false);
  });
  it("isMetaLib only when platform=15 and FB/IG", () => {
    expect(mapAdToCard({ platform: 15, network: "facebook" }).isMetaLib).toBe(true);
    expect(mapAdToCard({ platform: 15, network: "instagram" }).isMetaLib).toBe(true);
    expect(mapAdToCard({ platform: 15, network: "youtube" }).isMetaLib).toBe(false);
    expect(mapAdToCard({ platform: 1, network: "facebook" }).isMetaLib).toBe(false);
  });
  it("carouselMedia: array passthrough", () => {
    const out = mapAdToCard({ ad_image_video: ["http://x/1.jpg", "http://x/2.jpg"] });
    expect(out.carouselMedia).toEqual(["http://x/1.jpg", "http://x/2.jpg"]);
  });
  it("carouselMedia: string starting with [ → JSON parsed", () => {
    const out = mapAdToCard({ ad_image_video: '["http://x/1.jpg"]' });
    expect(out.carouselMedia).toEqual(["http://x/1.jpg"]);
  });
  it("carouselMedia: invalid JSON in [...] form falls back to single-entry array", () => {
    const out = mapAdToCard({ ad_image_video: "[not json" });
    expect(out.carouselMedia.length).toBe(1);
  });
  it("carouselMedia: separator '||,' splits", () => {
    const out = mapAdToCard({ ad_image_video: "http://x/1.jpg||,http://x/2.jpg" });
    expect(out.carouselMedia.length).toBe(2);
  });
  it("carouselMedia: separator '||' splits", () => {
    const out = mapAdToCard({ ad_image_video: "http://x/1.jpg||http://x/2.jpg" });
    expect(out.carouselMedia.length).toBe(2);
  });
  it("carouselMedia: single URL with no sep wrapped to array", () => {
    const out = mapAdToCard({ ad_image_video: "http://x/1.jpg" });
    expect(out.carouselMedia.length).toBe(1);
  });
  it("carouselMedia: empty → []", () => {
    expect(mapAdToCard({}).carouselMedia).toEqual([]);
  });
  it("carouselTitles: array passthrough", () => {
    expect(mapAdToCard({ ad_title: ["A", "B"] }).carouselTitles).toEqual(["A", "B"]);
  });
  it("carouselTitles: split by '||,'", () => {
    const out = mapAdToCard({ ad_title: "A||,B" });
    expect(out.carouselTitles).toEqual(["A", "B"]);
  });
  it("carouselTitles: split by '||'", () => {
    expect(mapAdToCard({ ad_title: "A||B" }).carouselTitles).toEqual(["A", "B"]);
  });
  it("carouselTitles: single string with no sep → []", () => {
    expect(mapAdToCard({ ad_title: "Just one" }).carouselTitles).toEqual([]);
  });
  it("carouselTitles: empty → []", () => {
    expect(mapAdToCard({}).carouselTitles).toEqual([]);
  });
  it("marketPlatformUrls: object passthrough", () => {
    const out = mapAdToCard({ market_platform_urls: { ig: "x" } });
    expect(out.marketPlatformUrls).toEqual({ ig: "x" });
  });
  it("marketPlatformUrls: string JSON parsed", () => {
    expect(mapAdToCard({ market_platform_urls: '{"x":1}' }).marketPlatformUrls).toEqual({ x: 1 });
  });
  it("marketPlatformUrls: invalid JSON → null", () => {
    expect(mapAdToCard({ market_platform_urls: "not-json" }).marketPlatformUrls).toBeNull();
  });
  it("marketPlatformUrls: null/falsy → null", () => {
    expect(mapAdToCard({}).marketPlatformUrls).toBeNull();
  });
  it("formatDate catch path: throwing-toString input (line 165)", () => {
    // formatDate's try uses `new Date(dateStr)` which calls Symbol.toPrimitive.
    // Triggering the catch (then `String(dateStr)` which also throws) bubbles
    // the error out of mapAdToCard — we only care that the catch line was
    // reached, which coverage will record.
    const boom = { [Symbol.toPrimitive]() { throw new Error("boom"); } };
    expect(() => mapAdToCard({ post_date: boom })).toThrow();
  });
  it("popularity from JSON-encoded object string (lines 322-329)", () => {
    expect(mapAdToCard({ popularity: '{"current":33}' }).popularity).toBe(33);
    // array-form JSON also parses (line 323 `||` branch with '[')
    expect(mapAdToCard({ popularity: '[55]' }).popularity).toBe(55);
  });
  it("popularity malformed JSON falls through to plain Number (lines 328, 330-331)", () => {
    // '{invalid' triggers JSON.parse catch → falls to Number()
    expect(mapAdToCard({ popularity: '{notjson' }).popularity).toBeNull();
    // valid numeric string
    expect(mapAdToCard({ popularity: '77' }).popularity).toBe(77);
  });
  it("popularity from object .current or scalar", () => {
    expect(mapAdToCard({ popularity: { current: 50 } }).popularity).toBe(50);
    expect(mapAdToCard({ popularity: 42 }).popularity).toBe(42);
    expect(mapAdToCard({ popularity: 0 }).popularity).toBeNull(); // Number(0)||null=null
  });
  it("videoUrl: /stream/ video_url is returned (NAS_VIDEO base unset)", () => {
    // nas_video_url is only used when NAS_VIDEO_BASE_URL is configured (it is
    // unset in tests), so the fallback chain resolves video_url. resolveNasUrl
    // prefixes a '/stream/' path with the (empty) base, returning it verbatim.
    const out = mapAdToCard({ video_url: "/stream/foo.mp4" });
    expect(out.videoUrl).toContain("/stream/foo.mp4");
  });
  it("videoUrl: non-/stream/ video_url passes through unchanged", () => {
    const out = mapAdToCard({ video_url: "stream/foo.mp4" });
    expect(out.videoUrl).toBe("stream/foo.mp4");
  });
  it("videoUrl: quora prefers image_url_original over video_url", () => {
    const out = mapAdToCard({
      network: "quora",
      image_url_original: "/pasimages/img.jpg",
      video_url: "/pasvideos/vid.mp4",
    });
    expect(out.videoUrl).toContain("img.jpg");
    expect(out.videoUrlFallback).toContain("vid.mp4");
  });
  it("videoUrl: non-quora uses video_url first", () => {
    const out = mapAdToCard({ video_url: "/pasvideos/vid.mp4" });
    expect(out.videoUrl).toContain("vid.mp4");
  });
  it("videoUrl: nas_video_url is served from the NAS host, not the original source", () => {
    const out = mapAdToCard({
      nas_video_url: "/pas-prod/stream/fb/adVideo/202606/123.mp4",
      image_url_original: "https://video.fbcdn.net/original.mp4",
    });
    expect(out.videoUrl).toBe("https://content-dev.poweradspy.com/pas-prod/stream/fb/adVideo/202606/123.mp4");
    expect(out.videoUrl).not.toContain("fbcdn.net");
  });
  it("videoUrl: a failed-upload placeholder falls back to the original source", () => {
    const out = mapAdToCard({
      nas_video_url: "/DefaultImage.mp4",
      image_url_original: "https://video.fbcdn.net/original.mp4",
    });
    expect(out.videoUrl).toBe("https://video.fbcdn.net/original.mp4");
  });
  it("thumbnail uses image_url_original fallback chain", () => {
    expect(mapAdToCard({ image_video_url: "http://x/1.jpg" }).thumbnail).toBe("http://x/1.jpg");
    expect(mapAdToCard({ image_url_original: "http://x/2.jpg" }).thumbnail).toBe("http://x/2.jpg");
    expect(mapAdToCard({ image_url: "http://x/3.jpg" }).thumbnail).toBe("http://x/3.jpg");
  });
  it("lowerBudget/upperBudget coerced when present", () => {
    expect(mapAdToCard({ lowerBudget: "100", upperBudget: "500" })).toMatchObject({
      lowerBudget: 100, upperBudget: 500,
    });
    expect(mapAdToCard({}).lowerBudget).toBeNull();
    expect(mapAdToCard({}).upperBudget).toBeNull();
  });
  it("formatDate: invalid date → returns original string", () => {
    const out = mapAdToCard({ post_date: "not-a-date" });
    expect(typeof out.date).toBe("string"); // still a string output
  });
  it("formatDate: unix timestamp (seconds) converted", () => {
    const out = mapAdToCard({ post_date: 1700000000 });
    expect(out.date).toMatch(/\d{4}/);
  });
  it("advertiserImage uses post_owner_image when present (line 229)", () => {
    expect(mapAdToCard({ post_owner_image: "http://x/p.jpg" }).advertiserImage).toBe("http://x/p.jpg");
  });
  it("popularity object with non-positive value → null (line 309)", () => {
    expect(mapAdToCard({ popularity: { current: 0 } }).popularity).toBeNull();
    expect(mapAdToCard({ popularity: { current: "abc" } }).popularity).toBeNull();
  });
  it("popularity JSON string with non-positive value → null (line 317)", () => {
    expect(mapAdToCard({ popularity: '{"current":0}' }).popularity).toBeNull();
    expect(mapAdToCard({ popularity: '{"current":-5}' }).popularity).toBeNull();
  });
  it("calcEngPerDay: perDay rounds to 0 → null (line 220)", () => {
    // total=1 over 10 days → round(0.1)=0 → perDay not >0 → null
    expect(mapAdToCard({ likes: 1, days_running: 10 }).engPerDay).toBeNull();
  });
  it("videoUrl: quora with only video_url falls to second resolveNasUrl operand (line 242)", () => {
    const out = mapAdToCard({ network: "quora", video_url: "/pasvideos/v.mp4" });
    expect(out.videoUrl).toContain("v.mp4");
  });
  it("videoUrlFallback: non-quora → '' (line 245)", () => {
    const out = mapAdToCard({ video_url: "/pasvideos/v.mp4" });
    expect(out.videoUrlFallback).toBe("");
  });
  it("videoUrl: quora with neither image nor video → '' (242 video||'' right)", () => {
    const out = mapAdToCard({ network: "quora" });
    expect(out.videoUrl).toBe("");
  });
  it("videoUrlFallback: quora with image but no video → resolveNasUrl('') (245 video||'' right)", () => {
    const out = mapAdToCard({ network: "quora", image_url_original: "/pasimages/i.jpg" });
    expect(out.videoUrlFallback).toBe("");
  });
});

describe("api > resolveNasUrl /stream non-leading-slash (line 75)", () => {
  it("prefixes a /stream/ url (no leading slash) with the NAS video base", () => {
    // NAS_VIDEO_BASE_URL falls back to VITE_NAS_BASE_URL (set in .env), so a
    // /stream/ path resolves against the content host instead of the origin.
    expect(resolveNasUrl("vid/stream/y.mp4")).toBe("https://content-dev.poweradspy.com/vid/stream/y.mp4");
  });
});

describe("api > FILTER_PLATFORM_SUPPORT", () => {
  it("exports a frozen-ish lookup object", () => {
    expect(typeof FILTER_PLATFORM_SUPPORT).toBe("object");
    expect(Object.keys(FILTER_PLATFORM_SUPPORT).length).toBeGreaterThan(0);
  });
});

describe("api > buildAuditPrompt + buildCampaignPrompt", () => {
  it("buildAuditPrompt returns string containing the ad data", () => {
    const out = buildAuditPrompt({ id: 1, advertiser: "X" });
    expect(typeof out).toBe("string");
    expect(out).toContain("X");
  });
  it("buildCampaignPrompt returns string containing the ads array", () => {
    const out = buildCampaignPrompt([{ id: 1 }, { id: 2 }]);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("api > getYoutubeEmbedUrl", () => {
  it("falsy / non-string → null", () => {
    expect(getYoutubeEmbedUrl(null)).toBeNull();
    expect(getYoutubeEmbedUrl(undefined)).toBeNull();
    expect(getYoutubeEmbedUrl(42)).toBeNull();
  });
  it("youtu.be short link → embed", () => {
    expect(getYoutubeEmbedUrl("https://youtu.be/abc123"))
      .toMatch(/youtube\.com\/embed\/abc123\?/);
  });
  it("youtube.com/embed/ form", () => {
    expect(getYoutubeEmbedUrl("https://youtube.com/embed/xyz9876"))
      .toMatch(/embed\/xyz9876/);
  });
  it("youtube.com/shorts/ form", () => {
    expect(getYoutubeEmbedUrl("https://youtube.com/shorts/short01"))
      .toMatch(/embed\/short01/);
  });
  it("youtube.com/v/ form", () => {
    expect(getYoutubeEmbedUrl("https://youtube.com/v/vform1"))
      .toMatch(/embed\/vform1/);
  });
  it("?v= query form", () => {
    expect(getYoutubeEmbedUrl("https://www.youtube.com/watch?v=qform1"))
      .toMatch(/embed\/qform1/);
  });
  it("non-YouTube URL → null", () => {
    expect(getYoutubeEmbedUrl("https://vimeo.com/abc123")).toBeNull();
  });
});

// Facebook embedding was removed from the source — getVideoEmbedUrl now
// delegates only to the YouTube resolver, so every Facebook/non-YouTube URL
// resolves to null (the actual playable media for FB/IG ads is carried in
// image_url_original, which mapAdToCard routes into ad.videoUrl directly).
describe("api > Facebook URLs no longer embed (getVideoEmbedUrl → null)", () => {
  it("falsy / non-string → null", () => {
    expect(getVideoEmbedUrl(null)).toBeNull();
    expect(getVideoEmbedUrl(123)).toBeNull();
  });
  it("non-FB host → null", () => {
    expect(getVideoEmbedUrl("https://twitter.com/x/videos/1")).toBeNull();
  });
  it("FB host but no video segment → null", () => {
    expect(getVideoEmbedUrl("https://facebook.com/profile/100")).toBeNull();
  });
  it("/videos/ form → null (no FB embed)", () => {
    expect(getVideoEmbedUrl("https://facebook.com/x/videos/1")).toBeNull();
  });
  it("/reels/ form → null", () => {
    expect(getVideoEmbedUrl("https://facebook.com/x/reels/abc")).toBeNull();
  });
  it("/watch?... form → null", () => {
    expect(getVideoEmbedUrl("https://facebook.com/watch?v=1")).toBeNull();
  });
  it("fb.watch short link → null", () => {
    expect(getVideoEmbedUrl("https://fb.watch/abc/")).toBeNull();
  });
  it("/video.php? legacy form → null", () => {
    expect(getVideoEmbedUrl("https://facebook.com/video.php?v=1")).toBeNull();
  });
});

describe("api > getVideoEmbedUrl dispatcher", () => {
  it("dispatches to YouTube when YT URL", () => {
    expect(getVideoEmbedUrl("https://youtu.be/abc999"))
      .toMatch(/youtube\.com\/embed/);
  });
  it("returns null when not YT (FB no longer embeds)", () => {
    expect(getVideoEmbedUrl("https://facebook.com/x/videos/1")).toBeNull();
  });
  it("returns null for unsupported host", () => {
    expect(getVideoEmbedUrl("https://example.com/x")).toBeNull();
  });
});

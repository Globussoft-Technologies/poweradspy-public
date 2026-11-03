import { describe, it, expect } from "vitest";
import {
  normalizeId, normalizeName, normalizeUrl, normalizeDomain, domainCandidates,
} from "../../../core/blocklist/blocklist.normalize.js";

describe("blocklist.normalize > normalizeId", () => {
  it("treats a number and its string form as the same id", () => {
    expect(normalizeId(123)).toBe("123");
    expect(normalizeId("123")).toBe("123");
    expect(normalizeId("  123  ")).toBe("123");
  });
  it("keeps case and leading zeros", () => {
    expect(normalizeId("AbC9")).toBe("AbC9");
    expect(normalizeId("007")).toBe("007");
  });
  it("returns empty for unusable input", () => {
    for (const v of [null, undefined, "", "   ", {}, [], NaN, Infinity, true]) {
      expect(normalizeId(v)).toBe("");
    }
  });
});

describe("blocklist.normalize > normalizeName", () => {
  it("ignores case, extra spaces and unicode forms", () => {
    expect(normalizeName("  Acme   CORP ")).toBe("acme corp");
    expect(normalizeName("ＡＣＭＥ")).toBe("acme");
  });
  it("accepts a numeric id and rejects junk", () => {
    expect(normalizeName(42)).toBe("42");
    for (const v of [null, undefined, "", {}, []]) expect(normalizeName(v)).toBe("");
  });
});

describe("blocklist.normalize > normalizeUrl", () => {
  it("ignores scheme, www, query, fragment, port and trailing slash", () => {
    const expected = "cdn.site.com/a/b.jpg";
    for (const u of [
      "https://CDN.Site.com/a/b.jpg?x=1&y=2",
      "http://www.cdn.site.com/a/b.jpg#frag",
      "//cdn.site.com:8080/a/b.jpg",
      "cdn.site.com/a/b.jpg/",
    ]) expect(normalizeUrl(u)).toBe(expected);
  });
  it("ignores the signed query of a TikTok cdn url", () => {
    expect(normalizeUrl("https://p16-sign.tiktokcdn.com/tos-alisg-p-0051/abc123~tplv.image?x-expires=1&x-signature=zz"))
      .toBe("p16-sign.tiktokcdn.com/tos-alisg-p-0051/abc123~tplv.image");
  });
  it("keeps path case", () => {
    expect(normalizeUrl("https://x.com/AbC/Img.JPG")).toBe("x.com/AbC/Img.JPG");
  });
  it("strips image size tokens", () => {
    expect(normalizeUrl("https://x.com/a/150x150/b.jpg")).toBe("x.com/a/b.jpg");
    expect(normalizeUrl("https://x.com/a/b_300x250.jpg")).toBe("x.com/a/b.jpg");
    expect(normalizeUrl("https://x.com/a/b=w300-h200-no")).toBe("x.com/a/b");
  });
  it("returns the trimmed raw string for an unparseable value", () => {
    expect(normalizeUrl("  http://bad host  ")).toBe("http://bad host");
  });
  it("returns empty for unusable input, data urls and oversized values", () => {
    for (const v of [null, undefined, "", "   ", 5, {}, "data:image/png;base64,AAAA", "a".repeat(5000)]) {
      expect(normalizeUrl(v)).toBe("");
    }
  });
});

describe("blocklist.normalize > domains", () => {
  it("extracts the host from a url or a bare host", () => {
    expect(normalizeDomain("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(normalizeDomain("")).toBe("");
  });
  it("lists the host and its parents down to two labels, never a bare tld", () => {
    expect(domainCandidates("a.b.example.com")).toEqual(["a.b.example.com", "b.example.com", "example.com"]);
    expect(domainCandidates("a.example.com")).not.toContain("com");
    expect(domainCandidates("10.0.0.1")).toEqual(["10.0.0.1"]);
    expect(domainCandidates("localhost")).toEqual(["localhost"]);
    expect(domainCandidates("")).toEqual([]);
  });
});

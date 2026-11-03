import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const {
  normalizeId, normalizeName, normalizeUrl, normalizeDomain, domainCandidates,
} = require("../../../src/compliance/blocklist/normalize");

describe("compliance/blocklist > normalizeId", () => {
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

describe("compliance/blocklist > normalizeName", () => {
  it("ignores case, extra spaces and unicode forms", () => {
    expect(normalizeName("  Acme   CORP ")).toBe("acme corp");
    expect(normalizeName("ＡＣＭＥ")).toBe("acme");
  });
  it("accepts a numeric advertiser id and rejects junk", () => {
    expect(normalizeName(42)).toBe("42");
    for (const v of [null, undefined, "", {}, []]) expect(normalizeName(v)).toBe("");
  });
});

describe("compliance/blocklist > normalizeUrl", () => {
  it("ignores scheme, www, query, fragment, port and trailing slash", () => {
    const expected = "cdn.site.com/a/b.jpg";
    for (const u of [
      "https://CDN.Site.com/a/b.jpg?x=1&y=2",
      "http://www.cdn.site.com/a/b.jpg#frag",
      "//cdn.site.com:8080/a/b.jpg",
      "cdn.site.com/a/b.jpg/",
    ]) expect(normalizeUrl(u)).toBe(expected);
  });
  it("keeps path case", () => {
    expect(normalizeUrl("https://x.com/AbC/Img.JPG")).toBe("x.com/AbC/Img.JPG");
  });
  it("strips image size tokens", () => {
    expect(normalizeUrl("https://x.com/a/150x150/b.jpg")).toBe("x.com/a/b.jpg");
    expect(normalizeUrl("https://x.com/a/s320x320/b.jpg")).toBe("x.com/a/b.jpg");
    expect(normalizeUrl("https://x.com/a/b_300x250.jpg")).toBe("x.com/a/b.jpg");
    expect(normalizeUrl("https://x.com/a/b=s300")).toBe("x.com/a/b");
    expect(normalizeUrl("https://x.com/a/b=w300-h200-no")).toBe("x.com/a/b");
  });
  it("collapses duplicate slashes and percent-encoding", () => {
    expect(normalizeUrl("https://x.com//a///b%20c.jpg")).toBe("x.com/a/b c.jpg");
  });
  it("returns the trimmed raw string for an unparseable value", () => {
    expect(normalizeUrl("  http://bad host  ")).toBe("http://bad host");
    expect(normalizeUrl("http://")).toBe("http://");
  });
  it("gives a stable key even for odd scheme-like junk", () => {
    expect(normalizeUrl("ht!tp://bad host")).toBe(normalizeUrl("  ht!tp://bad host "));
    expect(normalizeUrl("ht!tp://bad host")).not.toBe("");
  });
  it("returns empty for unusable input, data urls and oversized values", () => {
    for (const v of [null, undefined, "", "   ", 5, {}, "data:image/png;base64,AAAA", "a".repeat(5000)]) {
      expect(normalizeUrl(v)).toBe("");
    }
  });
  it("does not throw on a very long or odd url", () => {
    expect(() => normalizeUrl("https://x.com/" + "a/".repeat(1500))).not.toThrow();
    expect(() => normalizeUrl("https://x.com/%E0%A4%A")).not.toThrow();
  });
});

describe("compliance/blocklist > domains", () => {
  it("extracts the host from a url or a bare host", () => {
    expect(normalizeDomain("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(normalizeDomain("")).toBe("");
  });
  it("lists the host and its parents down to two labels", () => {
    expect(domainCandidates("a.b.example.com")).toEqual(["a.b.example.com", "b.example.com", "example.com"]);
    expect(domainCandidates("example.com")).toEqual(["example.com"]);
  });
  it("never produces a bare TLD and leaves IPs and single labels alone", () => {
    expect(domainCandidates("a.example.com")).not.toContain("com");
    expect(domainCandidates("10.0.0.1")).toEqual(["10.0.0.1"]);
    expect(domainCandidates("localhost")).toEqual(["localhost"]);
    expect(domainCandidates("")).toEqual([]);
  });
});

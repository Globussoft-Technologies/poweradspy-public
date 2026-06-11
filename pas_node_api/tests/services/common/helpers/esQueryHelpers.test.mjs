import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const h = require("../../../../src/services/common/helpers/esQueryHelpers");

describe("esQueryHelpers > escapeWords", () => {
  it("returns '' for falsy input", () => {
    expect(h.escapeWords("")).toBe("");
    expect(h.escapeWords(null)).toBe("");
    expect(h.escapeWords(undefined)).toBe("");
  });
  it("escapes special characters in order", () => {
    expect(h.escapeWords("a\\b/c#d:e[f]g(h)i?j|k'l.m-n")).toContain("\\\\");
    expect(h.escapeWords("hello world")).toBe("hello world");
  });
  it("escapes leading ampersand", () => {
    expect(h.escapeWords("&foo")).toBe("\\&foo");
  });
  it("non-leading & not escaped", () => {
    expect(h.escapeWords("a&b")).toBe("a&b");
  });
  it("coerces numbers via String()", () => {
    expect(h.escapeWords(42)).toBe("42");
  });
});

describe("esQueryHelpers > relativeWords", () => {
  it("single string → AND-joined", () => {
    expect(h.relativeWords("hello world")).toBe("(hello) AND (world)");
  });
  it("single word → wrapped once", () => {
    expect(h.relativeWords("hello")).toBe("(hello)");
  });
  it("array → maps each", () => {
    expect(h.relativeWords(["foo bar", "baz"])).toEqual(["(foo) AND (bar)", "(baz)"]);
  });
});

describe("esQueryHelpers > wrapIfNeed", () => {
  it("wraps when has space", () => {
    expect(h.wrapIfNeed("hello world")).toBe("(hello world)");
  });
  it("leaves single-word as-is", () => {
    expect(h.wrapIfNeed("foo")).toBe("foo");
  });
});

describe("esQueryHelpers > flatBool", () => {
  it("emits only non-empty buckets", () => {
    expect(h.flatBool({ must: [{ x: 1 }] })).toEqual({ bool: { must: [{ x: 1 }] } });
    expect(h.flatBool({ filter: [{ x: 1 }] })).toEqual({ bool: { filter: [{ x: 1 }] } });
    expect(h.flatBool({ must_not: [{ x: 1 }] })).toEqual({ bool: { must_not: [{ x: 1 }] } });
    expect(h.flatBool({ should: [{ x: 1 }] })).toEqual({ bool: { should: [{ x: 1 }] } });
  });
  it("emits minimum_should_match when set", () => {
    expect(h.flatBool({ should: [{ x: 1 }], minimum_should_match: 2 })).toEqual({
      bool: { should: [{ x: 1 }], minimum_should_match: 2 },
    });
  });
  it("default empty input → empty bool", () => {
    expect(h.flatBool()).toEqual({ bool: {} });
  });
});

describe("esQueryHelpers > termFilter", () => {
  it("null/undefined → null", () => {
    expect(h.termFilter("f", null)).toBeNull();
    expect(h.termFilter("f", undefined)).toBeNull();
  });
  it("single value → term", () => {
    expect(h.termFilter("f", "v")).toEqual({ term: { f: "v" } });
  });
  it("empty string → null", () => {
    expect(h.termFilter("f", "")).toBeNull();
  });
  it("single-elem array → term", () => {
    expect(h.termFilter("f", ["a"])).toEqual({ term: { f: "a" } });
  });
  it("array → terms (filters out null/undefined/empty)", () => {
    expect(h.termFilter("f", ["a", null, "", "b", undefined])).toEqual({ terms: { f: ["a", "b"] } });
  });
  it("array all-empty → null", () => {
    expect(h.termFilter("f", [null, "", undefined])).toBeNull();
  });
});

describe("esQueryHelpers > matchFilter", () => {
  it("null/undefined → null", () => {
    expect(h.matchFilter("f", null)).toBeNull();
    expect(h.matchFilter("f", undefined)).toBeNull();
  });
  it("single value → match w/ AND", () => {
    expect(h.matchFilter("f", "v")).toEqual({ match: { f: { query: "v", operator: "and" } } });
  });
  it("single-elem array → match", () => {
    expect(h.matchFilter("f", ["a"]).match).toBeDefined();
  });
  it("array of cleaned vals → bool.should with min_should_match=1", () => {
    const out = h.matchFilter("f", ["a", "", null, "b"]);
    expect(out.bool.should).toHaveLength(2);
    expect(out.bool.minimum_should_match).toBe(1);
  });
  it("array all empty → null", () => {
    expect(h.matchFilter("f", [""])).toBeNull();
  });
});

describe("esQueryHelpers > multiFieldMatchFilter", () => {
  it("no fields → null", () => {
    expect(h.multiFieldMatchFilter([], "v")).toBeNull();
    expect(h.multiFieldMatchFilter(null, "v")).toBeNull();
  });
  it("null vals → null", () => {
    expect(h.multiFieldMatchFilter(["f1"], null)).toBeNull();
  });
  it("single value → multi_match w/ AND", () => {
    expect(h.multiFieldMatchFilter(["f1", "f2"], "v")).toEqual({
      multi_match: { query: "v", fields: ["f1", "f2"], operator: "and" },
    });
  });
  it("multi-value array → bool.should", () => {
    const out = h.multiFieldMatchFilter(["f1"], ["a", "b"]);
    expect(out.bool.should).toHaveLength(2);
  });
  it("all-empty array → null", () => {
    expect(h.multiFieldMatchFilter(["f1"], ["", null])).toBeNull();
  });
});

describe("esQueryHelpers > phraseAcrossFields", () => {
  it("falsy kw / empty fields → null", () => {
    expect(h.phraseAcrossFields(["f"], "")).toBeNull();
    expect(h.phraseAcrossFields([], "kw")).toBeNull();
    expect(h.phraseAcrossFields(null, "kw")).toBeNull();
  });
  it("only-quotes input cleans to empty → null", () => {
    expect(h.phraseAcrossFields(["f"], '""')).toBeNull();
  });
  it("quoted input → multi_match type:phrase, includes exactlyFields", () => {
    const out = h.phraseAcrossFields(["f1"], '"hello"', { exactlyFields: ["fx"] });
    expect(out).toEqual({ multi_match: { query: "hello", type: "phrase", fields: ["f1", "fx"] } });
  });
  it("single non-quoted word → multi_match type:phrase", () => {
    const out = h.phraseAcrossFields(["f1"], "hello");
    expect(out.multi_match.type).toBe("phrase");
  });
  it("multi-word non-quoted → bool.must of phrase matches", () => {
    const out = h.phraseAcrossFields(["f1"], "hello world");
    expect(out.bool.must).toHaveLength(2);
    expect(out.bool.must[0].multi_match.type).toBe("phrase");
  });
  it("analyzer opt threaded through quoted path", () => {
    const out = h.phraseAcrossFields(["f1"], '"hello"', { analyzer: "standard" });
    expect(out.multi_match.analyzer).toBe("standard");
  });
  it("analyzer opt threaded through single-word path", () => {
    const out = h.phraseAcrossFields(["f1"], "hello", { analyzer: "standard" });
    expect(out.multi_match.analyzer).toBe("standard");
  });
  it("analyzer opt threaded through multi-word path", () => {
    const out = h.phraseAcrossFields(["f1"], "hello world", { analyzer: "standard" });
    expect(out.bool.must[0].multi_match.analyzer).toBe("standard");
  });
});

describe("esQueryHelpers > wrapWithCountryBoost", () => {
  it("wraps inner query with boost should clauses", () => {
    const out = h.wrapWithCountryBoost({ match: { x: 1 } }, "us", "country.keyword", "country");
    expect(out.bool.must).toEqual([{ match: { x: 1 } }]);
    expect(out.bool.should[0].constant_score.boost).toBe(1000000);
    // should has 5 case variants + match (no wildcard)
    expect(out.bool.should[0].constant_score.filter.bool.should).toHaveLength(5);
  });
  it("null inner → match_all default", () => {
    const out = h.wrapWithCountryBoost(null, "us", "c.k", "c");
    expect(out.bool.must[0]).toEqual({ match_all: {} });
  });
  it("includeWildcard=true adds wildcard clause", () => {
    const out = h.wrapWithCountryBoost(null, "us", "c.k", "c", { includeWildcard: true });
    const inner = out.bool.should[0].constant_score.filter.bool.should;
    expect(inner).toHaveLength(6);
    expect(inner[5]).toEqual({ wildcard: { "c.k": "*us*" } });
  });
});

describe("esQueryHelpers > paginationDefaults", () => {
  it("returns track_total_hits true", () => {
    expect(h.paginationDefaults()).toEqual({ track_total_hits: true });
  });
});

describe("esQueryHelpers > shouldProfile", () => {
  let origEnv;
  beforeEach(() => { origEnv = { ...process.env }; });
  afterEach(() => { process.env = origEnv; });

  it("explicit true / false short-circuit", () => {
    expect(h.shouldProfile(true)).toBe(true);
    expect(h.shouldProfile(false)).toBe(false);
  });
  it("production env → false regardless", () => {
    process.env.NODE_ENV = "production";
    process.env.ES_PROFILE = "true";
    expect(h.shouldProfile()).toBe(false);
  });
  it("non-prod + ES_PROFILE=true → true", () => {
    process.env.NODE_ENV = "development";
    process.env.ES_PROFILE = "true";
    expect(h.shouldProfile()).toBe(true);
  });
  it("non-prod + ES_PROFILE=1 → true", () => {
    process.env.NODE_ENV = "development";
    process.env.ES_PROFILE = "1";
    expect(h.shouldProfile()).toBe(true);
  });
  it("non-prod + ES_PROFILE unset → false", () => {
    process.env.NODE_ENV = "development";
    delete process.env.ES_PROFILE;
    expect(h.shouldProfile()).toBe(false);
  });
});

describe("esQueryHelpers > envelope helpers", () => {
  it("asFilter wraps clause with ctx", () => {
    expect(h.asFilter({ x: 1 })).toEqual({ ctx: "filter", clause: { x: 1 } });
  });
  it("asFilter on falsy returns null", () => {
    expect(h.asFilter(null)).toBeNull();
  });
  it("asMust wraps", () => {
    expect(h.asMust({ x: 1 }).ctx).toBe("must");
  });
  it("asMust null → null", () => {
    expect(h.asMust(null)).toBeNull();
  });
  it("asMustNot wraps", () => {
    expect(h.asMustNot({ x: 1 }).ctx).toBe("must_not");
  });
  it("asMustNot null → null", () => {
    expect(h.asMustNot(null)).toBeNull();
  });
});

describe("esQueryHelpers > bucketize", () => {
  it("groups envelopes by ctx", () => {
    const out = h.bucketize([
      h.asFilter({ a: 1 }),
      h.asMust({ b: 1 }),
      h.asMustNot({ c: 1 }),
    ]);
    expect(out.filter).toEqual([{ a: 1 }]);
    expect(out.must).toEqual([{ b: 1 }]);
    expect(out.must_not).toEqual([{ c: 1 }]);
  });
  it("legacy plain clauses default to filter", () => {
    const out = h.bucketize([{ legacy: 1 }]);
    expect(out.filter).toEqual([{ legacy: 1 }]);
  });
  it("null entries skipped", () => {
    const out = h.bucketize([null, h.asFilter({ a: 1 }), null]);
    expect(out.filter).toEqual([{ a: 1 }]);
  });
});

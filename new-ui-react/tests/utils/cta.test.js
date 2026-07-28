import { describe, it, expect } from "vitest";
import {
  ctaHref,
  ctaLabelText,
  ctaLabels,
  destinationUrls,
  parseAdCtas,
  primaryCtaLabel,
} from "../../src/utils/cta";

describe("utils/cta > ctaLabels", () => {
  it("splits the LinkedIn multi-CTA blob on '||,'", () => {
    expect(ctaLabels("sign up||,visit website")).toEqual(["sign up", "visit website"]);
  });
  it("splits on '||' and on a lone '|'", () => {
    expect(ctaLabels("sign up||visit website")).toEqual(["sign up", "visit website"]);
    expect(ctaLabels("sign up|visit website")).toEqual(["sign up", "visit website"]);
  });
  it("never leaks the separator's trailing comma into a label", () => {
    expect(ctaLabels("a||,b||,c")).toEqual(["a", "b", "c"]);
  });
  it("single CTA yields one entry", () => {
    expect(ctaLabels("Learn More")).toEqual(["Learn More"]);
  });
  it("handles a blob that mixes separator forms", () => {
    expect(ctaLabels(" sign up ||, ||visit website ")).toEqual(["sign up", "visit website"]);
  });
  it("trims blanks and drops empty segments", () => {
    expect(ctaLabels("  sign up ||, ||, visit website  ")).toEqual(["sign up", "visit website"]);
  });
  it("collapses a CTA the backend stored twice", () => {
    expect(ctaLabels("learn more||,learn more")).toEqual(["learn more"]);
  });
  it("dedup ignores case and extra whitespace", () => {
    expect(ctaLabels("Learn More||,learn  more||,LEARN MORE")).toEqual(["Learn More"]);
  });
  it("dedup keeps distinct CTAs and their order", () => {
    expect(ctaLabels("sign up||,learn more||,sign up||,visit website")).toEqual([
      "sign up",
      "learn more",
      "visit website",
    ]);
  });
  it("array passthrough", () => {
    expect(ctaLabels(["sign up", "visit website"])).toEqual(["sign up", "visit website"]);
  });
  it("empty / null / non-string → []", () => {
    expect(ctaLabels("")).toEqual([]);
    expect(ctaLabels("   ")).toEqual([]);
    expect(ctaLabels(null)).toEqual([]);
    expect(ctaLabels(undefined)).toEqual([]);
    expect(ctaLabels(42)).toEqual([]);
  });
});

describe("utils/cta > destinationUrls", () => {
  it("splits multi-destination blobs", () => {
    expect(destinationUrls("https://a.com||,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
  it("keeps a raw '|' inside a query string intact", () => {
    expect(destinationUrls("https://a.com/?utm=x|y")).toEqual(["https://a.com/?utm=x|y"]);
  });
  it("empty → []", () => {
    expect(destinationUrls("")).toEqual([]);
  });
});

describe("utils/cta > primaryCtaLabel / ctaLabelText", () => {
  it("primaryCtaLabel returns the first label only", () => {
    expect(primaryCtaLabel("sign up||,visit website")).toBe("sign up");
    expect(primaryCtaLabel("")).toBe("");
  });
  it("ctaLabelText joins labels for read-only surfaces", () => {
    expect(ctaLabelText("sign up||,visit website")).toBe("sign up, visit website");
    expect(ctaLabelText("Learn More")).toBe("Learn More");
    expect(ctaLabelText("learn more||,learn more")).toBe("learn more");
    expect(ctaLabelText(null)).toBe("");
  });
});

describe("utils/cta > ctaHref", () => {
  it("passes absolute URLs through", () => {
    expect(ctaHref("https://a.com")).toBe("https://a.com");
    expect(ctaHref("HTTP://a.com")).toBe("HTTP://a.com");
  });
  it("prefixes bare domains with https", () => {
    expect(ctaHref("a.com/x")).toBe("https://a.com/x");
  });
  it("blank → empty string", () => {
    expect(ctaHref("  ")).toBe("");
    expect(ctaHref(null)).toBe("");
  });
});

describe("utils/cta > parseAdCtas", () => {
  it("pairs each CTA with its own destination URL", () => {
    expect(
      parseAdCtas({
        cta: "sign up||,visit website",
        destinationUrl: "https://a.com/signup||,https://a.com/home",
      }),
    ).toEqual([
      { label: "sign up", url: "https://a.com/signup" },
      { label: "visit website", url: "https://a.com/home" },
    ]);
  });
  it("a single destination URL is shared by every CTA", () => {
    expect(
      parseAdCtas({ cta: "sign up||,visit website", destinationUrl: "https://a.com" }),
    ).toEqual([
      { label: "sign up", url: "https://a.com" },
      { label: "visit website", url: "https://a.com" },
    ]);
  });
  it("falls back to the first URL when the counts disagree", () => {
    expect(
      parseAdCtas({
        cta: "a||,b||,c",
        destinationUrl: "https://1.com||,https://2.com",
      }),
    ).toEqual([
      { label: "a", url: "https://1.com" },
      { label: "b", url: "https://2.com" },
      { label: "c", url: "https://1.com" },
    ]);
  });
  it("no destination URL leaves every button unlinked", () => {
    expect(parseAdCtas({ cta: "sign up||,visit website" })).toEqual([
      { label: "sign up", url: "" },
      { label: "visit website", url: "" },
    ]);
  });
  it("a CTA stored twice yields one button", () => {
    expect(
      parseAdCtas({ cta: "learn more||,learn more", destinationUrl: "https://a.com" }),
    ).toEqual([{ label: "learn more", url: "https://a.com" }]);
  });
  it("a repeated CTA keeps the URL paired with its first occurrence", () => {
    expect(
      parseAdCtas({
        cta: "sign up||,learn more||,learn more",
        destinationUrl: "https://1.com||,https://2.com||,https://3.com",
      }),
    ).toEqual([
      { label: "sign up", url: "https://1.com" },
      { label: "learn more", url: "https://2.com" },
    ]);
  });
  it("no CTA → []", () => {
    expect(parseAdCtas({ destinationUrl: "https://a.com" })).toEqual([]);
    expect(parseAdCtas(null)).toEqual([]);
    expect(parseAdCtas(undefined)).toEqual([]);
  });
});

// Tests for src/services/adPdf.js (downloadAdAsPdf).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { jsPDFCtor, mockDoc, fetchImageSpy, heDecodeSpy } = vi.hoisted(() => {
  const mockDoc = {
    internal: {
      pageSize: { getWidth: () => 595, getHeight: () => 842 },
      getNumberOfPages: () => 1,
    },
    setFillColor: vi.fn(),
    setTextColor: vi.fn(),
    setDrawColor: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setPage: vi.fn(),
    rect: vi.fn(),
    roundedRect: vi.fn(),
    line: vi.fn(),
    text: vi.fn(),
    addImage: vi.fn(),
    addPage: vi.fn(),
    save: vi.fn(),
    splitTextToSize: vi.fn((text) => [text]),
    getTextWidth: vi.fn(() => 20),
    link: vi.fn(),
  };
  return {
    mockDoc,
    jsPDFCtor: vi.fn(function () { return mockDoc; }),
    fetchImageSpy: vi.fn(),
    heDecodeSpy: vi.fn((s) => s),
  };
});

vi.mock("jspdf", () => ({ jsPDF: jsPDFCtor }));
vi.mock("he", () => ({ default: { decode: heDecodeSpy } }));
vi.mock("../../src/services/api", () => ({
  fetchImageAsDataUrl: fetchImageSpy,
}));

let downloadAdAsPdf;
beforeEach(async () => {
  vi.resetModules();
  for (const fn of Object.values(mockDoc)) {
    if (typeof fn?.mockReset === "function") fn.mockReset();
  }
  mockDoc.splitTextToSize = vi.fn((text) => [text]);
  mockDoc.getTextWidth = vi.fn(() => 20);
  fetchImageSpy.mockReset();
  heDecodeSpy.mockReset().mockImplementation((s) => s);
  jsPDFCtor.mockClear();
  mockDoc.internal.getNumberOfPages = () => 1;

  // Stub canvas + Image used by renderTextAsImage
  globalThis.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    font: "", measureText: vi.fn(() => ({ width: 50 })),
    fillStyle: "", fillRect: vi.fn(), scale: vi.fn(),
    fillText: vi.fn(), textBaseline: "", clearRect: vi.fn(),
  }));
  globalThis.HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,x");

  // Stub Image so renderTextAsImage's `new window.Image()` works (probe.onload triggers immediately)
  const RealImage = globalThis.Image;
  class FakeImage {
    constructor() {
      setTimeout(() => this.onload && this.onload(), 0);
    }
    set src(v) { this._src = v; }
    get src() { return this._src; }
    get naturalWidth() { return 100; }
    get naturalHeight() { return 100; }
  }
  globalThis.Image = FakeImage;

  ({ downloadAdAsPdf } = await import("../../src/services/adPdf.js"));
});

describe("adPdf > downloadAdAsPdf early return", () => {
  it("falsy ad → no-op (no jsPDF created)", async () => {
    await downloadAdAsPdf(null);
    expect(jsPDFCtor).not.toHaveBeenCalled();
  });
});

describe("adPdf > downloadAdAsPdf happy path", () => {
  it("constructs jsPDF, saves with sanitized filename", async () => {
    fetchImageSpy.mockResolvedValue("data:image/jpeg;base64,abc");
    await downloadAdAsPdf({
      title: "Buy Now! 50% OFF", advertiser: "BrandX",
      network: "facebook", adType: "image",
      thumbnail: "http://img/x.jpg",
    });
    expect(jsPDFCtor).toHaveBeenCalledWith({ unit: "pt", format: "a4" });
    expect(mockDoc.save).toHaveBeenCalled();
    const filename = mockDoc.save.mock.calls[0][0];
    expect(filename).toMatch(/^Buy_Now__50__OFF.pdf$/);
  });
  it("falls back to advertiser then 'ad' for filename", async () => {
    await downloadAdAsPdf({ advertiser: "BrandX" });
    expect(mockDoc.save.mock.calls[0][0]).toBe("BrandX.pdf");
  });
  it("filename defaults to 'ad' when no title/advertiser", async () => {
    await downloadAdAsPdf({ network: "facebook" });
    expect(mockDoc.save.mock.calls[0][0]).toBe("ad.pdf");
  });
  it("header band drawn (BRAND + ACCENT rects)", async () => {
    await downloadAdAsPdf({ advertiser: "X" });
    expect(mockDoc.setFillColor).toHaveBeenCalledWith(51, 82, 150); // BRAND
    expect(mockDoc.setFillColor).toHaveBeenCalledWith(107, 153, 255); // ACCENT
  });
  it("header line includes network + adType + 'Generated'", async () => {
    await downloadAdAsPdf({ network: "instagram", adType: "video" });
    const headerCall = mockDoc.text.mock.calls.find(c => /Generated/.test(c[0]));
    expect(headerCall[0]).toContain("INSTAGRAM");
    expect(headerCall[0]).toContain("video");
  });
  it("missing network/adType → '-' placeholder", async () => {
    await downloadAdAsPdf({});
    const headerCall = mockDoc.text.mock.calls.find(c => /Generated/.test(c[0]));
    expect(headerCall[0]).toContain("-");
  });
});

describe("adPdf > thumbnail rendering", () => {
  it("happy: addImage called with detected format", async () => {
    fetchImageSpy.mockResolvedValue("data:image/png;base64,abc");
    await downloadAdAsPdf({ thumbnail: "http://x.com/img.png", advertiser: "A" });
    const calls = mockDoc.addImage.mock.calls;
    const formats = calls.map(c => c[1]);
    expect(formats).toContain("PNG");
  });
  it("webp data URL → WEBP format", async () => {
    fetchImageSpy.mockResolvedValue("data:image/webp;base64,abc");
    await downloadAdAsPdf({ thumbnail: "http://x.com/img.webp", advertiser: "A" });
    expect(mockDoc.addImage.mock.calls.some(c => c[1] === "WEBP")).toBe(true);
  });
  it("other data URL → JPEG fallback", async () => {
    fetchImageSpy.mockResolvedValue("data:image/jpeg;base64,abc");
    await downloadAdAsPdf({ thumbnail: "http://x.com/img.jpg", advertiser: "A" });
    expect(mockDoc.addImage.mock.calls.some(c => c[1] === "JPEG")).toBe(true);
  });
  it("uses carouselMedia[0] when no thumbnail", async () => {
    fetchImageSpy.mockResolvedValue("data:image/jpeg;base64,a");
    await downloadAdAsPdf({ carouselMedia: ["http://x/c.jpg"], advertiser: "A" });
    expect(fetchImageSpy).toHaveBeenCalledWith("http://x/c.jpg");
  });
  it("fetch failure → renders 'Preview unavailable' fallback", async () => {
    fetchImageSpy.mockRejectedValue(new Error("fetch-fail"));
    await downloadAdAsPdf({ thumbnail: "http://x.com/img.jpg", advertiser: "A" });
    const placeholderCall = mockDoc.text.mock.calls.find(c => c[0] === "Preview unavailable");
    expect(placeholderCall).toBeDefined();
  });
  it("no thumbnail and no carousel → image block skipped", async () => {
    await downloadAdAsPdf({ advertiser: "A" });
    expect(fetchImageSpy).not.toHaveBeenCalled();
  });
});

describe("adPdf > formatStat NaN + runningDays + popularity branches", () => {
  it("formatStat with non-numeric string (no alpha) → Number=NaN → String(val) (line 44)", async () => {
    // ad.engRate is a sparse value that hits formatStat
    await downloadAdAsPdf({ advertiser: "X", views: "$50" });
    // Should render "$50" rather than crash
    expect(mockDoc.save).toHaveBeenCalled();
  });
  it("runningDays=null → null short-circuits Timeline row (line 332 ternary false)", async () => {
    await downloadAdAsPdf({ advertiser: "X", runningDays: null });
    expect(mockDoc.save).toHaveBeenCalled();
  });
  it("popularity=null → null short-circuits row (line 370 ternary false)", async () => {
    await downloadAdAsPdf({ advertiser: "X", popularity: null });
    expect(mockDoc.save).toHaveBeenCalled();
  });
  it("ad.network truthy → STAT_TRIOS lookup; unknown network falls to DEFAULT_TRIO (line 339)", async () => {
    await downloadAdAsPdf({ advertiser: "X", network: "unknown-net" });
    // STAT_TRIOS[unknown-net] is undefined → || DEFAULT_TRIO branch
    expect(mockDoc.save).toHaveBeenCalled();
  });
});

describe("adPdf > section content", () => {
  it("renders Advertiser & Source rows with non-null values only", async () => {
    await downloadAdAsPdf({
      advertiser: "BrandX", network: "facebook", adType: "image",
      verified: true, status: "Active", industry: "Finance",
      adLanguage: "en", aspectRatio: "1:1",
    });
    // Advertiser & Source section label rendered
    expect(mockDoc.text.mock.calls.some(c => c[0] === "ADVERTISER & SOURCE")).toBe(true);
  });
  it("ad.title decoded via he.decode (unicode triggers image render)", async () => {
    await downloadAdAsPdf({ title: "Brand — Sale 💥", advertiser: "X" });
    expect(heDecodeSpy).toHaveBeenCalledWith("Brand — Sale 💥");
  });
  it("untitled fallback when ad.title empty", async () => {
    await downloadAdAsPdf({ advertiser: "X" });
    // renderTextAsImage gets "(untitled ad)" — verify via heDecodeSpy
    expect(heDecodeSpy).toHaveBeenCalledWith("");
  });
  it("subtitle present → renders body image", async () => {
    await downloadAdAsPdf({ subtitle: "Short description", advertiser: "X" });
    expect(heDecodeSpy).toHaveBeenCalledWith("Short description");
  });
  it("adText fallback when no subtitle", async () => {
    await downloadAdAsPdf({ adText: "Body text", advertiser: "X" });
    expect(heDecodeSpy).toHaveBeenCalledWith("Body text");
  });
  it("no subtitle / no adText → body skipped", async () => {
    heDecodeSpy.mockClear();
    await downloadAdAsPdf({ advertiser: "X" });
    // First he.decode call is for title; no subsequent body decode
    expect(heDecodeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("adPdf > Engagement section", () => {
  it("uses STAT_TRIO for known platform", async () => {
    await downloadAdAsPdf({
      network: "facebook", likes: 100, comments: 20, shares: 5,
    });
    // 'likes', 'comments', 'shares' labels uppercased in trio tiles
    expect(mockDoc.text.mock.calls.some(c => c[0] === "LIKES")).toBe(true);
    expect(mockDoc.text.mock.calls.some(c => c[0] === "COMMENTS")).toBe(true);
    expect(mockDoc.text.mock.calls.some(c => c[0] === "SHARES")).toBe(true);
  });
  it("uses DEFAULT_TRIO for unknown platform", async () => {
    await downloadAdAsPdf({ network: "twitter" });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "VIEWS")).toBe(true);
  });
  it("missing values render 'N/A'", async () => {
    await downloadAdAsPdf({ network: "facebook" });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "N/A")).toBe(true);
  });
  it("formatStat: large numbers → 1M/1K notation", async () => {
    await downloadAdAsPdf({
      network: "facebook", likes: 1_500_000, comments: 5000,
    });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "1.5M")).toBe(true);
    expect(mockDoc.text.mock.calls.some(c => c[0] === "5K")).toBe(true);
  });
  it("CTR with % shown when present", async () => {
    await downloadAdAsPdf({ network: "facebook", ctr: 3.5 });
    expect(mockDoc.text.mock.calls.some(c => Array.isArray(c[0]) ? c[0][0] === "3.5%" : c[0] === "3.5%")).toBe(true);
  });
});

describe("adPdf > Budget section", () => {
  it("rendered when any budget field present", async () => {
    await downloadAdAsPdf({
      budget: "$500/mo", lowerBudget: 100, upperBudget: 1000, advertiser: "X",
    });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "BUDGET")).toBe(true);
  });
  it("rendered when only ad_budget set (no other budget vars)", async () => {
    await downloadAdAsPdf({ adBudget: "$200", advertiser: "X" });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "BUDGET")).toBe(true);
  });
  it("skipped when no budget data", async () => {
    await downloadAdAsPdf({ advertiser: "X" });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "BUDGET")).toBe(false);
  });
});

describe("adPdf > Tech Stack section", () => {
  it("rendered with array builtWith joined", async () => {
    await downloadAdAsPdf({
      advertiser: "X",
      builtWith: ["Shopify", "WordPress"],
      builtWithFunnel: ["ClickFunnels"],
      cta: "Shop Now",
      keywords: ["a", "b"],
    });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "TECH STACK & TARGETING")).toBe(true);
  });
  it("non-array builtWith string preserved", async () => {
    await downloadAdAsPdf({ advertiser: "X", builtWith: "Shopify" });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "TECH STACK & TARGETING")).toBe(true);
  });
  it("skipped when all stack fields empty", async () => {
    await downloadAdAsPdf({ advertiser: "X" });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "TECH STACK & TARGETING")).toBe(false);
  });
});

describe("adPdf > Links section", () => {
  it("rendered with addLink call when URLs present", async () => {
    mockDoc.splitTextToSize.mockImplementation((t) => [t]);
    await downloadAdAsPdf({
      advertiser: "X",
      destinationUrl: "https://x.com/dest",
      adUrl: "https://x.com/ad",
    });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "LINKS")).toBe(true);
    expect(mockDoc.link).toHaveBeenCalled();
  });
  it("skipped when all URLs empty", async () => {
    await downloadAdAsPdf({ advertiser: "X" });
    expect(mockDoc.text.mock.calls.some(c => c[0] === "LINKS")).toBe(false);
  });
});

describe("adPdf > resolveStatValue impressions/ctr (lines 30-31)", () => {
  it("tiktok trio uses impressions + ctr (with % suffix)", async () => {
    await downloadAdAsPdf({
      advertiser: "X", network: "tiktok",
      impressions: 1234, likes: 50, ctr: 1.5,
    });
    // header text covers "1.2K" (impressions formatted) and "1.5%" (ctr)
    const allTexts = mockDoc.text.mock.calls.map(c => String(c[0])).join("|");
    expect(allTexts).toMatch(/Impressions/);
    expect(allTexts).toMatch(/CTR/);
  });
  it("tiktok with ctr=null → null value short-circuits row", async () => {
    await downloadAdAsPdf({
      advertiser: "X", network: "tiktok",
      impressions: 100, likes: 1, ctr: null,
    });
    expect(mockDoc.save).toHaveBeenCalled();
  });
});

describe("adPdf > unicode + long-word wrapping (lines 88-100, 104-105, 202-220)", () => {
  it("unicode value in drawRows triggers renderTextAsImage path", async () => {
    await downloadAdAsPdf({ advertiser: "BrändΩ漢字", network: "facebook" });
    // hasUnicode true → addImage called for the field
    expect(mockDoc.addImage).toHaveBeenCalled();
  });

  it("long word forces character-level chunk splitting", async () => {
    // Override measureText so that any text longer than 5 chars exceeds widthPx.
    // This forces the per-character chunk loop in wrapTextWithMeasurer.
    globalThis.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      font: "", fillStyle: "", textBaseline: "",
      measureText: (s) => ({ width: String(s).length * 1000 }),
      fillRect: vi.fn(), scale: vi.fn(), fillText: vi.fn(), clearRect: vi.fn(),
    }));
    const longWord = "supercalifragilisticexpialidocious"; // forces token > widthPx
    // Use unicode so drawRows enters renderTextAsImage → wrapTextWithMeasurer
    await downloadAdAsPdf({ advertiser: `é${longWord}`, network: "facebook" });
    expect(mockDoc.addImage).toHaveBeenCalled();
  });

  it("multi-word unicode that exceeds widthPx wraps to multiple lines (104-105)", async () => {
    // mid-range measurement: small tokens fit, accumulated cur eventually overflows
    let calls = 0;
    globalThis.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      font: "", fillStyle: "", textBaseline: "",
      measureText: (s) => {
        calls++;
        const len = String(s).length;
        // Single short tokens fit; accumulated > 4 chars overflows
        return { width: len > 4 ? 99999 : 10 };
      },
      fillRect: vi.fn(), scale: vi.fn(), fillText: vi.fn(), clearRect: vi.fn(),
    }));
    await downloadAdAsPdf({ advertiser: "é foo bar baz qux", network: "facebook" });
    expect(calls).toBeGreaterThan(0);
    expect(mockDoc.addImage).toHaveBeenCalled();
  });
});

describe("adPdf > timeline + engagement value cond-exprs (lines 332, 370)", () => {
  it("runningDays != null → renders '<N> days' (line 332 truthy)", async () => {
    await downloadAdAsPdf({ advertiser: "X", runningDays: 7 });
    const allRowValues = mockDoc.text.mock.calls.map((c) => String(c[0]));
    expect(allRowValues.some((v) => v.includes("7 days"))).toBe(true);
  });
  it("popularity != null → renders stringified popularity (line 370 truthy)", async () => {
    await downloadAdAsPdf({ advertiser: "X", popularity: 42 });
    const allRowValues = mockDoc.text.mock.calls.map((c) => String(c[0]));
    expect(allRowValues.some((v) => v === "42")).toBe(true);
  });
});

describe("adPdf > pagination + footer", () => {
  it("renders per-page footer for every page", async () => {
    mockDoc.internal.getNumberOfPages = () => 3;
    await downloadAdAsPdf({ advertiser: "X" });
    expect(mockDoc.setPage).toHaveBeenCalledWith(1);
    expect(mockDoc.setPage).toHaveBeenCalledWith(2);
    expect(mockDoc.setPage).toHaveBeenCalledWith(3);
    const footerCalls = mockDoc.text.mock.calls.filter(c =>
      typeof c[0] === "string" && c[0].includes("PowerAdspy")
    );
    expect(footerCalls.length).toBe(3);
  });
  it("ensureSpace triggers addPage when content overflows", async () => {
    // Force pageH to be tiny so ensureSpace flips early
    mockDoc.internal.pageSize.getHeight = () => 100;
    await downloadAdAsPdf({ advertiser: "X" });
    expect(mockDoc.addPage).toHaveBeenCalled();
  });
});

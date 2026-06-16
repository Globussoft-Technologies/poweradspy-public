import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  ExternalLink: () => <i data-testid="ext-ic" />,
  Copy: () => <i data-testid="copy-ic" />,
  Check: () => <i data-testid="check-ic" />,
  Link2: () => <i data-testid="link2-ic" />,
  ArrowRightLeft: () => <i data-testid="arl-ic" />,
  Globe: () => <i data-testid="globe-ic" />,
  RefreshCw: () => <i data-testid="rcw-ic" />,
  BookOpen: () => <i data-testid="book-ic" />,
  Layout: () => <i data-testid="layout-ic" />,
  Network: () => <i data-testid="net-ic" />,
  MapPin: () => <i data-testid="map-ic" />,
  ArrowRight: () => <i data-testid="ar-ic" />,
  Target: () => <i data-testid="target-ic" />,
}));

const useThemeMock = vi.fn(() => ({ theme: "dark" }));
vi.mock("../../../../src/hooks/useTheme", () => ({ useTheme: () => useThemeMock() }));

beforeEach(() => {
  useThemeMock.mockReturnValue({ theme: "dark" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: vi.fn() },
  });
});

import BasicInfo from "../../../../src/components/modals/analytics/BasicInfo.jsx";

describe("BasicInfo > platform-specific rows", () => {
  it("facebook (default): renders INITIAL / REDIRECT / Ad Url rows", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook"
        adDetails={{ destination_url: "http://dest.com", url: "http://redir.com", ad_url: "http://fb.com/post" }} />,
    );
    expect(getByText("INITIAL URL")).toBeInTheDocument();
    expect(getByText("REDIRECT URL")).toBeInTheDocument();
    expect(getByText("Ad Url")).toBeInTheDocument();
  });
  it("tiktok: renders INITIAL + AD LIBRARY LINK only", () => {
    const { getByText, queryByText } = render(
      <BasicInfo platform="tiktok"
        tiktokAnalytics={{ destination_url: "http://x.com", library_url: "http://tt.com" }} />,
    );
    expect(getByText("INITIAL URL")).toBeInTheDocument();
    expect(getByText("AD LIBRARY LINK")).toBeInTheDocument();
    expect(queryByText("REDIRECT URL")).toBeNull();
  });
  it("native: renders NETWORK / INITIAL / PLACEMENT rows", () => {
    const { getByText } = render(
      <BasicInfo platform="native"
        adDetails={{ network: "Outbrain", destination_url: "http://x.com", placement_url: "http://y.com" }} />,
    );
    expect(getByText("NETWORK")).toBeInTheDocument();
    expect(getByText("PLACEMENT URL")).toBeInTheDocument();
  });
  it("linkedin (urlOnly): renders INITIAL + REDIRECT only", () => {
    const { getByText, queryByText } = render(
      <BasicInfo platform="linkedin"
        adDetails={{ destination_url: "http://x.com", url: "http://y.com" }} />,
    );
    expect(getByText("INITIAL URL")).toBeInTheDocument();
    expect(getByText("REDIRECT URL")).toBeInTheDocument();
    expect(queryByText("Ad Url")).toBeNull();
  });
  it("reddit also urlOnly → no Ad Url row", () => {
    const { queryByText } = render(<BasicInfo platform="reddit" />);
    expect(queryByText("Ad Url")).toBeNull();
  });
  it("quora urlOnly", () => {
    const { getByText } = render(<BasicInfo platform="quora" />);
    expect(getByText("INITIAL URL")).toBeInTheDocument();
  });
  it("pinterest urlOnly", () => {
    const { getByText } = render(<BasicInfo platform="pinterest" />);
    expect(getByText("REDIRECT URL")).toBeInTheDocument();
  });
  // CopyBtn:84 (`if (!text) return;`) is an unreachable defensive guard — CopyBtn only renders
  // when url.value is truthy (lines 246, 316). Documented at #272.
  it("platform absent → (platform || '').toLowerCase() branch (line 28)", () => {
    const { container } = render(<BasicInfo adDetails={{ destination_url: "http://x.com" }} />);
    expect(container.innerHTML).toMatch(/INITIAL URL/);
  });
  it("google: INITIAL + REDIRECT rows only", () => {
    const { getByText, queryByText } = render(<BasicInfo platform="google" />);
    expect(getByText("INITIAL URL")).toBeInTheDocument();
    expect(getByText("REDIRECT URL")).toBeInTheDocument();
    expect(queryByText("Ad Url")).toBeNull();
  });
});

describe("BasicInfo > URL fallback chain", () => {
  it("market_platform_urls.url_destination used when destination_url missing", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook"
        adDetails={{ market_platform_urls: { url_destination: "http://mp.com" } }} />,
    );
    expect(getByText("http://mp.com")).toBeInTheDocument();
  });
  it("market_platform_urls.source_url used when destination + url_destination missing", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook"
        adDetails={{ market_platform_urls: { source_url: "http://src.com" } }} />,
    );
    expect(getByText("http://src.com")).toBeInTheDocument();
  });
  it("ad.destinationUrl fallback when adDetails missing everything", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook" ad={{ destinationUrl: "http://ad-fallback.com" }} />,
    );
    expect(getByText("http://ad-fallback.com")).toBeInTheDocument();
  });
  it("redirect: market_platform_urls.redirect_url fallback", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook"
        adDetails={{ market_platform_urls: { redirect_url: "http://r.com" } }} />,
    );
    expect(getByText("http://r.com")).toBeInTheDocument();
  });
  it("redirect: market_platform_urls.final_url fallback", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook"
        adDetails={{ market_platform_urls: { final_url: "http://f.com" } }} />,
    );
    expect(getByText("http://f.com")).toBeInTheDocument();
  });
  it("ad.adUrl used when adDetails.ad_url missing", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook" ad={{ adUrl: "http://card.com" }} />,
    );
    expect(getByText("http://card.com")).toBeInTheDocument();
  });
});

describe("BasicInfo > sanitizeUrl", () => {
  it("'null' string treated as empty", () => {
    const { getAllByText } = render(
      <BasicInfo platform="facebook" adDetails={{ destination_url: "null" }} />,
    );
    expect(getAllByText("—").length).toBeGreaterThan(0);
  });
  it("'undefined' string treated as empty", () => {
    const { getAllByText } = render(
      <BasicInfo platform="facebook" adDetails={{ destination_url: "undefined" }} />,
    );
    expect(getAllByText("—").length).toBeGreaterThan(0);
  });
  it("missing values render '—'", () => {
    const { getAllByText } = render(<BasicInfo platform="facebook" />);
    expect(getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("BasicInfo > outgoing links section", () => {
  it("renders when present + platform not hidden", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook"
        outgoingLinks={{ source_url: "http://s.com", final_url: "http://f.com" }} />,
    );
    expect(getByText("Out Going Links Flow")).toBeInTheDocument();
    expect(getByText("SOURCE URL")).toBeInTheDocument();
    expect(getByText("TARGET URL")).toBeInTheDocument();
  });
  it("hides section for tiktok", () => {
    const { queryByText } = render(
      <BasicInfo platform="tiktok"
        outgoingLinks={{ source_url: "http://s.com" }} />,
    );
    expect(queryByText("Out Going Links Flow")).toBeNull();
  });
  it("hides section for google, reddit, quora, pinterest, native", () => {
    for (const p of ["google", "reddit", "quora", "pinterest", "native"]) {
      const { queryByText } = render(
        <BasicInfo platform={p} outgoingLinks={{ source_url: "x" }} />,
      );
      expect(queryByText("Out Going Links Flow")).toBeNull();
    }
  });
  it("outgoingLinks as array → uses [0]", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook"
        outgoingLinks={[{ source_url: "http://from-arr.com" }, { source_url: "http://second.com" }]} />,
    );
    expect(getByText("http://from-arr.com")).toBeInTheDocument();
  });
  it("hidden when no outgoing data", () => {
    const { queryByText } = render(<BasicInfo platform="facebook" />);
    expect(queryByText("Out Going Links Flow")).toBeNull();
  });
  it("isLight outgoing links uses light styling (lines 267-297)", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(
      <BasicInfo platform="facebook"
        outgoingLinks={{ source_url: "http://s.com", redirect_url: "http://r.com", final_url: "http://f.com" }} />,
    );
    expect(container.innerHTML).toMatch(/text-gray-800/);
    expect(container.innerHTML).toMatch(/bg-gray-50\/50/);
  });
  it("outgoing links with stepRedirect renders STEP REDIRECT row", () => {
    const { getByText } = render(
      <BasicInfo platform="facebook"
        outgoingLinks={{ source_url: "http://s.com", redirect_url: "http://step.com", final_url: "http://f.com" }} />,
    );
    expect(getByText("STEP REDIRECT")).toBeInTheDocument();
    expect(getByText("http://step.com")).toBeInTheDocument();
  });
});

describe("BasicInfo > CopyBtn", () => {
  it("clicking copy writes to clipboard + briefly shows Check icon", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <BasicInfo platform="facebook"
        adDetails={{ destination_url: "http://dest.com" }} />,
    );
    const copyBtn = container.querySelector('[data-testid="copy-ic"]')?.closest("button");
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://dest.com");
    expect(container.querySelector('[data-testid="check-ic"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2100); });
    expect(container.querySelector('[data-testid="check-ic"]')).toBeNull();
    vi.useRealTimers();
  });
  it("clicking copy with empty text → no clipboard call", () => {
    const { container } = render(<BasicInfo platform="facebook" />);
    // No data → no copy button rendered (only ExternalLink absent too)
    const copyBtn = container.querySelector('[data-testid="copy-ic"]')?.closest("button");
    expect(copyBtn).toBeUndefined();
  });
});

describe("BasicInfo > CopyBtn light-theme copied state (line 94)", () => {
  it("light theme + copied → text-green-500 branch", () => {
    useThemeMock.mockReturnValue({ theme: "light" });
    const { container } = render(
      <BasicInfo platform="facebook"
        adDetails={{ destination_url: "http://x.com" }} />,
    );
    const copyBtn = container.querySelector('[data-testid="copy-ic"]').closest("button");
    fireEvent.click(copyBtn);
    expect(container.innerHTML).toMatch(/text-green-500/);
    useThemeMock.mockReturnValue({ theme: "dark" });
  });
});

describe("BasicInfo > theme styling", () => {
  it("isLight applies bg-gray-50 styling", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(
      <BasicInfo platform="facebook"
        adDetails={{ destination_url: "http://x.com" }} />,
    );
    expect(container.innerHTML).toMatch(/bg-gray-50/);
  });
});

describe("BasicInfo > multi-URL rows + redirect sanitize", () => {
  it("a field with '||' renders the multi-URL block with a count (lines 245-279)", () => {
    const { getByText, container } = render(
      <BasicInfo platform="facebook"
        adDetails={{ destination_url: "http://a.com||http://b.com", ad_url: "http://fb.com/post" }} />,
    );
    expect(getByText(/\(2\)/)).toBeInTheDocument();
    expect(container.innerHTML).toContain("http://a.com");
    expect(container.innerHTML).toContain("http://b.com");
  });
  it("multi-URL block in light theme (line 264 isLight branch)", () => {
    useThemeMock.mockReturnValue({ theme: "light" });
    const { getByText } = render(
      <BasicInfo platform="facebook"
        adDetails={{ destination_url: "http://a.com||http://b.com" }} />,
    );
    expect(getByText(/\(2\)/)).toBeInTheDocument();
    useThemeMock.mockReturnValue({ theme: "dark" });
  });
  it("literal 'null' redirect string is blanked out (lines 76-77)", () => {
    const { container } = render(
      <BasicInfo platform="facebook"
        adDetails={{ destination_url: "http://x.com", url: "null", ad_url: "http://fb.com/post" }} />,
    );
    expect(container.innerHTML).not.toContain(">null<");
  });
});

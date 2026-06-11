import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  ExternalLink: () => <i data-testid="extlink-ic" />,
  ShieldCheck: () => <i data-testid="shield-ic" />,
  Monitor: () => <i data-testid="mon-ic" />,
}));

const useThemeMock = vi.fn(() => ({ theme: "dark" }));
vi.mock("../../../../src/hooks/useTheme", () => ({ useTheme: () => useThemeMock() }));

beforeEach(() => {
  useThemeMock.mockReturnValue({ theme: "dark" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

import LanderDetails from "../../../../src/components/modals/analytics/LanderDetails.jsx";

describe("LanderDetails", () => {
  it("returns null when screenshotUrl falsy (processing)", () => {
    const { container } = render(<LanderDetails screenshotUrl="" />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when screenshotUrl includes 'processing.gif'", () => {
    const { container } = render(<LanderDetails screenshotUrl="/x/processing.gif" />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when screenshotUrl includes '[null]'", () => {
    const { container } = render(<LanderDetails screenshotUrl="[null]" />);
    expect(container.innerHTML).toBe("");
  });
  it("renders with absolute http URL", () => {
    const { getByText, getByAltText } = render(
      <LanderDetails screenshotUrl="http://x.com/img.png" />,
    );
    expect(getByText("Lander Details")).toBeInTheDocument();
    expect(getByAltText("Lander Screenshot").src).toBe("http://x.com/img.png");
  });
  it("parses JSON array string and uses first entry", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl='["http://x.com/first.png"]' />,
    );
    expect(getByAltText("Lander Screenshot").src).toBe("http://x.com/first.png");
  });
  it("invalid JSON array falls through to raw string", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="[malformed" />,
    );
    expect(getByAltText("Lander Screenshot").src).toContain("[malformed");
  });
  it("empty JSON array still parses (stays as '[]' string, treated as relative path)", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="[]" />,
    );
    // parseScreenshotUrl: arr.length===0, url stays "[]", treated as relative path
    expect(getByAltText("Lander Screenshot")).toBeInTheDocument();
  });
  it("absolute path (leading /) prepends NAS base", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="/path/img.png" />,
    );
    expect(getByAltText("Lander Screenshot").src).toContain("/path/img.png");
  });
  it("relative path (no leading /) prepends NAS base + '/'", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="path/img.png" />,
    );
    expect(getByAltText("Lander Screenshot").src).toContain("/path/img.png");
  });
  it("protocol-relative URL (//) is not treated as absolute path", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="//cdn.example/x.png" />,
    );
    // The src after // pass-through (URL constructor may normalize)
    expect(getByAltText("Lander Screenshot").src).toContain("cdn.example/x.png");
  });
  it("Visit link points to resolved URL", () => {
    const { getByText } = render(
      <LanderDetails screenshotUrl="http://x.com/y.png" />,
    );
    expect(getByText("Visit").closest("a").href).toBe("http://x.com/y.png");
  });
  it("img onError triggers null render on next render cycle", () => {
    const { getByAltText, container } = render(
      <LanderDetails screenshotUrl="http://x.com/y.png" />,
    );
    fireEvent.error(getByAltText("Lander Screenshot"));
    expect(container.innerHTML).toBe("");
  });
  it("resolvedUrl=null (JSON array with non-string) → href fallback '#' + 'No URL' text (lines 60, 86)", () => {
    const { getByText } = render(<LanderDetails screenshotUrl="[123]" />);
    expect(getByText("Visit").closest("a").getAttribute("href")).toBe("#");
    expect(getByText("No URL")).toBeInTheDocument();
  });
  it("light theme applies bg-white styling", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(
      <LanderDetails screenshotUrl="http://x.com/y.png" />,
    );
    expect(container.innerHTML).toMatch(/bg-white/);
  });
});

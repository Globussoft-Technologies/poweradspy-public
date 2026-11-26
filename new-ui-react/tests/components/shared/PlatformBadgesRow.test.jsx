import React from "react";
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import PlatformBadgesRow from "../../../src/components/shared/PlatformBadgesRow.jsx";

const logos = [
  { key: "gmp", src: "gmp.png", title: "Google Marketing Platform" },
  { key: "shopify", src: "shopify.png", title: "Shopify" },
  { key: "fb", src: "fb.png", title: "Facebook Pixel" },
  { key: "cb", src: "cb.png", title: "ClickBank" },
];

describe("PlatformBadgesRow", () => {
  it("renders nothing for empty logos", () => {
    const { container } = render(<PlatformBadgesRow allLogos={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("collapsed (overlapping) row: truncated names, no scrollbar class", () => {
    const { container, getByText } = render(<PlatformBadgesRow allLogos={logos} />);
    expect(getByText("Google…")).toBeInTheDocument();
    const row = container.firstChild;
    expect(row.className).not.toMatch(/badges-scrollbar/);
    expect(row.className).not.toMatch(/overflow-x-auto/);
  });

  it("expanded row: full names, horizontal scroll with visible scrollbar", () => {
    const { container, getByText } = render(<PlatformBadgesRow allLogos={logos} />);
    fireEvent.click(getByText("Google…"));
    expect(getByText("Google Marketing Platform")).toBeInTheDocument();
    expect(getByText("ClickBank")).toBeInTheDocument();
    const row = container.firstChild;
    expect(row.className).toMatch(/overflow-x-auto/);
    expect(row.className).toMatch(/badges-scrollbar/);
    expect(row.className).not.toMatch(/scrollbar-hide/);
  });

  it("clicking a chip again collapses back (scrollbar removed)", () => {
    const { container, getByText } = render(<PlatformBadgesRow allLogos={logos} />);
    fireEvent.click(getByText("Google…"));
    fireEvent.click(getByText("Shopify"));
    expect(getByText("Google…")).toBeInTheDocument();
    expect(container.firstChild.className).not.toMatch(/badges-scrollbar/);
  });

  it("single logo: plain chip, no scroll", () => {
    const { container, getByText } = render(<PlatformBadgesRow allLogos={[logos[0]]} />);
    expect(getByText("Google Marketing Platform")).toBeInTheDocument();
    expect(container.firstChild.className).not.toMatch(/badges-scrollbar/);
  });
});

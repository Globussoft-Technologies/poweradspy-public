import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("../../src/components/UserDetails.css", () => ({}));
vi.mock("../../src/assets/Social/Google-ads.png", () => ({ default: "gads.png" }));
vi.mock("../../src/assets/Social/fb.png", () => ({ default: "fb.png" }));
vi.mock("../../src/assets/Social/Google.png", () => ({ default: "google.png" }));
vi.mock("../../src/assets/Social/Linkedin.png", () => ({ default: "linkedin.png" }));
vi.mock("../../src/assets/Social/Pinterest.png", () => ({ default: "pinterest.png" }));
vi.mock("../../src/assets/Social/Quora.png", () => ({ default: "quora.png" }));
vi.mock("../../src/assets/Social/Reddit.png", () => ({ default: "reddit.png" }));

import AdCopySlide from "../../src/components/AdCopySlide.jsx";

const makeSession = (chats) => ({ chats });

describe("AdCopySlide", () => {
  it("returns null when no selectedSession", () => {
    const { container } = render(<AdCopySlide />);
    expect(container.innerHTML).toBe("");
  });
  it("shows empty-state when session has no adCopySide", () => {
    const { getByText } = render(
      <AdCopySlide selectedSession={makeSession([{ adCopySide: [] }])} />,
    );
    expect(getByText("No creative side data recorded")).toBeInTheDocument();
  });
  it("renders each adCopy item with Chat # badge", () => {
    const { getByText } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [{ brandName: "Nike", platform: "facebook", timestamp: 1700000000000 }] },
        { adCopySide: [{ brandName: "Adidas", platform: "google", timestamp: 1700000000000 }] },
      ])} />,
    );
    expect(getByText("Chat #1")).toBeInTheDocument();
    expect(getByText("Chat #2")).toBeInTheDocument();
    expect(getByText("Nike")).toBeInTheDocument();
    expect(getByText("Adidas")).toBeInTheDocument();
  });
  it.each([
    ["facebook", "fb.png"],
    ["google", "google.png"],
    ["google search ads", "google.png"],
    ["google_performance_max_ads", "google.png"],
    ["google_display_ads", "gads.png"],
    ["linkedin", "linkedin.png"],
    ["pinterest", "pinterest.png"],
    ["reddit", "reddit.png"],
  ])("renders %s platform icon", (platform, expectedSrc) => {
    const { container } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [{ brandName: "X", platform, timestamp: 0 }] },
      ])} />,
    );
    const img = Array.from(container.querySelectorAll("img"))
      .find(i => i.getAttribute("src") === expectedSrc);
    expect(img).toBeTruthy();
  });
  it("renders meta + twitter + google_video_ads icons (jsdelivr URLs)", () => {
    const { container } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [
          { brandName: "M", platform: "meta", timestamp: 0 },
          { brandName: "T", platform: "twitter", timestamp: 0 },
          { brandName: "V", platform: "google_video_ads", timestamp: 0 },
        ] },
      ])} />,
    );
    const srcs = Array.from(container.querySelectorAll("img")).map(i => i.getAttribute("src"));
    expect(srcs.some(s => s?.includes("meta.svg"))).toBe(true);
    expect(srcs.some(s => s?.includes("twitter.svg"))).toBe(true);
    expect(srcs.some(s => s?.includes("youtube.svg"))).toBe(true);
  });
  it("unknown platform → no platform icon rendered (null branch)", () => {
    const { container, getByText } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [{ brandName: "X", platform: "unknown_x", timestamp: 0 }] },
      ])} />,
    );
    // Platform text still appears as label
    expect(getByText("unknown_x")).toBeInTheDocument();
    // No image with platform-related src
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.length).toBe(0);
  });
  it("CTA section rendered when cta present", () => {
    const { getByText } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [{ brandName: "X", cta: "Click here", timestamp: 0 }] },
      ])} />,
    );
    expect(getByText("Click here")).toBeInTheDocument();
    expect(getByText("Call to Action")).toBeInTheDocument();
  });
  it("CTA section hidden when cta missing", () => {
    const { queryByText } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [{ brandName: "X", timestamp: 0 }] },
      ])} />,
    );
    expect(queryByText("Call to Action")).toBeNull();
  });
  it("brandDescription <= 300 chars renders fully, no read-more", () => {
    const { getByText, queryByText } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [{ brandName: "X", brandDescription: "short desc", timestamp: 0 }] },
      ])} />,
    );
    expect(getByText("short desc")).toBeInTheDocument();
    expect(queryByText("Read more")).toBeNull();
  });
  it("brandDescription > 300 chars shows truncated + Read more, toggles", () => {
    const longText = "a".repeat(400);
    const { getByText } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [{ brandName: "X", brandDescription: longText, timestamp: 0 }] },
      ])} />,
    );
    expect(getByText("Read more")).toBeInTheDocument();
    fireEvent.click(getByText("Read more"));
    expect(getByText("Read less")).toBeInTheDocument();
    fireEvent.click(getByText("Read less"));
    expect(getByText("Read more")).toBeInTheDocument();
  });
  it("brandDescription absent → no description block", () => {
    const { queryByText } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [{ brandName: "X", timestamp: 0 }] },
      ])} />,
    );
    expect(queryByText("Brand Description")).toBeNull();
  });
  it("chats without adCopySide are skipped", () => {
    const { getByText } = render(
      <AdCopySlide selectedSession={makeSession([
        { adCopySide: [] },
        { adCopySide: [{ brandName: "Visible", timestamp: 0 }] },
      ])} />,
    );
    // Visible item belongs to chatIndex=2
    expect(getByText("Chat #2")).toBeInTheDocument();
  });
});

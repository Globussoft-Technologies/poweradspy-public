import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MasonryCard from "../../../src/components/ads/MasonryCard.jsx";
import { ThemeProvider } from "../../../src/hooks/useTheme.jsx";

vi.mock("../../../src/services/adPdf", () => ({
  downloadAdAsPdf: vi.fn(),
}));

const renderCard = (ad) => render(
  <ThemeProvider>
    <MasonryCard ad={ad} onImageReady={vi.fn()} />
  </ThemeProvider>
);

describe("MasonryCard Google Transparency media", () => {
  it("shows the Transparency marker and mixed carousel media", () => {
    const { container } = renderCard({
      id: 18,
      adId: "CR18",
      network: "google",
      platform: 18,
      isGoogleTransparency: true,
      adType: "text",
      renderType: "image",
      advertiser: "GT advertiser",
      thumbnail: "https://cdn.example/primary.jpg",
      carouselMedia: [
        "https://cdn.example/carousel.jpg",
        "https://cdn.example/carousel.mp4",
      ],
      title: "Transparency creative",
    });

    expect(screen.getByText("Transparency")).toBeInTheDocument();
    expect(screen.getByTitle("Google Ads Transparency")).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
    expect(container.querySelector('img[src="https://cdn.example/primary.jpg"]'))
      .not.toBeNull();
    expect(container.querySelectorAll("button").length).toBeGreaterThanOrEqual(2);
  });
});

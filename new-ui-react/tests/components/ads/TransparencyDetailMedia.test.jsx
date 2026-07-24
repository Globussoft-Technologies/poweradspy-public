import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AdDetailModal from "../../../src/components/ads/AdDetailModal.jsx";
import OriginalPreview from "../../../src/components/ads/OriginalPreview.jsx";

vi.mock("../../../src/services/api", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createShareLink: vi.fn(),
    getAdCountry: vi.fn(async () => []),
    trackEvent: vi.fn(),
  };
});

vi.mock("../../../src/services/adPdf", () => ({
  downloadAdAsPdf: vi.fn(),
}));

const transparencyTextAd = {
  id: 18,
  adId: "CR18",
  network: "google",
  platform: 18,
  subnetwork: "shopping",
  isGoogleTransparency: true,
  adType: "text",
  renderType: "image",
  advertiser: "GT advertiser",
  title: "Text creative with image",
  thumbnail: "https://nas.example/creative.jpg",
  imageOriginalUrl: "https://source.example/original.png",
  carouselMedia: [],
};

describe("Google Transparency detail media", () => {
  it("renders a TEXT creative's image in the ad detail modal", () => {
    const { container } = render(
      <AdDetailModal
        ad={transparencyTextAd}
        onClose={vi.fn()}
        guest={{ showGuestWarning: vi.fn(() => false) }}
      />,
    );

    expect(screen.getAllByText("Text").length).toBeGreaterThan(0);
    expect(container.querySelector('img[src="https://nas.example/creative.jpg"]'))
      .not.toBeNull();
    expect(screen.getAllByText("SHOPPING").length).toBeGreaterThan(0);
    expect(container.querySelector(".lucide-monitor")).not.toBeNull();
  });

  it("shows only the source image in its original aspect preview", () => {
    const { container } = render(
      <OriginalPreview ad={transparencyTextAd} fillWidth />,
    );

    const image = container.querySelector(
      'img[src="https://source.example/original.png"]',
    );
    expect(image).not.toBeNull();
    expect(image).toHaveClass("h-auto", "object-contain");
    expect(container.querySelector('img[src="https://nas.example/creative.jpg"]'))
      .toBeNull();
  });

  it("uses that source image after clicking Original Preview in the modal", () => {
    const { container } = render(
      <AdDetailModal
        ad={transparencyTextAd}
        onClose={vi.fn()}
        guest={{ showGuestWarning: vi.fn(() => false) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Original Preview" }));
    expect(container.querySelector(
      'img[src="https://source.example/original.png"]',
    )).not.toBeNull();
  });
});

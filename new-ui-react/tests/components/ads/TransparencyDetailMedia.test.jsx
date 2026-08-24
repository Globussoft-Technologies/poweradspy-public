import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AdDetailModal from "../../../src/components/ads/AdDetailModal.jsx";
import OriginalPreview from "../../../src/components/ads/OriginalPreview.jsx";
import { fetchAdAiMeta } from "../../../src/services/api.js";

vi.mock("../../../src/services/api", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createShareLink: vi.fn(),
    fetchAdAiMeta: vi.fn(),
    getAdCountry: vi.fn(async () => []),
    trackEvent: vi.fn(),
  };
});

vi.mock("../../../src/services/adPdf", () => ({
  downloadAdAsPdf: vi.fn(),
}));

beforeEach(() => {
  fetchAdAiMeta.mockReset();
});

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

const transparencyVideoAd = {
  ...transparencyTextAd,
  id: 19,
  adId: "CR19",
  adType: "video",
  renderType: "video",
  title: "",
  adText: "",
  thumbnail: "https://nas.example/thumbnail.jpg",
  imageOriginalUrl: "https://i.ytimg.com/vi/qNa-n4e6Uik/hqdefault.jpg",
  videoOriginalUrl: "https://www.youtube.com/watch?v=qNa-n4e6Uik",
};

describe("Google Transparency detail media", () => {
  it("shows the AI-filtered result indicator only for AI-filtered searches", () => {
    const onAnalytics = vi.fn();
    const aiTaggedAd = {
      ...transparencyTextAd,
      ai_meta: {
        intent: ["conversion"],
        hook: ["discount"],
        offering: "luxury bags",
      },
    };
    const { container, rerender } = render(
      <AdDetailModal
        ad={aiTaggedAd}
        isAiFilteredResult
        onClose={vi.fn()}
        onAnalytics={onAnalytics}
        guest={{ showGuestWarning: vi.fn(() => false) }}
      />,
    );

    expect(screen.getByText("AI Analysed")).toBeInTheDocument();
    expect(screen.getByLabelText("Intent: conversion")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook: discount")).toBeInTheDocument();
    expect(screen.queryByText(/Offering: luxury bags/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("AI ad signals")).toBeInTheDocument();
    expect(fetchAdAiMeta).not.toHaveBeenCalled();
    expect(container.querySelector(".rounded-2xl.shadow-2xl")).toHaveClass("overflow-hidden");
    expect(screen.queryByRole("button", { name: "12 insights" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));
    expect(onAnalytics).toHaveBeenCalledWith(aiTaggedAd);

    rerender(
      <AdDetailModal
        ad={aiTaggedAd}
        isAiFilteredResult={false}
        onClose={vi.fn()}
        guest={{ showGuestWarning: vi.fn(() => false) }}
      />,
    );

    expect(screen.queryByText("AI Analysed")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Intent: conversion")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hook: discount")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "12 insights" })).not.toBeInTheDocument();
  });

  it("loads Intent and Hook when the search card omitted inline AI metadata", async () => {
    fetchAdAiMeta.mockResolvedValueOnce({
      intent: ["conversion"],
      hook: ["comparison", "social_proof"],
    });

    render(
      <AdDetailModal
        ad={transparencyTextAd}
        isAiFilteredResult
        onClose={vi.fn()}
        guest={{ showGuestWarning: vi.fn(() => false) }}
      />,
    );

    expect(await screen.findByLabelText("Intent: conversion")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook: comparison")).toHaveAttribute(
      "title",
      "Hook: comparison, social proof",
    );
    expect(screen.queryByLabelText("Hook: comparison, social proof")).not.toBeInTheDocument();
    expect(fetchAdAiMeta).toHaveBeenCalledWith(expect.objectContaining({
      network: "google",
      adId: "CR18",
      internalId: null,
    }));
  });

  it("disables Advanced Analytics without invoking its navigation callback", () => {
    const onAnalytics = vi.fn();
    render(
      <AdDetailModal
        ad={transparencyTextAd}
        onClose={vi.fn()}
        onAnalytics={onAnalytics}
        analyticsAllowed={false}
        guest={{ showGuestWarning: vi.fn(() => false) }}
      />,
    );

    const analyticsButton = screen.getByRole("button", { name: "Analytics" });
    expect(analyticsButton).toBeDisabled();
    fireEvent.click(analyticsButton);
    expect(onAnalytics).not.toHaveBeenCalled();
  });

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

  it("shows the thumbnail before loading the original YouTube video", () => {
    const { container } = render(
      <OriginalPreview ad={transparencyVideoAd} fillWidth />,
    );

    expect(container.querySelector(
      'img[src="https://i.ytimg.com/vi/qNa-n4e6Uik/hqdefault.jpg"]',
    )).not.toBeNull();
    expect(container.querySelector(
      'iframe[src*="youtube.com/embed/qNa-n4e6Uik"]',
    )).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play original video" }));
    expect(container.querySelector(
      'iframe[src*="youtube.com/embed/qNa-n4e6Uik"]',
    )).not.toBeNull();
    expect(screen.getByTestId("transparency-original-video")).toBeInTheDocument();
    expect(screen.queryByText("Sponsored")).toBeNull();
  });

  it("shows the original video after clicking Original Preview in the modal", () => {
    const { container } = render(
      <AdDetailModal
        ad={transparencyVideoAd}
        onClose={vi.fn()}
        guest={{ showGuestWarning: vi.fn(() => false) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Original Preview" }));
    expect(container.querySelector(
      'img[src="https://i.ytimg.com/vi/qNa-n4e6Uik/hqdefault.jpg"]',
    )).not.toBeNull();
    expect(container.querySelector(
      'iframe[src*="youtube.com/embed/qNa-n4e6Uik"]',
    )).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play original video" }));
    expect(container.querySelector(
      'iframe[src*="youtube.com/embed/qNa-n4e6Uik"]',
    )).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show Saved Preview" }))
      .toBeInTheDocument();
  });

  it("loads a direct original video only after its thumbnail is clicked", () => {
    const directVideo = {
      ...transparencyVideoAd,
      videoOriginalUrl: "https://cdn.example/original.mp4",
    };
    const { container } = render(
      <OriginalPreview ad={directVideo} />,
    );

    expect(container.querySelector(
      'img[src="https://i.ytimg.com/vi/qNa-n4e6Uik/hqdefault.jpg"]',
    )).not.toBeNull();
    expect(container.querySelector(
      'video[src="https://cdn.example/original.mp4"]',
    )).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play original video" }));
    const video = container.querySelector(
      'video[src="https://cdn.example/original.mp4"]',
    );
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute(
      "poster",
      "https://i.ytimg.com/vi/qNa-n4e6Uik/hqdefault.jpg",
    );
  });

  it("shows an othermultimedia video frame and plays it only after click", () => {
    const multimediaAd = {
      ...transparencyTextAd,
      adType: "image",
      renderType: "image",
      carouselMedia: [
        "https://nas.example/other.jpg",
        "https://nas.example/other.mp4",
      ],
    };
    const { container } = render(
      <AdDetailModal
        ad={multimediaAd}
        onClose={vi.fn()}
        guest={{ showGuestWarning: vi.fn(() => false) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next media" }));
    fireEvent.click(screen.getByRole("button", { name: "Next media" }));

    const preview = container.querySelector(
      'video[src="https://nas.example/other.mp4"]',
    );
    expect(preview).not.toBeNull();
    expect(preview).not.toHaveAttribute("autoplay");
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(container.querySelector(
      'video[src="https://nas.example/other.mp4"][controls]',
    )).not.toBeNull();
  });

  it("shows the original copy for a media-less Transparency text ad", () => {
    render(
      <OriginalPreview
        ad={{
          ...transparencyTextAd,
          id: 179630,
          title: "",
          adText: "Quels que soient vos besoins, obtenez de superbes résultats.",
          thumbnail: "",
          imageOriginalUrl: "",
          renderType: "text",
        }}
      />,
    );

    expect(screen.getByTestId("transparency-original-text")).toBeInTheDocument();
    expect(screen.getByText(
      "Quels que soient vos besoins, obtenez de superbes résultats.",
    )).toBeInTheDocument();
    expect(screen.queryByText("Text Ad")).toBeNull();
    expect(screen.getByText("Sponsored")).toBeInTheDocument();
  });
});

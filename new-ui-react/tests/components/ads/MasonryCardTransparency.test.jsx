import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MasonryCard from "../../../src/components/ads/MasonryCard.jsx";
import { ThemeProvider } from "../../../src/hooks/useTheme.jsx";
import { mapAdToCard } from "../../../src/services/api.js";

vi.mock("../../../src/services/adPdf", () => ({
  downloadAdAsPdf: vi.fn(),
}));

const renderCard = (ad) => render(
  <ThemeProvider>
    <MasonryCard ad={ad} onImageReady={vi.fn()} />
  </ThemeProvider>
);

describe("MasonryCard Google Transparency media", () => {
  it("renders and plays a shared YouTube ad with the default placeholder", () => {
    const ad = mapAdToCard({
      id: 5086296,
      ad_id: 5086296,
      network: "youtube",
      type: "VIDEO",
      image_video_url: "https://media.globussoft.com/pas-prod/stream/bydefault_ads.png",
      ad_image_video: null,
      ad_url: "https://www.youtube.com/watch?v=lW2v-F20ecI",
      ad_title: "Main Koi Aisa Geet Gaoon",
      post_owner: "Kishore Kumar Official",
    });
    const { container } = renderCard(ad);

    expect(screen.getByText("Kishore Kumar Official")).toBeInTheDocument();
    expect(container.querySelector('img[src*="bydefault_ads.png"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(container.querySelector('iframe[src*="youtube.com/embed/lW2v-F20ecI"]'))
      .not.toBeNull();
  });

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

  it("keeps the play button on a video poster when other multimedia exists", () => {
    const { container } = renderCard({
      id: 179597,
      adId: "CR10857860401563959297",
      network: "google",
      platform: 18,
      isGoogleTransparency: true,
      adType: "video",
      renderType: "video",
      advertiser: "Sony",
      thumbnail: "https://media.example/179597.jpeg",
      videoUrl: "",
      videoOriginalUrl: "https://www.youtube.com/watch?v=eFNNSbCr_MU",
      carouselMedia: [
        "https://media.example/other.jpg",
        "https://media.example/other.mp4",
      ],
      title: "Video creative",
    });

    expect(container.querySelector('img[src="https://media.example/179597.jpeg"]'))
      .not.toBeNull();
    const playButton = screen.getByRole("button", { name: "Play video" });
    expect(playButton).toBeInTheDocument();

    fireEvent.click(playButton);
    expect(container.querySelector('iframe[src*="youtube.com/embed/eFNNSbCr_MU"]'))
      .not.toBeNull();
  });

  it("shows Play when a direct-video othermultimedia slide becomes active", () => {
    const { container } = renderCard({
      id: 19,
      network: "google",
      platform: 18,
      isGoogleTransparency: true,
      adType: "video",
      renderType: "video",
      thumbnail: "https://media.example/poster.jpeg",
      videoOriginalUrl: "https://www.youtube.com/watch?v=eFNNSbCr_MU",
      carouselMedia: [
        "https://media.example/other.jpg",
        "https://media.example/other.mp4",
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Next media" }));
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next media" }));
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
    expect(container.querySelector('video[src="https://media.example/other.mp4"]'))
      .not.toBeNull();
  });

  it("plays a YouTube othermultimedia carousel slide", () => {
    const { container } = renderCard({
      id: 20,
      network: "google",
      platform: 18,
      isGoogleTransparency: true,
      adType: "video",
      renderType: "video",
      thumbnail: "https://media.example/poster.jpeg",
      videoOriginalUrl: "https://www.youtube.com/watch?v=eFNNSbCr_MU",
      carouselMedia: [
        "https://media.example/other.jpg",
        "https://www.youtube.com/watch?v=xconjdiGFLs",
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Next media" }));
    fireEvent.click(screen.getByRole("button", { name: "Next media" }));
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(container.querySelector('iframe[src*="youtube.com/embed/xconjdiGFLs"]'))
      .not.toBeNull();
  });

  it("renders a text-only Transparency ad's real copy instead of a generic label", () => {
    renderCard({
      id: 179630,
      network: "google",
      platform: 18,
      isGoogleTransparency: true,
      adType: "text",
      renderType: "text",
      advertiser: "Canon Europa N.V.",
      title: "",
      adText: "Quels que soient vos besoins, obtenez de superbes résultats.",
    });

    expect(screen.getByText(
      "Quels que soient vos besoins, obtenez de superbes résultats.",
    )).toBeInTheDocument();
    expect(screen.queryByText("Text Ad")).toBeNull();
  });
});

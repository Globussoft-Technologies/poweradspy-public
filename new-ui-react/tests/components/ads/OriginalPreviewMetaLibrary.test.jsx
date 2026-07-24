import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OriginalPreview from "../../../src/components/ads/OriginalPreview.jsx";

const baseAd = {
  advertiser: "Example advertiser",
  title: "Example ad",
  subtitle: "Example copy",
  thumbnail: "https://example.com/ad.jpg",
  likes: "12",
  comments: "3",
  shares: "4",
  adType: "image",
};

describe("Meta Ads Library original previews", () => {
  it("hides Facebook likes, comments, shares, and their action bar", () => {
    render(
      <OriginalPreview
        ad={{ ...baseAd, network: "facebook", platform: 15, isMetaLib: true }}
        fillWidth
      />,
    );

    expect(screen.queryByText("12 Likes")).not.toBeInTheDocument();
    expect(screen.queryByText(/3 Comments/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Like" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("hides Instagram engagement while retaining the ad copy", () => {
    const { container } = render(
      <OriginalPreview
        ad={{ ...baseAd, network: "instagram", platform: 15, isMetaLib: true }}
        fillWidth
      />,
    );

    expect(screen.queryByText("12 likes")).not.toBeInTheDocument();
    expect(screen.getByText("Example copy")).toBeInTheDocument();
    expect(container.querySelector(".lucide-heart")).toBeNull();
    expect(container.querySelector(".lucide-message-circle")).toBeNull();
    expect(container.querySelector(".lucide-send")).toBeNull();
  });

  it("keeps engagement visible for regular Facebook originals", () => {
    render(
      <OriginalPreview
        ad={{ ...baseAd, network: "facebook", isMetaLib: false }}
        fillWidth
      />,
    );

    expect(screen.getByText("12 Likes")).toBeInTheDocument();
    expect(screen.getByText(/3 Comments/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Like" })).toBeInTheDocument();
  });
});

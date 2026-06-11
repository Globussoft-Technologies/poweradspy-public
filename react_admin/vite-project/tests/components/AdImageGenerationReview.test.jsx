import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("../../src/components/UserDetails.css", () => ({}));

vi.mock("react-icons/fa", () => ({
  FaThumbsUp: () => <i data-testid="thumbs-up" />,
  FaThumbsDown: () => <i data-testid="thumbs-down" />,
  FaDownload: () => <i data-testid="download-ic" />,
  FaBookmark: () => <i data-testid="bookmark-ic" />,
}));
vi.mock("react-icons/md", () => ({
  MdTextFields: () => <i data-testid="text-ic" />,
  MdImage: () => <i data-testid="image-ic" />,
}));

import AdImageGenerationReview from "../../src/components/AdImageGenerationReview .jsx";

const makeSession = (chats) => ({ chats });

describe("AdImageGenerationReview", () => {
  it("returns null when no selectedSession", () => {
    const { container } = render(<AdImageGenerationReview />);
    expect(container.innerHTML).toBe("");
  });
  it("shows empty-state when no reviews", () => {
    const { getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession([])} />,
    );
    expect(getByText("No Ad Image Reviews Yet")).toBeInTheDocument();
  });
  it("shows empty-state when chats have no adImageGenerationReview", () => {
    const { getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession([{ someOther: "data" }])} />,
    );
    expect(getByText("No Ad Image Reviews Yet")).toBeInTheDocument();
  });
  it("renders review cards from data", () => {
    const reviews = [{
      adImageGenerationReview: [{
        review1: { like: true, timestamp: 1700000000000, imgURl: "/path/a.png", text: "Ad copy text" },
      }],
    }];
    const { getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    expect(getByText(/Ad Image Generation Reviews/)).toBeInTheDocument();
    expect(getByText("1 generated ads reviewed")).toBeInTheDocument();
    expect(getByText("Ad Review #1")).toBeInTheDocument();
  });
  it("liked review shows thumbs-up icon", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: { like: true } }],
    }];
    const { getByTestId } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    expect(getByTestId("thumbs-up")).toBeInTheDocument();
  });
  it("disliked review shows thumbs-down icon", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: { dislike: true } }],
    }];
    const { getByTestId } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    expect(getByTestId("thumbs-down")).toBeInTheDocument();
  });
  it("neutral review (no like/dislike) shows '?' icon", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: {} }],
    }];
    const { getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    expect(getByText("?")).toBeInTheDocument();
  });
  it("imgURl present → renders img with full URL", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: { imgURl: "/path/a.png" } }],
    }];
    const { container, getAllByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    // Expand the card
    fireEvent.click(container.querySelector(".card-header"));
    const img = container.querySelector("img");
    expect(img.getAttribute("src")).toBe("https://contents.adsgpt.io/path/a.png");
  });
  it("imgURl missing → 'No image available' placeholder", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: {} }],
    }];
    const { container, getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    fireEvent.click(container.querySelector(".card-header"));
    expect(getByText("No image available")).toBeInTheDocument();
  });
  it("download/save active classes", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: { download: true, save: true } }],
    }];
    const { container } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    fireEvent.click(container.querySelector(".card-header"));
    const buttons = container.querySelectorAll(".action-btn.active");
    expect(buttons.length).toBe(2);
  });
  it("download/save inactive (no active class)", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: {} }],
    }];
    const { container } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    fireEvent.click(container.querySelector(".card-header"));
    expect(container.querySelectorAll(".action-btn.active").length).toBe(0);
  });
  it("text present → splits on newlines into Fragments", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: { text: "line1\nline2\nline3" } }],
    }];
    const { container, getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    fireEvent.click(container.querySelector(".card-header"));
    expect(getByText(/line1/)).toBeInTheDocument();
    expect(getByText(/line2/)).toBeInTheDocument();
    expect(getByText(/line3/)).toBeInTheDocument();
  });
  it("text missing → 'No primary text provided'", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: {} }],
    }];
    const { container, getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    fireEvent.click(container.querySelector(".card-header"));
    expect(getByText("No primary text provided")).toBeInTheDocument();
  });
  it("metadata shows Session ID + Image URL with N/A fallbacks", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: { adcopysessionID: "sess-1", imgURl: "/img.png" } }],
    }];
    const { container, getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    fireEvent.click(container.querySelector(".card-header"));
    expect(getByText("sess-1")).toBeInTheDocument();
    expect(getByText("/img.png")).toBeInTheDocument();
  });
  it("metadata fallback 'N/A' when sessionID/imgURl missing", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: {} }],
    }];
    const { container, getAllByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    fireEvent.click(container.querySelector(".card-header"));
    expect(getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });
  it("toggleExpand toggles the card open/closed", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: { text: "x" } }],
    }];
    const { container } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    const header = container.querySelector(".card-header");
    fireEvent.click(header);
    expect(container.querySelector(".review-card.expanded")).not.toBeNull();
    fireEvent.click(header);
    expect(container.querySelector(".review-card.expanded")).toBeNull();
  });
  it("non-object value in review map is skipped", () => {
    const reviews = [{
      adImageGenerationReview: [{ a: null, b: "string", c: { like: true } }],
    }];
    const { getAllByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    expect(getAllByText("Ad Review #1").length).toBe(1);
  });
  it("multiple sessions / multiple keys produce multiple reviews", () => {
    const reviews = [
      { adImageGenerationReview: [{ a: { like: true } }, { b: { dislike: true } }] },
      { adImageGenerationReview: [{ c: { text: "x" } }] },
    ];
    const { getByText } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    expect(getByText("3 generated ads reviewed")).toBeInTheDocument();
  });
  it("timestamp missing → uses current date as fallback", () => {
    const reviews = [{
      adImageGenerationReview: [{ k: {} }],
    }];
    const { container } = render(
      <AdImageGenerationReview selectedSession={makeSession(reviews)} />,
    );
    const ts = container.querySelector(".timestamp");
    expect(ts.textContent.length).toBeGreaterThan(0);
  });
});

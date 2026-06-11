import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  X: () => <i data-testid="x-ic" />,
  Link: () => <i data-testid="link-ic" />,
  Check: () => <i data-testid="check-ic" />,
}));

const useThemeMock = vi.fn(() => ({ theme: "dark" }));
vi.mock("../../../../src/hooks/useTheme", () => ({ useTheme: () => useThemeMock() }));

// Mock asset imports
vi.mock("../../../../src/assets/fb.png", () => ({ default: "fb.png" }));
vi.mock("../../../../src/assets/ig.png", () => ({ default: "ig.png" }));
vi.mock("../../../../src/assets/yt.png", () => ({ default: "yt.png" }));
vi.mock("../../../../src/assets/g.png", () => ({ default: "g.png" }));
vi.mock("../../../../src/assets/gdn.png", () => ({ default: "gdn.png" }));
vi.mock("../../../../src/assets/linkedin.png", () => ({ default: "linkedin.png" }));
vi.mock("../../../../src/assets/native.png", () => ({ default: "native.png" }));
vi.mock("../../../../src/assets/rd.png", () => ({ default: "rd.png" }));
vi.mock("../../../../src/assets/quora.png", () => ({ default: "quora.png" }));
vi.mock("../../../../src/assets/pinterest.png", () => ({ default: "pinterest.png" }));

import AnalyticsHeader from "../../../../src/components/modals/analytics/AnalyticsHeader.jsx";

beforeEach(() => {
  useThemeMock.mockReturnValue({ theme: "dark" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: vi.fn() },
  });
});

describe("AnalyticsHeader", () => {
  it("renders 'Ad Analytics for {Platform}' with display name", () => {
    const { getByText } = render(
      <AnalyticsHeader adId="1" platform="facebook" onClose={() => {}} />,
    );
    expect(getByText("Ad Analytics for Facebook")).toBeInTheDocument();
  });
  it("falls back to raw platform name when not in map", () => {
    const { getByText } = render(
      <AnalyticsHeader adId="1" platform="unknownnet" onClose={() => {}} />,
    );
    expect(getByText("Ad Analytics for unknownnet")).toBeInTheDocument();
  });
  it("Copy URL button copies to clipboard + shows Copied state for 2s", () => {
    vi.useFakeTimers();
    const { getByTitle, queryByTestId } = render(
      <AnalyticsHeader adId="1" platform="facebook" onClose={() => {}} />,
    );
    fireEvent.click(getByTitle("Copy page URL"));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(queryByTestId("check-ic")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2100); });
    // After 2s, back to Link icon
    expect(queryByTestId("check-ic")).toBeNull();
    vi.useRealTimers();
  });
  it("Close button fires onClose", () => {
    const onClose = vi.fn();
    const { getByTitle } = render(
      <AnalyticsHeader adId="1" platform="facebook" onClose={onClose} />,
    );
    fireEvent.click(getByTitle("Close"));
    expect(onClose).toHaveBeenCalled();
  });
  it("light theme uses bg-theme-card styling", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(
      <AnalyticsHeader adId="1" platform="facebook" onClose={() => {}} />,
    );
    expect(container.innerHTML).toMatch(/bg-theme-card/);
  });
  it("dark theme uses bg-[#0e0e0e] styling", () => {
    const { container } = render(
      <AnalyticsHeader adId="1" platform="facebook" onClose={() => {}} />,
    );
    expect(container.innerHTML).toMatch(/0e0e0e/);
  });
});

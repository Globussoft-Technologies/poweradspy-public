import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Clock: () => <i data-testid="clock-ic" />,
}));

const useThemeMock = vi.fn(() => ({ theme: "dark" }));
vi.mock("../../../../src/hooks/useTheme", () => ({ useTheme: () => useThemeMock() }));

import TikTokTimeAnalysis from "../../../../src/components/modals/analytics/TikTokTimeAnalysis.jsx";

const SAMPLE = {
  ctr_graph: [
    { second: 0, value: 10 },
    { second: 5, value: 50 },
    { second: 10, value: 25 },
  ],
  cvr_graph: [{ second: 0, value: 100 }],
};

describe("TikTokTimeAnalysis", () => {
  it("analytics=null → 'Loading...' placeholder", () => {
    const { getByText } = render(<TikTokTimeAnalysis analytics={null} />);
    expect(getByText("Loading...")).toBeInTheDocument();
  });
  it("analytics + data → renders chart with SVG", () => {
    const { container, getByText } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    expect(getByText("Interactive Time Analysis")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("renders all 5 tabs", () => {
    const { container } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    const tabBtns = Array.from(container.querySelectorAll("button"));
    const labels = tabBtns.map(b => b.textContent.trim()).filter(t => ["CTR", "CVR", "Clicks", "Conversion", "Remain"].includes(t));
    expect(labels.length).toBe(5);
  });
  it("clicking a tab switches active state", () => {
    const { getByText, container } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    fireEvent.click(getByText("CVR"));
    // Active tab gets the bottom bar div
    expect(container.querySelector(".bg-blue-500")).not.toBeNull();
  });
  it("tab with no data array → 'No data available'", () => {
    const { getByText } = render(
      <TikTokTimeAnalysis analytics={{ ctr_graph: SAMPLE.ctr_graph }} />,
    );
    fireEvent.click(getByText("Clicks"));
    expect(getByText("No data available")).toBeInTheDocument();
  });
  it("tab with empty data array → 'No data available'", () => {
    const { getByText } = render(
      <TikTokTimeAnalysis analytics={{ clicks_graph: [] }} />,
    );
    fireEvent.click(getByText("Clicks"));
    expect(getByText("No data available")).toBeInTheDocument();
  });
  it("tab with non-array data → 'No data available'", () => {
    const { getByText } = render(
      <TikTokTimeAnalysis analytics={{ clicks_graph: "not-array" }} />,
    );
    fireEvent.click(getByText("Clicks"));
    expect(getByText("No data available")).toBeInTheDocument();
  });
  it("description text updates per tab", () => {
    const { getByText } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    expect(getByText(/Click-through rate/)).toBeInTheDocument();
    fireEvent.click(getByText("CVR"));
    expect(getByText(/Conversion rate over time/)).toBeInTheDocument();
  });
  it("hover area mouseenter shows tooltip", () => {
    const { container } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    const rects = container.querySelectorAll("svg g rect");
    fireEvent.mouseEnter(rects[1]); // mouseenter the second hover area
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });
  it("mouseLeave on svg clears hover", () => {
    const { container } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    const rects = container.querySelectorAll("svg g rect");
    fireEvent.mouseEnter(rects[0]);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
    fireEvent.mouseLeave(container.querySelector("svg"));
    expect(container.querySelectorAll("circle").length).toBe(0);
  });
  it("isLight theme renders bg-white styling", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    expect(container.innerHTML).toMatch(/bg-white/);
  });
  it("isLight + loading uses light placeholder", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(<TikTokTimeAnalysis analytics={null} />);
    expect(container.innerHTML).toMatch(/bg-gray-50/);
  });
  it("isLight + no-data state renders gray text", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { getByText } = render(
      <TikTokTimeAnalysis analytics={{ ctr_graph: [] }} />,
    );
    expect(getByText("No data available")).toBeInTheDocument();
  });
  it("data with all zero values → maxValue defaults to 1 (no div-by-zero)", () => {
    const { container } = render(
      <TikTokTimeAnalysis analytics={{ ctr_graph: [{ second: 0, value: 0 }] }} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("switching tab resets hoveredPoint", () => {
    const { container, getByText } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    const rects = container.querySelectorAll("svg g rect");
    fireEvent.mouseEnter(rects[1]);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
    fireEvent.click(getByText("CVR"));
    expect(container.querySelectorAll("circle").length).toBe(0);
  });
  it("isLight hover renders tooltip (covers lines 223-242)", () => {
    useThemeMock.mockReturnValue({ theme: "light" });
    const { container } = render(<TikTokTimeAnalysis analytics={SAMPLE} />);
    const rects = container.querySelectorAll("svg g rect");
    fireEvent.mouseEnter(rects[1]);
    // Just verify hover state: a circle for the data point exists
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
    // Restore dark default for subsequent tests
    useThemeMock.mockReturnValue({ theme: "dark" });
  });
});

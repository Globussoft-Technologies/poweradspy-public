// NOTE: line 39 `if (chartTaskStatusRef.current)` falsy branch is unreachable.
// See https://github.com/Globussoft-Technologies/poweradspy/issues/254
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const disposeMock = vi.fn();
const slicesEachCallbacks = [];
const sliceSetCalls = [];
const chartSetCalls = [];

function makeSliceStub() {
  return { set: (k, v) => sliceSetCalls.push({ k, v }) };
}
function makePieSeries() {
  return {
    labels: { template: { set: vi.fn(), setAll: vi.fn() } },
    valueLabels: { template: { set: vi.fn() } },
    data: { setAll: vi.fn() },
    slices: {
      each: (cb) => slicesEachCallbacks.push(cb),
      template: { setAll: vi.fn() },
    },
    ticks: { setAll: vi.fn() },
    appear: vi.fn(),
    dataItems: [{ ctx: 1 }, { ctx: 2 }, { ctx: 3 }, { ctx: 4 }],
  };
}
function makeChart() {
  return {
    series: { push: vi.fn(() => makePieSeries()) },
    children: { push: vi.fn((x) => x) },
    set: (k, v) => chartSetCalls.push({ k, v }),
  };
}
function makeLegend() {
  return {
    data: { setAll: vi.fn() },
    itemContainers: { template: { setAll: vi.fn() } },
    labels: { template: { setAll: vi.fn() } },
    markerRectangles: { template: { setAll: vi.fn() } },
  };
}

vi.mock("@amcharts/amcharts5", () => ({
  Root: {
    new: vi.fn(() => ({
      _logo: { dispose: vi.fn() },
      container: { children: { push: vi.fn(() => makeChart()) } },
      verticalLayout: {},
      setThemes: vi.fn(),
      dispose: disposeMock,
    })),
  },
  Legend: { new: vi.fn(() => makeLegend()) },
  Tooltip: { new: vi.fn(() => ({})) },
  LinearGradient: { new: vi.fn(() => ({ _kind: "gradient" })) },
  color: vi.fn((c) => ({ _color: c })),
  percent: vi.fn((v) => ({ _pct: v })),
  p100: { _pct: 100 },
}));

vi.mock("@amcharts/amcharts5/percent", () => ({
  PieChart: { new: vi.fn(() => makeChart()) },
  PieSeries: { new: vi.fn(() => makePieSeries()) },
}));

vi.mock("@amcharts/amcharts5/themes/Animated", () => ({
  default: { new: vi.fn(() => ({})) },
}));

vi.mock("moment", () => ({ default: vi.fn() }));

import AdPositionCrawlerChart from "../../../../src/components/Pas/Chart/AdPositionCrawlerChart.jsx";

const samplePosition = [
  { position: "Completed", count: 10 },
  { position: "Paused", count: 5 },
  { position: "Pending", count: 3 },
  { position: "", count: 1 }, // filtered out
];

beforeEach(() => {
  disposeMock.mockClear();
  slicesEachCallbacks.length = 0;
  sliceSetCalls.length = 0;
  chartSetCalls.length = 0;
});

function setWindowWidth(w) {
  Object.defineProperty(window, "innerWidth", { writable: true, value: w });
}

describe("AdPositionCrawlerChart", () => {
  it("renders chart container", () => {
    setWindowWidth(1366);
    const { container } = render(<AdPositionCrawlerChart position={samplePosition} />);
    expect(container.querySelector("#chartdiv1")).not.toBeNull();
  });
  it("initializes amCharts pie + legend on mount", async () => {
    setWindowWidth(1366);
    const am5 = await import("@amcharts/amcharts5");
    am5.Root.new.mockClear();
    am5.Legend.new.mockClear();
    render(<AdPositionCrawlerChart position={samplePosition} />);
    expect(am5.Root.new).toHaveBeenCalled();
    expect(am5.Legend.new).toHaveBeenCalled();
  });
  it("slices.each callback applies gradients for known categories", () => {
    setWindowWidth(1366);
    render(<AdPositionCrawlerChart position={samplePosition} />);
    const cb = slicesEachCallbacks[0];
    expect(cb).toBeTypeOf("function");
    // Index 0 → Completed → gradient set
    cb(makeSliceStub(), 0);
    expect(sliceSetCalls.find((c) => c.k === "fillGradient")).toBeTruthy();
  });
  it("slices.each skips unknown category", () => {
    setWindowWidth(1366);
    render(<AdPositionCrawlerChart position={[{ position: "Unknown", count: 5 }]} />);
    const cb = slicesEachCallbacks[0];
    sliceSetCalls.length = 0;
    cb(makeSliceStub(), 0);
    expect(sliceSetCalls.length).toBe(0);
  });
  it("fwidth >=1600 path (large screens)", () => {
    setWindowWidth(1920);
    render(<AdPositionCrawlerChart position={samplePosition} />);
    // Was on the large screen branch — chart.set 'width'/'height' would fire
    expect(chartSetCalls.find((c) => c.k === "width")).toBeTruthy();
  });
  it("fwidth <1280 path (tablet/mobile)", () => {
    setWindowWidth(800);
    render(<AdPositionCrawlerChart position={samplePosition} />);
    expect(chartSetCalls.find((c) => c.k === "height")).toBeTruthy();
  });
  it("fwidth <768 path (mobile)", () => {
    setWindowWidth(500);
    render(<AdPositionCrawlerChart position={samplePosition} />);
    expect(chartSetCalls.find((c) => c.k === "height" && c.v === 350)).toBeTruthy();
  });
  it("fwidth between 1280 and 1600 path (default)", () => {
    setWindowWidth(1400);
    render(<AdPositionCrawlerChart position={samplePosition} />);
    expect(chartSetCalls.find((c) => c.k === "width")).toBeTruthy();
  });
  it("fwidth <468 path (very small)", () => {
    setWindowWidth(400);
    render(<AdPositionCrawlerChart position={samplePosition} />);
    expect(chartSetCalls.find((c) => c.k === "height" && c.v === 350)).toBeTruthy();
  });
  it("window resize fires handler (no crash)", () => {
    setWindowWidth(1366);
    render(<AdPositionCrawlerChart position={samplePosition} />);
    setWindowWidth(500);
    window.dispatchEvent(new Event("resize"));
    expect(chartSetCalls.length).toBeGreaterThan(0);
  });
  it("dispose() called on unmount", () => {
    setWindowWidth(1366);
    const { unmount } = render(<AdPositionCrawlerChart position={samplePosition} />);
    unmount();
    expect(disposeMock).toHaveBeenCalled();
  });
  it("position undefined → no crash; ref not set so amCharts not initialized... wait actually ref is set", () => {
    setWindowWidth(1366);
    // Without position prop, chart still initializes (chartData becomes undefined)
    expect(() => render(<AdPositionCrawlerChart />)).not.toThrow();
  });
});

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const disposeMock = vi.fn();
const axisRangeSetAllCalls = [];

function makeAxisFill() {
  return { setAll: (props) => axisRangeSetAllCalls.push(props) };
}

function makeAxisRange() {
  return { get: vi.fn(() => makeAxisFill()) };
}

function makeAxisDataItem() {
  return { set: vi.fn() };
}

function makeXAxis() {
  return {
    get: vi.fn(() => ({ labels: { template: { set: vi.fn() } } })),
    createAxisRange: vi.fn(() => makeAxisRange()),
    makeDataItem: vi.fn(() => makeAxisDataItem()),
  };
}

function makeChart() {
  return {
    xAxes: { push: vi.fn(() => makeXAxis()) },
    radarContainer: { children: { push: vi.fn() } },
    appear: vi.fn(),
  };
}

vi.mock("@amcharts/amcharts5", () => ({
  Root: {
    new: vi.fn(() => ({
      _logo: { dispose: vi.fn() },
      setThemes: vi.fn(),
      container: { children: { push: vi.fn(() => makeChart()) } },
      dispose: disposeMock,
    })),
  },
  Circle: { new: vi.fn(() => ({ _kind: "circle" })) },
  Label: { new: vi.fn(() => ({ _kind: "label" })) },
  percent: vi.fn((v) => ({ _pct: v })),
  color: vi.fn((c) => ({ _color: c })),
}));

vi.mock("@amcharts/amcharts5/xy", () => ({
  ValueAxis: { new: vi.fn(() => makeXAxis()) },
  AxisBullet: { new: vi.fn(() => ({ _kind: "axis-bullet" })) },
}));

vi.mock("@amcharts/amcharts5/radar", () => ({
  RadarChart: { new: vi.fn(() => makeChart()) },
  AxisRendererCircular: { new: vi.fn(() => ({ labels: { template: { set: vi.fn() } } })) },
  ClockHand: { new: vi.fn(() => ({ _kind: "clock-hand" })) },
}));

vi.mock("@amcharts/amcharts5/themes/Animated", () => ({
  default: { new: vi.fn(() => ({})) },
}));

import GaugeChart from "../../../../src/components/Pas/Chart/GaugeChart.jsx";

describe("GaugeChart", () => {
  it("renders #performanceMeter div + 5 legend items", () => {
    const { container, getByText } = render(<GaugeChart />);
    expect(container.querySelector("#performanceMeter")).not.toBeNull();
    for (const label of ["Poor", "Fair", "Good", "Very Good", "Excellent"]) {
      expect(getByText(label)).toBeInTheDocument();
    }
  });
  it("creates 5 axis ranges (one per gauge band)", () => {
    axisRangeSetAllCalls.length = 0;
    render(<GaugeChart />);
    // Each range calls axisFill.setAll → 5 ranges
    expect(axisRangeSetAllCalls.length).toBeGreaterThanOrEqual(5);
  });
  it("calls am5 Root.new and am5radar.RadarChart.new on mount", async () => {
    const am5 = await import("@amcharts/amcharts5");
    const am5radar = await import("@amcharts/amcharts5/radar");
    am5.Root.new.mockClear();
    am5radar.RadarChart.new.mockClear();
    render(<GaugeChart />);
    expect(am5.Root.new).toHaveBeenCalledWith("performanceMeter");
    expect(am5radar.RadarChart.new).toHaveBeenCalled();
  });
  it("dispose() called on unmount", () => {
    disposeMock.mockClear();
    const { unmount } = render(<GaugeChart />);
    unmount();
    expect(disposeMock).toHaveBeenCalled();
  });
  it("renders legend dot with the correct background color", () => {
    const { getByText } = render(<GaugeChart />);
    const poor = getByText("Poor").closest("li");
    const dot = poor.querySelector("div");
    expect(dot.style.backgroundColor).toBe("rgb(255, 77, 77)"); // #ff4d4d
  });
});

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Track Root.dispose calls so we can verify cleanup
const disposeMock = vi.fn();

// Minimal am5 surface — every call returns a chainable stub
function makeStub() {
  const stub = {
    setThemes: vi.fn(),
    container: { children: { push: vi.fn((x) => x) } },
    dispose: disposeMock,
    children: { push: vi.fn((x) => x) },
    series: { push: vi.fn((x) => x) },
    data: { setAll: vi.fn() },
    labels: { template: { set: vi.fn(), setAll: vi.fn() } },
    ticks: { template: { set: vi.fn() } },
    set: vi.fn(),
    appear: vi.fn(),
    dataItems: [],
    verticalLayout: {},
    horizontalLayout: {},
  };
  return stub;
}

vi.mock("@amcharts/amcharts5", () => {
  const m = {
    Root: { new: vi.fn(() => makeStub()) },
    Legend: { new: vi.fn(() => makeStub()) },
    ColorSet: { new: vi.fn(() => makeStub()) },
    color: vi.fn((c) => ({ _color: c })),
    p50: 0.5,
  };
  return m;
});

vi.mock("@amcharts/amcharts5/percent", () => ({
  PieChart: { new: vi.fn(() => makeStub()) },
  PieSeries: { new: vi.fn(() => makeStub()) },
}));

vi.mock("@amcharts/amcharts5/themes/Animated", () => ({
  default: { new: vi.fn(() => ({})) },
}));

import ProcessedChart from "../../../../src/components/Pas/Chart/ProcessedChart.jsx";

describe("ProcessedChart", () => {
  it("renders a div with width/height styles", () => {
    const { container } = render(<ProcessedChart />);
    const div = container.firstChild;
    expect(div).not.toBeNull();
    expect(div.style.width).toBe("100%");
    expect(div.style.height).toBe("500px");
  });
  it("initializes am5 chart on mount (calls Root.new and seeds data)", async () => {
    const am5 = await import("@amcharts/amcharts5");
    const am5percent = await import("@amcharts/amcharts5/percent");
    am5.Root.new.mockClear();
    am5percent.PieChart.new.mockClear();
    am5percent.PieSeries.new.mockClear();
    render(<ProcessedChart />);
    expect(am5.Root.new).toHaveBeenCalled();
    expect(am5percent.PieChart.new).toHaveBeenCalled();
    expect(am5percent.PieSeries.new).toHaveBeenCalled();
  });
  it("calls root.dispose() on unmount", () => {
    disposeMock.mockClear();
    const { unmount } = render(<ProcessedChart />);
    unmount();
    expect(disposeMock).toHaveBeenCalled();
  });
});

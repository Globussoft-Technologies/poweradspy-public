import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const tooltipPropsCapture = [];
vi.mock("recharts", () => ({
  AreaChart: ({ children, width, height }) => (
    <div data-testid="area-chart" data-width={width} data-height={height}>
      {children}
    </div>
  ),
  Area: ({ stroke, fill }) => <div data-testid="area" data-stroke={stroke} data-fill={fill} />,
  XAxis: () => <div data-testid="xaxis" />,
  Tooltip: (props) => {
    tooltipPropsCapture.push(props);
    return <div data-testid="tooltip" />;
  },
}));

import CpuLineChart from "../../../../src/components/Pas/Chart/CpuLineChart.jsx";

describe("CpuLineChart", () => {
  it("renders an AreaChart with default width/height", () => {
    const { getByTestId } = render(<CpuLineChart data={[{ value: 1, date: 1000 }]} />);
    expect(getByTestId("area-chart").getAttribute("data-width")).toBe("150");
    expect(getByTestId("area-chart").getAttribute("data-height")).toBe("60");
  });
  it("custom width/height honored", () => {
    const { getByTestId } = render(
      <CpuLineChart data={[{ value: 1 }]} width={300} height={120} />,
    );
    expect(getByTestId("area-chart").getAttribute("data-width")).toBe("300");
    expect(getByTestId("area-chart").getAttribute("data-height")).toBe("120");
  });
  it("uses blue stroke (#1E90FF) regardless of data", () => {
    const { getByTestId } = render(<CpuLineChart data={[{ value: 5 }]} />);
    expect(getByTestId("area").getAttribute("data-stroke")).toBe("#1E90FF");
  });
  it("data without .date uses 'N/A' fallback (not crashing)", () => {
    const { getByTestId } = render(<CpuLineChart data={[{ value: 1 }]} />);
    expect(getByTestId("area-chart")).toBeInTheDocument();
  });
  it("data undefined → component still renders without crash", () => {
    const { getByTestId } = render(<CpuLineChart />);
    expect(getByTestId("area-chart")).toBeInTheDocument();
  });
  it("Tooltip.formatter calls formatUnixTimestamp + value.toFixed(2)", () => {
    tooltipPropsCapture.length = 0;
    render(<CpuLineChart data={[{ value: 1, date: 1700000000 }]} />);
    const { formatter, labelFormatter } = tooltipPropsCapture.at(-1);
    const result = formatter(7.891, "v", { payload: { fullDate: 1700000000 } });
    expect(result[0]).toBe("Value: 7.89");
    expect(result[1]).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    expect(labelFormatter()).toBe("");
  });
});

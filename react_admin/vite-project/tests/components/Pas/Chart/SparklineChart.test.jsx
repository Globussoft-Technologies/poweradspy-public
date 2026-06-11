import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock recharts — capture Tooltip props so we can invoke formatter/labelFormatter
const tooltipPropsCapture = [];
vi.mock("recharts", () => ({
  AreaChart: ({ children, width, height, data }) => (
    <div data-testid="area-chart" data-width={width} data-height={height} data-count={data?.length || 0}>
      {children}
    </div>
  ),
  Area: ({ stroke, fill }) => <div data-testid="area" data-stroke={stroke} data-fill={fill} />,
  Tooltip: (props) => {
    tooltipPropsCapture.push(props);
    return <div data-testid="tooltip" />;
  },
  defs: ({ children }) => <div>{children}</div>,
}));

import SparklineChart from "../../../../src/components/Pas/Chart/SparklineChart.jsx";

describe("SparklineChart", () => {
  it("uses green stroke when last value >= first (uptrend)", () => {
    const { getByTestId } = render(
      <SparklineChart data={[{ value: 10, date: 1000 }, { value: 30, date: 2000 }]} />,
    );
    expect(getByTestId("area").getAttribute("data-stroke")).toBe("#00C49F");
  });
  it("uses red stroke when last value < first (downtrend)", () => {
    const { getByTestId } = render(
      <SparklineChart data={[{ value: 30, date: 1000 }, { value: 10, date: 2000 }]} />,
    );
    expect(getByTestId("area").getAttribute("data-stroke")).toBe("#FF4D4F");
  });
  it("uses red when first.value undefined (isUptrend false)", () => {
    const { getByTestId } = render(
      <SparklineChart data={[{ date: 1000 }, { value: 10, date: 2000 }]} />,
    );
    expect(getByTestId("area").getAttribute("data-stroke")).toBe("#FF4D4F");
  });
  it("uses red when data is null/undefined", () => {
    const { getByTestId } = render(<SparklineChart data={null} />);
    expect(getByTestId("area").getAttribute("data-stroke")).toBe("#FF4D4F");
  });
  it("uses red when data is empty array", () => {
    const { getByTestId } = render(<SparklineChart data={[]} />);
    expect(getByTestId("area").getAttribute("data-stroke")).toBe("#FF4D4F");
  });
  it("Tooltip.formatter returns [value-string, date-string]", () => {
    tooltipPropsCapture.length = 0;
    render(<SparklineChart data={[{ value: 10, date: 1700000000 }]} />);
    const { formatter, labelFormatter } = tooltipPropsCapture.at(-1);
    const result = formatter(12.345, "v", { payload: { fullDate: 1700000000 } });
    expect(result[0]).toBe("Value: 12.35");
    expect(result[1]).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    expect(labelFormatter()).toBe("");
  });
  it("falls back to item.timestamp when date missing", () => {
    tooltipPropsCapture.length = 0;
    render(<SparklineChart data={[{ value: 10, timestamp: 1700000000 }]} />);
    const { formatter } = tooltipPropsCapture.at(-1);
    const result = formatter(10, "v", { payload: { fullDate: 1700000000 } });
    expect(result[1]).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
  });
  it("AreaChart width/height fixed at 80/30", () => {
    const { getByTestId } = render(
      <SparklineChart data={[{ value: 1, date: 1 }, { value: 2, date: 2 }]} />,
    );
    expect(getByTestId("area-chart").getAttribute("data-width")).toBe("80");
    expect(getByTestId("area-chart").getAttribute("data-height")).toBe("30");
  });
});

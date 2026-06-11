import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const apexPropsCapture = [];
vi.mock("react-apexcharts", () => ({
  default: (props) => {
    apexPropsCapture.push(props);
    return <div data-testid="apex-chart" />;
  },
}));

import ApexChart from "../../../../src/components/Pas/Chart/GraphCrawlerChart.jsx";

describe("GraphCrawlerChart", () => {
  it("renders chart container + ReactApexChart", () => {
    const { getByTestId } = render(<ApexChart graph={[]} />);
    expect(getByTestId("apex-chart")).toBeInTheDocument();
  });
  it("transformGraphData returns 5 series (4 platforms + Total)", () => {
    apexPropsCapture.length = 0;
    render(<ApexChart graph={[]} />);
    const series = apexPropsCapture.at(-1).series;
    expect(series.length).toBe(5);
    expect(series.map((s) => s.name)).toEqual([
      "User Plugin", "Scroll Plugin", "Python Crawler", "Meta", "Total",
    ]);
  });
  it("series data padded to length 6 with zeros", () => {
    apexPropsCapture.length = 0;
    render(<ApexChart graph={[{ platform: "3", data: [1, 2] }]} />);
    const series = apexPropsCapture.at(-1).series;
    const userPlugin = series.find((s) => s.name === "User Plugin");
    expect(userPlugin.data).toEqual([1, 2, 0, 0, 0, 0]);
  });
  it("aggregates Total = sum across platforms", () => {
    apexPropsCapture.length = 0;
    render(<ApexChart graph={[
      { platform: "3", data: [1, 1, 1, 1, 1, 1] },
      { platform: "10", data: [2, 2, 2, 2, 2, 2] },
    ]} />);
    const series = apexPropsCapture.at(-1).series;
    const total = series.find((s) => s.name === "Total");
    expect(total.data).toEqual([3, 3, 3, 3, 3, 3]);
  });
  it("filters out 'Total' entries from input graph data", () => {
    apexPropsCapture.length = 0;
    render(<ApexChart graph={[
      { platform: "Total", data: [99, 99, 99, 99, 99, 99] },
      { platform: "3", data: [1, 1, 1, 1, 1, 1] },
    ]} />);
    const total = apexPropsCapture.at(-1).series.find((s) => s.name === "Total");
    // Should not include the input 'Total' entry's 99s
    expect(total.data).toEqual([1, 1, 1, 1, 1, 1]);
  });
  it("truncates data array longer than 6", () => {
    apexPropsCapture.length = 0;
    render(<ApexChart graph={[{ platform: "3", data: [1, 2, 3, 4, 5, 6, 7, 8] }]} />);
    const userPlugin = apexPropsCapture.at(-1).series.find((s) => s.name === "User Plugin");
    expect(userPlugin.data).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("xaxis.categories has 6 short month names", () => {
    apexPropsCapture.length = 0;
    render(<ApexChart graph={[]} />);
    const cats = apexPropsCapture.at(-1).options.xaxis.categories;
    expect(cats.length).toBe(6);
    cats.forEach((m) => expect(m).toMatch(/^[A-Z][a-z]{2}$/));
  });
  it("yaxis.labels.formatter stringifies value", () => {
    apexPropsCapture.length = 0;
    render(<ApexChart graph={[]} />);
    const fn = apexPropsCapture.at(-1).options.yaxis.labels.formatter;
    expect(fn(42)).toBe("42");
  });
  it("tooltip.y.formatter handles plural/singular Ads", () => {
    apexPropsCapture.length = 0;
    render(<ApexChart graph={[]} />);
    const fn = apexPropsCapture.at(-1).options.tooltip.y.formatter;
    expect(fn(2000)).toMatch(/2,000 Ads/);
    expect(fn(1)).toMatch(/1 Ad /);
  });
  it("graph prop change triggers useEffect → re-transforms data", () => {
    apexPropsCapture.length = 0;
    const { rerender } = render(<ApexChart graph={[{ platform: "3", data: [1] }]} />);
    const initial = apexPropsCapture.at(-1).series.find((s) => s.name === "User Plugin").data;
    expect(initial).toEqual([1, 0, 0, 0, 0, 0]);
    rerender(<ApexChart graph={[{ platform: "3", data: [9, 9, 9, 9, 9, 9] }]} />);
    const updated = apexPropsCapture.at(-1).series.find((s) => s.name === "User Plugin").data;
    expect(updated).toEqual([9, 9, 9, 9, 9, 9]);
  });
});

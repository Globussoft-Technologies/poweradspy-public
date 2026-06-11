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

import FunnelAdsChart from "../../../../src/components/Pas/Chart/AdsFunnelDistributedColumnChart.jsx";

describe("FunnelAdsChart", () => {
  it("renders Chart with bar type + height=300", () => {
    apexPropsCapture.length = 0;
    render(<FunnelAdsChart funnelData={{ data: [] }} />);
    const props = apexPropsCapture.at(-1);
    expect(props.type).toBe("bar");
    expect(props.height).toBe(300);
  });
  it("extracts funnel_key into xaxis categories", () => {
    apexPropsCapture.length = 0;
    render(
      <FunnelAdsChart funnelData={{ data: [
        { funnel_key: "ToFu", count: 100 },
        { funnel_key: "MoFu", count: 50 },
        { funnel_key: "BoFu", count: 10 },
      ]}} />,
    );
    expect(apexPropsCapture.at(-1).options.xaxis.categories).toEqual(["ToFu", "MoFu", "BoFu"]);
  });
  it("extracts count into series data", () => {
    apexPropsCapture.length = 0;
    render(
      <FunnelAdsChart funnelData={{ data: [
        { funnel_key: "a", count: 5 },
        { funnel_key: "b", count: 8 },
      ]}} />,
    );
    expect(apexPropsCapture.at(-1).series[0].data).toEqual([5, 8]);
  });
  it("funnelData undefined → no crash, undefined categories/data", () => {
    apexPropsCapture.length = 0;
    render(<FunnelAdsChart />);
    const props = apexPropsCapture.at(-1);
    expect(props.options.xaxis.categories).toBeUndefined();
    expect(props.series[0].data).toBeUndefined();
  });
  it("colors palette has 14 entries", () => {
    apexPropsCapture.length = 0;
    render(<FunnelAdsChart funnelData={{ data: [] }} />);
    expect(apexPropsCapture.at(-1).options.colors.length).toBe(14);
  });
});

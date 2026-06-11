// NOTE: line 15 (`const getRandomColor = () => ...`) is dead code never called.
// See https://github.com/Globussoft-Technologies/poweradspy/issues/251
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const apexPropsCapture = [];
vi.mock("react-apexcharts", () => ({
  default: (props) => {
    apexPropsCapture.push(props);
    return <div data-testid="apex-chart" />;
  },
}));

import AffiliateNetworksStackedChart from "../../../../src/components/Pas/Chart/AffiliateNetworksStackedChart.jsx";

const sample = {
  data: [
    { e_commerce: "Shopify", count: 100 },
    { e_commerce: "WooCommerce", count: 75 },
    { e_commerce: "BigCommerce", count: 50 },
  ],
};

describe("AffiliateNetworksStackedChart", () => {
  it("renders Chart with area type + height=350", () => {
    apexPropsCapture.length = 0;
    render(<AffiliateNetworksStackedChart adsAffiliateData={sample} />);
    const props = apexPropsCapture.at(-1);
    expect(props.type).toBe("area");
    expect(props.height).toBe(350);
  });
  it("renders all item labels with values + Select All", () => {
    const { getByText } = render(<AffiliateNetworksStackedChart adsAffiliateData={sample} />);
    expect(getByText("Shopify")).toBeInTheDocument();
    expect(getByText("WooCommerce")).toBeInTheDocument();
    expect(getByText("BigCommerce")).toBeInTheDocument();
    expect(getByText("Select All")).toBeInTheDocument();
  });
  it("initial series.data is all counts", () => {
    apexPropsCapture.length = 0;
    render(<AffiliateNetworksStackedChart adsAffiliateData={sample} />);
    expect(apexPropsCapture.at(-1).series[0].data).toEqual([100, 75, 50]);
  });
  it("Select All toggles all items off then back on", () => {
    apexPropsCapture.length = 0;
    const { container } = render(<AffiliateNetworksStackedChart adsAffiliateData={sample} />);
    const checkbox = container.querySelector("#select-all");
    // initially checked
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    // after click: deselect all → series.data empty
    const lastEmpty = apexPropsCapture.at(-1);
    expect(lastEmpty.series[0].data).toEqual([]);
    // click again to reselect
    fireEvent.click(checkbox);
    const reselected = apexPropsCapture.at(-1);
    expect(reselected.series[0].data).toEqual([100, 75, 50]);
  });
  it("clicking a label deselects it (removes from series.data)", () => {
    apexPropsCapture.length = 0;
    const { getByText } = render(<AffiliateNetworksStackedChart adsAffiliateData={sample} />);
    fireEvent.click(getByText("WooCommerce"));
    const series = apexPropsCapture.at(-1).series[0].data;
    expect(series).toEqual([100, 50]);
  });
  it("clicking a deselected label re-adds it at original position", () => {
    apexPropsCapture.length = 0;
    const { getByText } = render(<AffiliateNetworksStackedChart adsAffiliateData={sample} />);
    fireEvent.click(getByText("WooCommerce"));
    fireEvent.click(getByText("WooCommerce"));
    const series = apexPropsCapture.at(-1).series[0].data;
    expect(series).toEqual([100, 75, 50]);
  });
  it("yaxis.labels.formatter handles k-suffix and integer", () => {
    apexPropsCapture.length = 0;
    render(<AffiliateNetworksStackedChart adsAffiliateData={sample} />);
    const fn = apexPropsCapture.at(-1).options.yaxis.labels.formatter;
    expect(fn(1500)).toBe("2k");
    expect(fn(999)).toBe("999");
  });
  it("tooltip.y.formatter renders 'N Ads'", () => {
    apexPropsCapture.length = 0;
    render(<AffiliateNetworksStackedChart adsAffiliateData={sample} />);
    const fn = apexPropsCapture.at(-1).options.tooltip.y.formatter;
    expect(fn(2500)).toBe("2,500 Ads");
  });
  it("adsAffiliateData undefined → empty allItems and series", () => {
    apexPropsCapture.length = 0;
    render(<AffiliateNetworksStackedChart />);
    expect(apexPropsCapture.at(-1).series[0].data).toEqual([]);
  });
});

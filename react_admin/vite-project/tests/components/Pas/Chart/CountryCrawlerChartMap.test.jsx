import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Capture handlers so we can invoke them from tests
const adapterHandlers = {};
const eventHandlers = {};
const polygonEachCallbacks = [];
const setCalls = [];

function makeTemplateStub() {
  return {
    setAll: vi.fn(),
    adapters: {
      add: (key, cb) => {
        adapterHandlers[key] = cb;
      },
    },
  };
}

function makePolygon(id) {
  return {
    dataItem: { get: (k) => (k === "id" ? id : "Country-" + id) },
    set: (k, v) => setCalls.push({ id, k, v }),
  };
}

function makePolygonSeries() {
  return {
    mapPolygons: {
      template: makeTemplateStub(),
      each: (cb) => polygonEachCallbacks.push(cb),
    },
    events: {
      on: (key, cb) => {
        eventHandlers[key] = cb;
      },
    },
  };
}

const disposeMock = vi.fn();

vi.mock("@amcharts/amcharts5", () => ({
  Root: {
    new: vi.fn(() => ({
      _logo: { set: vi.fn() },
      container: { children: { push: vi.fn((x) => x) } },
      dispose: disposeMock,
    })),
  },
  color: vi.fn((c) => ({ _color: c })),
}));

vi.mock("@amcharts/amcharts5/map", () => ({
  MapChart: {
    new: vi.fn(() => ({
      series: {
        push: vi.fn(() => makePolygonSeries()),
      },
    })),
  },
  MapPolygonSeries: { new: vi.fn(() => ({})) },
  geoMercator: vi.fn(() => ({})),
}));

vi.mock("@amcharts/amcharts5-geodata/worldLow", () => ({
  default: {
    features: [
      { id: "US", type: "Feature" },
      { id: "AQ", type: "Feature" },
      { id: "GB", type: "Feature" },
    ],
  },
}));

import CountryCrawlerChartMap from "../../../../src/components/Pas/Chart/CountryCrawlerChartMap.jsx";

beforeEach(() => {
  Object.keys(adapterHandlers).forEach((k) => delete adapterHandlers[k]);
  Object.keys(eventHandlers).forEach((k) => delete eventHandlers[k]);
  polygonEachCallbacks.length = 0;
  setCalls.length = 0;
  disposeMock.mockClear();
});

describe("CountryCrawlerChartMap", () => {
  it("renders div with width=100% height=335px", () => {
    const { container } = render(
      <CountryCrawlerChartMap countryData={{ data: [] }} network="facebook" />,
    );
    const div = container.firstChild;
    expect(div.style.width).toBe("100%");
    expect(div.style.height).toBe("335px");
  });
  it("non-tiktok network uses transformed countryColorMap", () => {
    render(
      <CountryCrawlerChartMap
        countryData={{ data: [{ code: "US", color: "#ff0000", count: 5, country: "United States" }] }}
        network="facebook"
      />,
    );
    // Adapter handler 'tooltipText' is registered
    expect(adapterHandlers.tooltipText).toBeTypeOf("function");
    // Calling adapter on US polygon returns "United States : 5 Ads"
    const tooltipText = adapterHandlers.tooltipText(
      "default",
      { dataItem: { get: (k) => (k === "id" ? "US" : "United States") } },
    );
    expect(tooltipText).toBe("United States : 5 Ads");
  });
  it("singular 'Ad' when count===1", () => {
    render(
      <CountryCrawlerChartMap
        countryData={{ data: [{ code: "US", color: "#f00", count: 1, country: "United States" }] }}
        network="facebook"
      />,
    );
    const text = adapterHandlers.tooltipText(
      "default",
      { dataItem: { get: (k) => (k === "id" ? "US" : null) } },
    );
    expect(text).toBe("United States : 1 Ad");
  });
  it("tooltipText returns undefined for unknown id (no entry in highlightedCountries)", () => {
    render(
      <CountryCrawlerChartMap
        countryData={{ data: [{ code: "US", color: "#f00", count: 1, country: "X" }] }}
        network="facebook"
      />,
    );
    const text = adapterHandlers.tooltipText(
      "default",
      { dataItem: { get: (k) => (k === "id" ? "ZZ" : "Unknown") } },
    );
    expect(text).toBeUndefined();
  });
  it("tiktok network filters ALL country and generates colors per country", () => {
    render(
      <CountryCrawlerChartMap
        countryData={{ data: [
          { country: "ALL", count: 100 },
          { country: "US", count: 7 },
          { country: "GB", count: 3 },
        ]}}
        network="tiktok"
      />,
    );
    // tooltipText for 'US'
    const text = adapterHandlers.tooltipText(
      "default",
      { dataItem: { get: (k) => (k === "id" ? "US" : null) } },
    );
    expect(text).toBe("US : 7 Ads");
  });
  it("polygonSeries.datavalidated handler updates polygon fills for known countries", () => {
    render(
      <CountryCrawlerChartMap
        countryData={{ data: [{ code: "US", color: "#ff0000", count: 5, country: "USA" }] }}
        network="facebook"
      />,
    );
    expect(eventHandlers.datavalidated).toBeTypeOf("function");
    // Trigger the event — it calls polygonSeries.mapPolygons.each(cb)
    eventHandlers.datavalidated();
    expect(polygonEachCallbacks.length).toBeGreaterThan(0);
    // Run the captured "each" callback with a polygon that matches
    polygonEachCallbacks[0](makePolygon("US"));
    expect(setCalls.find((c) => c.id === "US" && c.k === "fill")).toBeTruthy();
    // Also run with an unknown polygon — should NOT call set
    setCalls.length = 0;
    polygonEachCallbacks[0](makePolygon("ZZ"));
    expect(setCalls.length).toBe(0);
  });
  it("calls root.dispose() on unmount", () => {
    const { unmount } = render(
      <CountryCrawlerChartMap countryData={{ data: [] }} network="facebook" />,
    );
    unmount();
    expect(disposeMock).toHaveBeenCalled();
  });
  it("countryData undefined → does not throw", () => {
    expect(() => render(<CountryCrawlerChartMap network="facebook" />)).not.toThrow();
  });
});

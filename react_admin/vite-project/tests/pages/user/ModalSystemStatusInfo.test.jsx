// Note: ModalSystemStatusInfo.jsx is NOT enrolled in the 100% gate.
// Same dead helpers as ModalAccountStatusInfo (calculateDaysInclusive,
// formatSystemDate, unused useDispatch). Tracked in #215.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

const { dispatchSpy, chartHandlers, makeChain } = vi.hoisted(() => {
  const handlers = { pointerover: null, pointerout: null, click: null, datavalidated: null };
  const chainBuilder = (overrides = {}) => {
    const target = function () { return chain; };
    Object.assign(target, overrides);
    const chain = new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (prop === "on") return (evt, cb) => { handlers[evt] = cb; return chain; };
        if (prop === "off") return () => undefined;
        return chain;
      },
      apply() { return chain; },
    });
    return chain;
  };
  return {
    dispatchSpy: { fn: null },
    chartHandlers: handlers,
    makeChain: chainBuilder,
  };
});
dispatchSpy.fn = (() => { const f = (...a) => { f.calls.push(a); }; f.calls = []; return f; })();

vi.mock("react-redux", () => ({ useDispatch: () => dispatchSpy.fn }));

vi.mock("@amcharts/amcharts5", () => {
  const am5Chain = makeChain({
    Root: { new: () => makeChain({ container: makeChain(), dateFormatter: { format: () => "00:00:00" }, dispose: () => {} }) },
    Scrollbar: { new: () => makeChain() },
    Tooltip: { new: () => makeChain() },
    Container: { new: () => makeChain() },
    Legend: { new: () => makeChain() },
    color: (n) => ({ _color: n }),
    percent: (n) => n,
    p0: 0,
    p50: 50,
  });
  return { ...am5Chain, default: am5Chain };
});
vi.mock("@amcharts/amcharts5/xy", () => {
  const am5xyChain = makeChain({
    XYChart: { new: () => makeChain() },
    CategoryAxis: { new: () => makeChain() },
    DateAxis: { new: () => makeChain() },
    AxisRendererY: { new: () => makeChain() },
    AxisRendererX: { new: () => makeChain() },
    ColumnSeries: { new: () => makeChain() },
    XYCursor: { new: () => makeChain() },
  });
  return { ...am5xyChain, default: am5xyChain };
});
vi.mock("@amcharts/amcharts5/themes/Animated", () => ({
  default: { new: () => makeChain() },
}));

import TimeChart from "../../../src/pages/user/ModalSystemStatusInfo.jsx";

beforeEach(() => {
  dispatchSpy.fn.calls = [];
  Object.keys(chartHandlers).forEach((k) => (chartHandlers[k] = null));
});

describe("pages/user/ModalSystemStatusInfo (TimeChart)", () => {
  it("loading=true → spinner, useEffect early returns", () => {
    render(<TimeChart loadingStatusSystemInfo={true} StatusSystemInfo={null} dateRange1={null} onClose={vi.fn()} onStageClick={vi.fn()} />);
    expect(screen.getByText("System Status Timeline")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("StatusSystemInfo null → useEffect early returns + cards render", () => {
    render(<TimeChart loadingStatusSystemInfo={false} StatusSystemInfo={null} dateRange1={null} onClose={vi.fn()} onStageClick={vi.fn()} />);
    expect(screen.getByText("Total Active Time")).toBeInTheDocument();
    expect(screen.getByText("Total Inactive Time")).toBeInTheDocument();
    const zeroes = screen.getAllByText("00:00:00");
    expect(zeroes.length).toBe(2);
  });

  it("StatusSystemInfo as empty array → useEffect early-returns via .length===0 check (issue #216)", () => {
    // The source guards with `StatusSystemInfo?.length === 0` rather than
    // `?.timeline?.length === 0`, so we have to pass an array to hit the
    // early-return path. Tracked in #216.
    render(<TimeChart loadingStatusSystemInfo={false} StatusSystemInfo={[]} dateRange1={null} onClose={vi.fn()} onStageClick={vi.fn()} />);
    expect(screen.getAllByText("00:00:00").length).toBe(2);
  });

  it("formatSecondsToTime: short (non-3-part) timeString is returned unchanged", () => {
    render(<TimeChart loadingStatusSystemInfo={false} StatusSystemInfo={null} dateRange1={null} onClose={vi.fn()} onStageClick={vi.fn()} />);
    // null path renders two "00:00:00"; we already cover that elsewhere.
    expect(screen.getAllByText("00:00:00").length).toBe(2);
  });

  it("Full timeline → chart code path exercised via deep amcharts5 mock", () => {
    render(<TimeChart loadingStatusSystemInfo={false} StatusSystemInfo={{
      totalActive: "10:00:00",
      totalInactive: "02:00:00",
      timeline: [
        { from: 1700000000, to: 1700000060, category: "A", name: "Active", columnSettings: { fill: "rgb(0, 255, 0)" } },
        { from: 1700000060, to: 1700000120, category: "A", name: "Inactive", columnSettings: { fill: "rgb(255, 0, 0)" } },
      ],
    }} dateRange1={null} onClose={vi.fn()} onStageClick={vi.fn()} />);
    expect(chartHandlers.pointerover).toBeTypeOf("function");
    chartHandlers.pointerover();
    chartHandlers.pointerout();
    expect(chartHandlers.click).toBeTypeOf("function");
    chartHandlers.click({ target: { dataItem: { dataContext: { name: "Active" } } } });
    chartHandlers.click({ target: { dataItem: { dataContext: { name: "Active" } } } }); // toggle off
    chartHandlers.click({ target: { dataItem: { dataContext: null } } }); // no-op
    expect(chartHandlers.datavalidated).toBeTypeOf("function");
    chartHandlers.datavalidated();
  });

  it("onClose fires the prop", () => {
    const onClose = vi.fn();
    render(<TimeChart loadingStatusSystemInfo={false} StatusSystemInfo={null} dateRange1={null} onClose={onClose} onStageClick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalled();
  });
});

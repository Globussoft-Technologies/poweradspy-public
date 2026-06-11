// Note: ModalAccountStatusInfo.jsx is NOT enrolled in the 100% gate.
// `calculateDaysInclusive` and `formatSystemDate` are defined inside the
// component but have no callers — dead functions. Tracked in #215.
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
// Wire dispatchSpy with the imported vi.fn now that vi exists
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

import ModalAccountStatusInfo from "../../../src/pages/user/ModalAccountStatusInfo.jsx";

beforeEach(() => {
  dispatchSpy.fn.calls = [];
  Object.keys(chartHandlers).forEach((k) => (chartHandlers[k] = null));
});

describe("pages/user/ModalAccountStatusInfo", () => {
  it("loadingStatusAccountInfo=true → shows spinner, useEffect early-returns", () => {
    render(<ModalAccountStatusInfo loadingStatusAccountInfo={true} AccountInfo={null} dateRange1={null} onClose={vi.fn()} onStageClick={vi.fn()} />);
    expect(screen.getByText("Account Status Timeline")).toBeInTheDocument();
    // spinner has no role/text — assert by class
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("AccountInfo null + loading false → useEffect early-returns; renders status cards", () => {
    render(<ModalAccountStatusInfo loadingStatusAccountInfo={false} AccountInfo={null} dateRange1={null} onClose={vi.fn()} onStageClick={vi.fn()} />);
    expect(screen.getByText("Total Active Time")).toBeInTheDocument();
    expect(screen.getByText("Total Inactive Time")).toBeInTheDocument();
    // formatSecondsToTime null → "00:00:00"
    const zeroTimes = screen.getAllByText("00:00:00");
    expect(zeroTimes.length).toBe(2);
  });

  it("AccountInfo with empty timeline → useEffect early-returns (length===0)", () => {
    render(<ModalAccountStatusInfo loadingStatusAccountInfo={false} AccountInfo={{ timeline: [], totalActive: "01:02:03", totalInactive: "ab:cd" }} dateRange1={null} onClose={vi.fn()} onStageClick={vi.fn()} />);
    // formatSecondsToTime: "01:02:03" → "01:02:03"; "ab:cd" → "ab:cd" (parts!==3)
    expect(screen.getByText("01:02:03")).toBeInTheDocument();
    expect(screen.getByText("ab:cd")).toBeInTheDocument();
  });

  it("AccountInfo with full timeline → chart code path executes (deep-chain mock)", () => {
    render(
      <ModalAccountStatusInfo
        loadingStatusAccountInfo={false}
        AccountInfo={{
          totalActive: "10:00:00",
          totalInactive: "02:00:00",
          timeline: [
            { from: 1700000000, to: 1700000060, category: "A", name: "Active", columnSettings: { fill: "rgb(0, 255, 0)" } },
            { from: 1700000060, to: 1700000120, category: "A", name: "Inactive", columnSettings: { fill: "rgb(255, 0, 0)" } },
          ],
        }}
        dateRange1={null}
        onClose={vi.fn()}
        onStageClick={vi.fn()}
      />
    );
    // pointerover/pointerout handlers were registered via our chain mock
    expect(chartHandlers.pointerover).toBeTypeOf("function");
    expect(chartHandlers.pointerout).toBeTypeOf("function");
    // Fire them to cover their bodies
    chartHandlers.pointerover();
    chartHandlers.pointerout();
    // Legend click handler covers both branches: same-name toggles off, different sets new
    expect(chartHandlers.click).toBeTypeOf("function");
    chartHandlers.click({ target: { dataItem: { dataContext: { name: "Active" } } } });
    chartHandlers.click({ target: { dataItem: { dataContext: { name: "Inactive" } } } });
    chartHandlers.click({ target: { dataItem: { dataContext: { name: "Inactive" } } } }); // same → reset
    // No dataContext → no-op (the `if (item)` false branch)
    chartHandlers.click({ target: { dataItem: { dataContext: null } } });
    // datavalidated handler updates legend/series
    expect(chartHandlers.datavalidated).toBeTypeOf("function");
    chartHandlers.datavalidated();
  });

  it("onClose button invokes the prop", () => {
    const onClose = vi.fn();
    render(<ModalAccountStatusInfo loadingStatusAccountInfo={false} AccountInfo={null} dateRange1={null} onClose={onClose} onStageClick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalled();
  });
});

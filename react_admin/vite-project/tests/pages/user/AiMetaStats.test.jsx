import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { useDispatchSpy, useSelectorSpy, fetchSpy, rangeProps, unwrapImpl } = vi.hoisted(() => ({
  useDispatchSpy: vi.fn(),
  useSelectorSpy: vi.fn(),
  fetchSpy: vi.fn(),
  rangeProps: { current: null },
  unwrapImpl: { current: () => Promise.resolve() },
}));

vi.mock("react-redux", () => ({
  useDispatch: () => useDispatchSpy,
  useSelector: (sel) => useSelectorSpy(sel),
}));

vi.mock("../../../src/store/actions/powerAdsPyActionsApi", () => ({
  fetchAiMetaStats: (payload) => {
    fetchSpy(payload);
    return { type: "FETCH_AI_META_STATS", payload };
  },
}));

vi.mock("../../../src/pages/user/RangeDatePicker", () => ({
  default: (props) => {
    rangeProps.current = props;
    return <div data-testid="range-picker" />;
  },
}));

// The table has its own suite; stub it so this one stays on the page's behaviour.
vi.mock("../../../src/pages/user/AiMetaStatsTable", () => ({
  default: ({ networks, loading }) => (
    <div data-testid="stats-table" data-loading={String(loading)} data-count={networks.length} />
  ),
  formatTimestamp: (ts) => `TS(${ts})`,
}));

vi.mock("react-helmet", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("react-icons/fa", () => ({ FaRegCalendarAlt: () => <span data-testid="cal-icon" /> }));
vi.mock("react-icons/go", () => ({
  GoTriangleDown: () => <span data-testid="tri-down" />,
  GoTriangleUp: () => <span data-testid="tri-up" />,
}));
vi.mock("react-icons/fi", () => ({
  FiRefreshCw: (props) => <span data-testid="refresh-icon" className={props.className} />,
  FiCpu: () => <span data-testid="cpu-icon" />,
}));

import AiMetaStats from "../../../src/pages/user/AiMetaStats.jsx";

const STATS = {
  range: { from: "2026-07-31", to: "2026-07-31" },
  days: 1,
  generated_at: "2026-07-31T06:30:00.000Z",
  summary: { updated: 1234, networks_ok: 1, networks_failed: 1 },
  networks: [
    { network: "facebook", label: "Facebook", error: null, totals: {}, daily: [] },
    { network: "instagram", label: "Instagram", error: "db-down", totals: {}, daily: [] },
  ],
};

const renderPage = (state = {}) => {
  useSelectorSpy.mockImplementation((sel) =>
    sel({
      poweradspy: {
        aiMetaStats: null,
        loadingAiMetaStats: false,
        aiMetaStatsError: null,
        ...state,
      },
    })
  );
  return render(<AiMetaStats />);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 31, 12, 0, 0)); // 31 Jul 2026, local time
  useDispatchSpy.mockReset();
  useSelectorSpy.mockReset();
  fetchSpy.mockReset();
  rangeProps.current = null;
  unwrapImpl.current = () => Promise.resolve();
  useDispatchSpy.mockImplementation(() => ({ unwrap: () => unwrapImpl.current() }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pages/user/AiMetaStats", () => {
  it("defaults to today and fetches it on mount", () => {
    renderPage();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith({ range: { from: "2026-07-31", to: "2026-07-31" } });
    // Single day → the label collapses to one date rather than "a ~ b".
    expect(screen.getByText("2026-07-31")).toBeInTheDocument();
  });

  it("swallows a rejected fetch so it never surfaces as an unhandled rejection", async () => {
    unwrapImpl.current = () => Promise.reject(new Error("nope"));
    renderPage();
    await act(async () => {});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Refresh re-dispatches the same range", () => {
    renderPage();
    fireEvent.click(screen.getByText("Refresh"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("spins the refresh icon only while loading", () => {
    const { unmount } = renderPage();
    expect(screen.getByTestId("refresh-icon").className).toBe("");
    unmount();
    renderPage({ loadingAiMetaStats: true });
    expect(screen.getByTestId("refresh-icon").className).toBe("animate-spin");
  });

  it("renders only the KPI tiles the data supports", () => {
    renderPage({ aiMetaStats: STATS });
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    // Nothing claiming failures or a backlog — the table has no such column.
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("zeroes the KPI tiles before any payload arrives", () => {
    renderPage();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("passes rows down and only shows the skeleton on the first load", () => {
    const { unmount } = renderPage({ loadingAiMetaStats: true });
    expect(screen.getByTestId("stats-table").dataset.loading).toBe("true");
    unmount();
    renderPage({ loadingAiMetaStats: true, aiMetaStats: STATS });
    const table = screen.getByTestId("stats-table");
    expect(table.dataset.loading).toBe("false");
    expect(table.dataset.count).toBe("2");
  });

  it("shows the request error banner", () => {
    renderPage({ aiMetaStatsError: "Network Error" });
    expect(screen.getByText(/Could not load statistics: Network Error/)).toBeInTheDocument();
  });

  it("warns about an unavailable platform (singular and plural)", () => {
    const { unmount } = renderPage({ aiMetaStats: STATS });
    expect(screen.getByText(/1 platform is unavailable: Instagram/)).toBeInTheDocument();
    unmount();

    renderPage({
      aiMetaStats: {
        ...STATS,
        networks: [
          { network: "facebook", label: "Facebook", error: "x", totals: {}, daily: [] },
          { network: "instagram", label: "Instagram", error: "y", totals: {}, daily: [] },
        ],
      },
    });
    expect(screen.getByText(/2 platforms are unavailable: Facebook, Instagram/)).toBeInTheDocument();
  });

  it("hides the warning when every platform reported", () => {
    renderPage({
      aiMetaStats: {
        ...STATS,
        networks: [{ network: "facebook", label: "Facebook", error: null, totals: {}, daily: [] }],
      },
    });
    expect(screen.queryByText(/unavailable/)).not.toBeInTheDocument();
  });

  it("footnote states the no-failure-signal caveat, and the snapshot time once data lands", () => {
    const { unmount } = renderPage();
    expect(screen.getByText(/no status or error column/)).toBeInTheDocument();
    expect(screen.queryByText(/snapshot/)).not.toBeInTheDocument();
    unmount();

    renderPage({ aiMetaStats: STATS });
    expect(screen.getByText(/TS\(2026-07-31 06:30:00\)/)).toBeInTheDocument();
    expect(screen.getByText(/updated /)).toBeInTheDocument();
  });

  it("bounds the picker to [2020-01-01, today]", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("date-toggle"));
    const { minDate, maxDate } = rangeProps.current;
    expect(minDate).toEqual(new Date(2020, 0, 1));
    expect(maxDate).toEqual(new Date(2026, 6, 31, 12, 0, 0));
  });

  it("Apply commits the drafted range and refetches; Cancel discards it", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("date-toggle"));
    act(() => {
      rangeProps.current.onDateChange({
        selection: { startDate: new Date(2026, 6, 1), endDate: new Date(2026, 6, 15) },
      });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // draft alone must not refetch

    act(() => rangeProps.current.onApply());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toEqual({ range: { from: "2026-07-01", to: "2026-07-15" } });
    expect(screen.getByText("2026-07-01 ~ 2026-07-15")).toBeInTheDocument();
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("date-toggle"));
    act(() => {
      rangeProps.current.onDateChange({
        selection: { startDate: new Date(2026, 5, 1), endDate: new Date(2026, 5, 2) },
      });
    });
    act(() => rangeProps.current.onCancel());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText("2026-07-01 ~ 2026-07-15")).toBeInTheDocument();
  });

  it("toggling the calendar twice closes it; outside-click closes, inside-click does not", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("date-toggle"));
    expect(screen.getByTestId("range-picker")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("date-toggle"));
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("date-toggle"));
    fireEvent.mouseDown(screen.getByTestId("range-picker"));
    expect(screen.getByTestId("range-picker")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();
    // listener torn down with the picker — a later stray mousedown is harmless
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();
  });
});

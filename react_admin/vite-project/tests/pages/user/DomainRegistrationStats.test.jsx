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
  fetchDomainRegistrationStats: (payload) => {
    fetchSpy(payload);
    return { type: "FETCH_DOMAIN_REG_STATS", payload };
  },
}));

vi.mock("../../../src/pages/user/RangeDatePicker", () => ({
  default: (props) => {
    rangeProps.current = props;
    return <div data-testid="range-picker" />;
  },
}));

// The table has its own suite; stub it so this one stays on the page's behaviour.
vi.mock("../../../src/pages/user/DomainRegistrationStatsTable", () => ({
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
  FiGlobe: () => <span data-testid="globe-icon" />,
}));

import DomainRegistrationStats from "../../../src/pages/user/DomainRegistrationStats.jsx";

const STATS = {
  range: { from: "2026-07-23", to: "2026-07-29" },
  days: 7,
  generated_at: "2026-07-29T06:30:00.000Z",
  summary: { processed: 1234, updated: 1000, failed: 234, pending: 5678, networks_ok: 9, networks_failed: 1 },
  networks: [
    { network: "google", label: "Google", error: null, totals: {}, daily: [] },
    { network: "youtube", label: "YouTube", error: "db-down", totals: {}, daily: [] },
  ],
};

const renderPage = (state = {}) => {
  useSelectorSpy.mockImplementation((sel) =>
    sel({
      poweradspy: {
        domainRegistrationStats: null,
        loadingDomainRegistrationStats: false,
        domainRegistrationStatsError: null,
        ...state,
      },
    })
  );
  return render(<DomainRegistrationStats />);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0)); // 29 Jul 2026, local time
  useDispatchSpy.mockReset();
  useSelectorSpy.mockReset();
  fetchSpy.mockReset();
  rangeProps.current = null;
  unwrapImpl.current = () => Promise.resolve();
  localStorage.clear();
  useDispatchSpy.mockImplementation(() => ({ unwrap: () => unwrapImpl.current() }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pages/user/DomainRegistrationStats", () => {
  it("fetches the trailing 7 days on mount", () => {
    renderPage();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith({ range: { from: "2026-07-23", to: "2026-07-29" } });
    expect(useDispatchSpy).toHaveBeenCalled();
  });

  it("restores the previously applied date range after a browser refresh", () => {
    localStorage.setItem(
      "domainRegistrationStatsDateRange",
      JSON.stringify({ from: "2026-07-24", to: "2026-07-28" })
    );
    renderPage();

    expect(screen.getByText("2026-07-24 ~ 2026-07-28")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith({
      range: { from: "2026-07-24", to: "2026-07-28" },
    });
  });

  it("falls back to the trailing 7 days when the saved range is invalid", () => {
    localStorage.setItem("domainRegistrationStatsDateRange", "not-json");
    renderPage();
    expect(fetchSpy).toHaveBeenCalledWith({
      range: { from: "2026-07-23", to: "2026-07-29" },
    });
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
    expect(fetchSpy.mock.calls[1][0]).toEqual({ range: { from: "2026-07-23", to: "2026-07-29" } });
  });

  it("spins the refresh icon only while loading", () => {
    const { unmount } = renderPage();
    expect(screen.getByTestId("refresh-icon").className).toBe("");
    unmount();
    renderPage({ loadingDomainRegistrationStats: true });
    expect(screen.getByTestId("refresh-icon").className).toBe("animate-spin");
  });

  it("renders the KPI tiles off the summary", () => {
    renderPage({ domainRegistrationStats: STATS });
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("234")).toBeInTheDocument();
    expect(screen.getByText("5,678")).toBeInTheDocument();
    expect(screen.getByText("9/10")).toBeInTheDocument();
  });

  it("zeroes the KPI tiles when no payload has arrived yet", () => {
    renderPage();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("passes the platform rows down and only shows the skeleton on the first load", () => {
    const { unmount } = renderPage({ loadingDomainRegistrationStats: true });
    expect(screen.getByTestId("stats-table").dataset.loading).toBe("true");
    unmount();
    // Refetch with data already on screen → table keeps rendering the old rows.
    renderPage({ loadingDomainRegistrationStats: true, domainRegistrationStats: STATS });
    const table = screen.getByTestId("stats-table");
    expect(table.dataset.loading).toBe("false");
    expect(table.dataset.count).toBe("2");
  });

  it("shows the request error banner", () => {
    renderPage({ domainRegistrationStatsError: "Network Error" });
    expect(screen.getByText(/Could not load statistics: Network Error/)).toBeInTheDocument();
  });

  it("warns about partially unavailable platforms (singular)", () => {
    renderPage({ domainRegistrationStats: STATS });
    expect(screen.getByText(/1 platform is unavailable: YouTube/)).toBeInTheDocument();
  });

  it("warns about partially unavailable platforms (plural)", () => {
    renderPage({
      domainRegistrationStats: {
        ...STATS,
        networks: [
          { network: "youtube", label: "YouTube", error: "x", totals: {}, daily: [] },
          { network: "gdn", label: "GDN", error: "y", totals: {}, daily: [] },
        ],
      },
    });
    expect(screen.getByText(/2 platforms are unavailable: YouTube, GDN/)).toBeInTheDocument();
  });

  it("hides the warning when every platform reported", () => {
    renderPage({
      domainRegistrationStats: {
        ...STATS,
        networks: [{ network: "google", label: "Google", error: null, totals: {}, daily: [] }],
      },
    });
    expect(screen.queryByText(/unavailable/)).not.toBeInTheDocument();
  });

  it("shows the snapshot time in the header and footnote once data lands", () => {
    renderPage({ domainRegistrationStats: STATS });
    expect(screen.getByText(/updated /)).toBeInTheDocument();
    expect(screen.getByText(/TS\(2026-07-29 06:30:00\)/)).toBeInTheDocument();
  });

  it("omits the snapshot time before any data lands", () => {
    renderPage();
    expect(screen.queryByText(/snapshot/)).not.toBeInTheDocument();
  });

  it("labels the range as 'from ~ to', collapsing to one date for a single day", () => {
    renderPage();
    expect(screen.getByText("2026-07-23 ~ 2026-07-29")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("date-toggle"));
    act(() => {
      rangeProps.current.onDateChange({
        selection: { startDate: new Date(2026, 6, 15), endDate: new Date(2026, 6, 15) },
      });
    });
    act(() => rangeProps.current.onApply());
    expect(screen.getByText("2026-07-15")).toBeInTheDocument();
  });

  it("bounds the picker to [2020-01-01, today] so it offers neither 1926 nor a future date", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("date-toggle"));
    const { minDate, maxDate } = rangeProps.current;
    expect(minDate).toEqual(new Date(2020, 0, 1));
    expect(maxDate).toEqual(new Date(2026, 6, 29, 12, 0, 0)); // "today" per the fake clock
  });

  it("Apply commits the drafted range and refetches; the picker closes", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("date-toggle"));
    expect(screen.getByTestId("range-picker")).toBeInTheDocument();
    expect(screen.getByTestId("tri-up")).toBeInTheDocument();

    act(() => {
      rangeProps.current.onDateChange({
        selection: { startDate: new Date(2026, 5, 1), endDate: new Date(2026, 5, 30) },
      });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // draft alone must not refetch

    act(() => rangeProps.current.onApply());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toEqual({ range: { from: "2026-06-01", to: "2026-06-30" } });
    expect(JSON.parse(localStorage.getItem("domainRegistrationStatsDateRange"))).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("tri-down")).toBeInTheDocument();
  });

  it("Cancel discards the draft — no refetch, range unchanged", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("date-toggle"));
    act(() => {
      rangeProps.current.onDateChange({
        selection: { startDate: new Date(2026, 5, 1), endDate: new Date(2026, 5, 30) },
      });
    });
    act(() => rangeProps.current.onCancel());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();
    expect(screen.getByText("2026-07-23 ~ 2026-07-29")).toBeInTheDocument();
  });

  it("toggling the calendar twice closes it again", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("date-toggle"));
    expect(screen.getByTestId("range-picker")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("date-toggle"));
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();
  });

  it("clicking outside closes the picker; clicking inside keeps it open", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("date-toggle"));
    fireEvent.mouseDown(screen.getByTestId("range-picker"));
    expect(screen.getByTestId("range-picker")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();

    // Listener is torn down with the picker — a later stray mousedown is harmless.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("range-picker")).not.toBeInTheDocument();
  });
});

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("react-date-range/dist/styles.css", () => ({}));
vi.mock("react-date-range/dist/theme/default.css", () => ({}));
vi.mock("react-loading-skeleton/dist/skeleton.css", () => ({}));

const dateRangePropsCapture = [];
vi.mock("react-date-range", () => ({
  DateRange: (props) => {
    dateRangePropsCapture.push(props);
    return <div data-testid="date-range" />;
  },
}));

vi.mock("react-icons/fi", () => ({
  FiCalendar: () => <i data-testid="cal-ic" />,
}));
vi.mock("react-icons/gr", () => ({
  GrPowerReset: () => <i data-testid="reset-ic" />,
}));

const tooltipContentCapture = [];
vi.mock("recharts", () => ({
  AreaChart: ({ children, data }) => (
    <div data-testid="area-chart" data-count={data?.length || 0}>
      {children}
    </div>
  ),
  Area: () => <div data-testid="area" />,
  XAxis: ({ tickFormatter }) => {
    if (tickFormatter) tickFormatter(42);
    return <div data-testid="xaxis" />;
  },
  YAxis: ({ tickFormatter }) => {
    if (tickFormatter) tooltipContentCapture.push({ yFormatted: tickFormatter(42) });
    return <div data-testid="yaxis" />;
  },
  CartesianGrid: () => <div data-testid="grid" />,
  Tooltip: ({ content }) => {
    // Render the custom tooltip via the JSX element passed in `content` — once
    // active=true (to cover the rendered branch), once active=false (covers the
    // early `return null;` branch).
    return (
      <div data-testid="tooltip-host">
        {React.cloneElement(content, {
          active: true,
          payload: [{ payload: { date: "2025-01-01", cost_usd: 2.123456, input_tokens: 100, output_tokens: 50 } }],
          label: "2025-01-01",
        })}
        {React.cloneElement(content, { active: false })}
        {React.cloneElement(content, { active: true, payload: null })}
        {React.cloneElement(content, { active: true, payload: [] })}
      </div>
    );
  },
  ResponsiveContainer: ({ children }) => <div data-testid="resp">{children}</div>,
}));

const fetchUserUsageCostMock = vi.fn(() => ({ type: "FETCH_USAGE" }));
vi.mock("../../src/store/actions/adsgptActions", () => ({
  fetchUserUsageCost: (...args) => fetchUserUsageCostMock(...args),
}));

vi.mock("react-loading-skeleton", () => ({
  default: () => <div data-testid="skeleton" />,
}));

const dispatchMock = vi.fn();
let selectorState = { adsgpt: { userUsageCost: { data: [] }, loading: false } };
vi.mock("react-redux", () => ({
  useDispatch: () => dispatchMock,
  useSelector: (fn) => fn(selectorState),
}));

import UsageBarGraph from "../../src/components/UsageBarGraph.jsx";

beforeEach(() => {
  dispatchMock.mockReset();
  fetchUserUsageCostMock.mockClear();
  dateRangePropsCapture.length = 0;
  tooltipContentCapture.length = 0;
  selectorState = { adsgpt: { userUsageCost: { data: [] }, loading: false } };
});

describe("UsageBarGraph", () => {
  it("renders trigger button with 'Select date range' default", () => {
    const { getByText, getByTestId } = render(<UsageBarGraph userId="u-1" />);
    expect(getByText("Select date range")).toBeInTheDocument();
    expect(getByTestId("cal-ic")).toBeInTheDocument();
  });
  it("dispatches initial day-wise fetch on mount", () => {
    render(<UsageBarGraph userId="u-1" />);
    expect(dispatchMock).toHaveBeenCalled();
    expect(fetchUserUsageCostMock).toHaveBeenCalledWith({ userId: "u-1", groupBy: "day" });
  });
  it("no userId → no fetch", () => {
    render(<UsageBarGraph />);
    expect(fetchUserUsageCostMock).not.toHaveBeenCalled();
  });
  it("re-render with same userId → does NOT re-dispatch (lastRequestRef guard)", async () => {
    const rrd = await import("react-redux");
    const { rerender } = render(<UsageBarGraph userId="u-1" />);
    fetchUserUsageCostMock.mockClear();
    // Force the effect to re-fire by spoofing a new dispatch reference; the
    // requestKey will still match the cached one and trip the early return.
    const newDispatch = vi.fn();
    rrd.useDispatch = () => newDispatch;
    rerender(<UsageBarGraph userId="u-1" />);
    expect(fetchUserUsageCostMock).not.toHaveBeenCalled();
  });
  it("loading=true → shows Skeleton", () => {
    selectorState.adsgpt.loading = true;
    const { getByTestId, queryByText } = render(<UsageBarGraph userId="u-1" />);
    expect(getByTestId("skeleton")).toBeInTheDocument();
    expect(queryByText("No usage data available")).toBeNull();
  });
  it("loading=false + empty data → 'No usage data available'", () => {
    const { getByText } = render(<UsageBarGraph userId="u-1" />);
    expect(getByText("No usage data available")).toBeInTheDocument();
  });
  it("non-empty data → renders chart + Total Cost", () => {
    selectorState.adsgpt.userUsageCost = { data: [
      { date: "2025-01-01", cost_usd: 1.5, input_tokens: 100, output_tokens: 50 },
      { date: "2025-01-02", cost_usd: 2.5, input_tokens: 200, output_tokens: 75 },
    ]};
    const { getByText, getByTestId } = render(<UsageBarGraph userId="u-1" />);
    expect(getByTestId("area-chart")).toBeInTheDocument();
    expect(getByText("$4.00")).toBeInTheDocument(); // total = 4
    expect(getByText("Total Cost")).toBeInTheDocument();
  });
  it("CustomTooltip renders formatted cost + tokens", () => {
    selectorState.adsgpt.userUsageCost = { data: [
      { date: "2025-01-01", cost_usd: 1.5, input_tokens: 100, output_tokens: 50 },
    ]};
    const { getByText } = render(<UsageBarGraph userId="u-1" />);
    // CustomTooltip renders inside the Tooltip mock with active=true
    expect(getByText(/Cost: \$2\.1235/)).toBeInTheDocument();
    expect(getByText(/Input Tokens: 100/)).toBeInTheDocument();
    expect(getByText(/Output Tokens: 50/)).toBeInTheDocument();
  });
  it("trigger click opens DateRange picker", () => {
    const { getByText, queryByTestId } = render(<UsageBarGraph userId="u-1" />);
    fireEvent.click(getByText("Select date range"));
    expect(queryByTestId("date-range")).not.toBeNull();
  });
  it("Cancel closes picker without dispatch", () => {
    const { getByText, queryByTestId } = render(<UsageBarGraph userId="u-1" />);
    fireEvent.click(getByText("Select date range"));
    fetchUserUsageCostMock.mockClear();
    fireEvent.click(getByText("Cancel"));
    expect(queryByTestId("date-range")).toBeNull();
    expect(fetchUserUsageCostMock).not.toHaveBeenCalled();
  });
  it("Apply dispatches range fetch with formatted dates", () => {
    const { getByText } = render(<UsageBarGraph userId="u-1" />);
    fireEvent.click(getByText("Select date range"));
    const { onChange } = dateRangePropsCapture.at(-1);
    act(() => {
      onChange({ selection: { startDate: new Date(2025, 0, 5), endDate: new Date(2025, 0, 15), key: "selection" } });
    });
    fetchUserUsageCostMock.mockClear();
    fireEvent.click(getByText("Apply"));
    expect(fetchUserUsageCostMock).toHaveBeenCalledWith({
      userId: "u-1",
      groupBy: "range",
      from: "2025-01-05",
      to: "2025-01-15",
    });
  });
  it("Apply with no date range selected → formatForBackend gets null (returns undefined)", () => {
    const { getByText } = render(<UsageBarGraph userId="u-1" />);
    fireEvent.click(getByText("Select date range"));
    fetchUserUsageCostMock.mockClear();
    fireEvent.click(getByText("Apply"));
    expect(fetchUserUsageCostMock).toHaveBeenCalledWith({
      userId: "u-1",
      groupBy: "range",
      from: undefined,
      to: undefined,
    });
  });
  it("Reset clears range + dispatches default day-wise fetch", () => {
    const { getByText, getByTestId } = render(<UsageBarGraph userId="u-1" />);
    fetchUserUsageCostMock.mockClear();
    fireEvent.click(getByTestId("reset-ic").closest("button"));
    expect(fetchUserUsageCostMock).toHaveBeenCalledWith({ userId: "u-1", groupBy: "day" });
    expect(getByText("Select date range")).toBeInTheDocument();
  });
  it("after Apply, trigger label shows formatted dates", () => {
    const { getByText, container } = render(<UsageBarGraph userId="u-1" />);
    fireEvent.click(getByText("Select date range"));
    const { onChange } = dateRangePropsCapture.at(-1);
    act(() => {
      onChange({ selection: { startDate: new Date(2025, 1, 1), endDate: new Date(2025, 1, 10), key: "selection" } });
    });
    fireEvent.click(getByText("Apply"));
    expect(container.textContent).toMatch(/2025-02-01.*2025-02-10/);
  });
  it("clicking outside closes picker + restores temp range", () => {
    const { getByText, queryByTestId } = render(<UsageBarGraph userId="u-1" />);
    fireEvent.click(getByText("Select date range"));
    fireEvent.mouseDown(document.body);
    expect(queryByTestId("date-range")).toBeNull();
  });
  it("clicking inside picker does not close it", () => {
    const { getByText, getByTestId } = render(<UsageBarGraph userId="u-1" />);
    fireEvent.click(getByText("Select date range"));
    fireEvent.mouseDown(getByTestId("date-range"));
    expect(getByTestId("date-range")).toBeInTheDocument();
  });
  it("YAxis tickFormatter prefixes $ to value", () => {
    selectorState.adsgpt.userUsageCost = { data: [
      { date: "2025-01-01", cost_usd: 1, input_tokens: 10, output_tokens: 5 },
    ]};
    render(<UsageBarGraph userId="u-1" />);
    expect(tooltipContentCapture.at(-1).yFormatted).toBe("$42");
  });
  it("chartData skips when userUsageCost.data not an array", () => {
    selectorState.adsgpt.userUsageCost = { data: null };
    const { getByText } = render(<UsageBarGraph userId="u-1" />);
    expect(getByText("No usage data available")).toBeInTheDocument();
  });
  it("chartData defaults null tokens to 0", () => {
    selectorState.adsgpt.userUsageCost = { data: [
      { date: "2025-01-01" }, // no cost_usd, no tokens
    ]};
    const { getByText } = render(<UsageBarGraph userId="u-1" />);
    expect(getByText("$0.00")).toBeInTheDocument();
  });
});

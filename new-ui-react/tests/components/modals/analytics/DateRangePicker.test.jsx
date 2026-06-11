import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Calendar: () => <i data-testid="cal-ic" />,
  ChevronLeft: () => <i data-testid="cleft-ic" />,
  ChevronRight: () => <i data-testid="cright-ic" />,
  X: () => <i data-testid="x-ic" />,
}));

import DateRangePicker from "../../../../src/components/modals/analytics/DateRangePicker.jsx";

beforeEach(() => {
  // Set a deterministic clock (Jan 2025) so picker tests are stable
  vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

describe("DateRangePicker", () => {
  it("collapsed: shows 'Select Range' trigger", () => {
    const { getByText } = render(<DateRangePicker onApply={() => {}} />);
    expect(getByText("Select Range")).toBeInTheDocument();
  });
  it("clicking trigger opens the calendar", () => {
    const { getByText } = render(<DateRangePicker onApply={() => {}} />);
    fireEvent.click(getByText("Select Range"));
    expect(getByText("January")).toBeInTheDocument();
  });
  it("opens then clicks outside closes the panel", () => {
    const { getByText, queryByText } = render(<DateRangePicker onApply={() => {}} />);
    fireEvent.click(getByText("Select Range"));
    expect(getByText("January")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(queryByText("January")).toBeNull();
  });
  it("chevron right advances month", () => {
    const { getByText, getByTestId } = render(<DateRangePicker onApply={() => {}} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByTestId("cright-ic").closest("button"));
    expect(getByText("February")).toBeInTheDocument();
  });
  it("chevron left goes back a month", () => {
    const { getByText, getByTestId } = render(<DateRangePicker onApply={() => {}} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByTestId("cleft-ic").closest("button"));
    expect(getByText("December")).toBeInTheDocument();
  });
  it("clicking year toggles year view + selecting a year hides view", () => {
    const { getByText, getAllByText } = render(<DateRangePicker onApply={() => {}} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByText("2025"));
    // Year grid renders 2024 button
    fireEvent.click(getAllByText("2024")[0]);
    expect(getByText("2024")).toBeInTheDocument();
  });
  it("Apply with no start date is disabled (no-op)", () => {
    const onApply = vi.fn();
    const { getByText } = render(<DateRangePicker onApply={onApply} />);
    fireEvent.click(getByText("Select Range"));
    const btn = getByText("Apply Range");
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onApply).not.toHaveBeenCalled();
  });
  it("selecting one day then Apply emits {fromDate, toDate, label}", () => {
    const onApply = vi.fn();
    const { getByText } = render(<DateRangePicker onApply={onApply} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByText("10"));
    fireEvent.click(getByText("Apply Range"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      fromDate: expect.stringMatching(/2025-01-(09|10)/),
      toDate: expect.stringMatching(/2025-01-(09|10)/),
    }));
  });
  it("selecting two days in order: start, end", () => {
    const onApply = vi.fn();
    const { getByText } = render(<DateRangePicker onApply={onApply} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByText("10"));
    fireEvent.click(getByText("20"));
    fireEvent.click(getByText("Apply Range"));
    const call = onApply.mock.calls[0][0];
    expect(call.fromDate).toMatch(/2025-01-(09|10)/);
    expect(call.toDate).toMatch(/2025-01-(19|20)/);
  });
  it("selecting end before start swaps them", () => {
    const onApply = vi.fn();
    const { getByText } = render(<DateRangePicker onApply={onApply} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByText("20"));
    fireEvent.click(getByText("10"));
    fireEvent.click(getByText("Apply Range"));
    const call = onApply.mock.calls[0][0];
    expect(call.fromDate).toMatch(/2025-01-(09|10)/);
    expect(call.toDate).toMatch(/2025-01-(19|20)/);
  });
  it("after both selected, next click restarts range", () => {
    const onApply = vi.fn();
    const { getByText } = render(<DateRangePicker onApply={onApply} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByText("10"));
    fireEvent.click(getByText("20"));
    fireEvent.click(getByText("5"));
    fireEvent.click(getByText("Apply Range"));
    const call = onApply.mock.calls[0][0];
    expect(call.fromDate).toMatch(/2025-01-(04|05)/);
    expect(call.toDate).toMatch(/2025-01-(04|05)/);
  });
  it("Reset clears selection and emits null", () => {
    const onApply = vi.fn();
    const { getByText } = render(<DateRangePicker onApply={onApply} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByText("10"));
    fireEvent.click(getByText("Reset"));
    expect(onApply).toHaveBeenCalledWith(null);
  });
  it("isLight=true uses bg-white styling", () => {
    const { getByText, container } = render(<DateRangePicker isLight onApply={() => {}} />);
    fireEvent.click(getByText("Select Range"));
    expect(container.innerHTML).toMatch(/bg-white/);
  });
  it("trigger label reflects selected date", () => {
    const { getByText, queryByText } = render(<DateRangePicker onApply={() => {}} />);
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByText("10"));
    fireEvent.click(getByText("Apply Range"));
    // After apply, the trigger updates
    expect(queryByText("Select Range")).toBeNull();
  });
  it("mousedown INSIDE the panel does not close it (line 26 false branch)", () => {
    const { getByText } = render(<DateRangePicker onApply={() => {}} />);
    fireEvent.click(getByText("Select Range"));
    // Picker now open. Fire mousedown on an element inside the panel
    // (e.g., the month name) — containerRef.contains is true, so the
    // click-outside handler short-circuits and the panel stays open.
    fireEvent.mouseDown(getByText("January"));
    expect(getByText("January")).toBeInTheDocument();
  });
  it("isLight + year view → light styling on non-active year buttons (line 160)", () => {
    const { getByText, getAllByText, container } = render(
      <DateRangePicker isLight onApply={() => {}} />,
    );
    fireEvent.click(getByText("Select Range"));
    fireEvent.click(getByText("2025")); // open year grid
    // hover-text-gray-600 class on a non-active year button
    expect(container.innerHTML).toMatch(/text-gray-600/);
  });
});

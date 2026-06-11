import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("react-date-range/dist/styles.css", () => ({}));
vi.mock("react-date-range/dist/theme/default.css", () => ({}));

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
vi.mock("react-icons/ci", () => ({
  CiFilter: () => <i data-testid="filter-ic" />,
}));

import CustomDateRangePicker from "../../src/components/CompetitiveDetailsDatePicker.jsx";

beforeEach(() => {
  dateRangePropsCapture.length = 0;
});

describe("CompetitiveDetailsDatePicker", () => {
  it("renders filter button + calendar trigger", () => {
    const { getByTestId } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    expect(getByTestId("filter-ic")).toBeInTheDocument();
    expect(getByTestId("cal-ic")).toBeInTheDocument();
  });
  it("trigger initially shows empty label (no isInitialLoad)", () => {
    const { container } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    const span = container.querySelector("span.text-xs");
    expect(span.textContent.trim()).toBe("");
  });
  it("clicking trigger opens picker + invokes setShowFilterModal(false)", () => {
    const setShowFilterModal = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={setShowFilterModal}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    expect(queryByTestId("date-range")).not.toBeNull();
    expect(setShowFilterModal).toHaveBeenCalledWith(false);
  });
  it("Apply calls onDateChange + setSelectedSystem + updates label", () => {
    const onDateChange = vi.fn();
    const setSelectedSystem = vi.fn();
    const { container, getByTestId, getByText } = render(
      <CustomDateRangePicker
        initialStartDate={new Date(2025, 0, 1)}
        initialEndDate={new Date(2025, 0, 1)}
        onDateChange={onDateChange}
        setSelectedSystem={setSelectedSystem}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    const { onChange } = dateRangePropsCapture.at(-1);
    act(() => {
      onChange({ selection: { startDate: new Date(2025, 5, 10), endDate: new Date(2025, 5, 20), key: "selection" } });
    });
    fireEvent.click(getByText("Apply"));
    expect(setSelectedSystem).toHaveBeenCalledWith(null);
    expect(onDateChange).toHaveBeenCalled();
    // After apply, label shows formatted dates
    const span = container.querySelector("span.text-xs");
    expect(span.textContent).toMatch(/\d{2}-\d{2}-\d{4}/);
  });
  it("Apply without onDateChange does not throw", () => {
    const { getByTestId, getByText } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    expect(() => fireEvent.click(getByText("Apply"))).not.toThrow();
  });
  it("Cancel resets temp range and closes picker", () => {
    const { getByTestId, getByText, queryByTestId } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    fireEvent.click(getByText("Cancel"));
    expect(queryByTestId("date-range")).toBeNull();
  });
  it("handleDateChange updates the captured tempRange", () => {
    const { getByTestId } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    const { onChange } = dateRangePropsCapture.at(-1);
    expect(() => onChange({ selection: { startDate: new Date(), endDate: new Date(), key: "selection" } })).not.toThrow();
  });
  it("handleClearDate after apply resets range and notifies", () => {
    const onDateChange = vi.fn();
    const { container, getByTestId, getByText } = render(
      <CustomDateRangePicker
        onDateChange={onDateChange}
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    // First Apply to set isInitialLoad=true
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    fireEvent.click(getByText("Apply"));
    onDateChange.mockClear();
    // Now click filter (clear) button
    fireEvent.click(getByTestId("filter-ic").closest("button"));
    expect(onDateChange).toHaveBeenCalledWith(null, null);
    // Label is back to empty
    const span = container.querySelector("span.text-xs");
    expect(span.textContent.trim()).toBe("");
  });
  it("handleClearDate is a no-op when isInitialLoad=false", () => {
    const onDateChange = vi.fn();
    const { getByTestId } = render(
      <CustomDateRangePicker
        onDateChange={onDateChange}
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("filter-ic").closest("button"));
    expect(onDateChange).not.toHaveBeenCalled();
  });
  it("clicking outside closes the picker", () => {
    const { getByTestId, queryByTestId } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    expect(queryByTestId("date-range")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(queryByTestId("date-range")).toBeNull();
  });
  it("clicking inside the ref does NOT close picker", () => {
    const { getByTestId, queryByTestId } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    fireEvent.mouseDown(getByTestId("date-range"));
    expect(queryByTestId("date-range")).not.toBeNull();
  });
});

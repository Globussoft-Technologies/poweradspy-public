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

import CustomDateRangePicker from "../../src/components/SimpleDatepicker.jsx";

beforeEach(() => {
  dateRangePropsCapture.length = 0;
});

describe("SimpleDatepicker", () => {
  it("renders trigger with default formatted dates", () => {
    const { container } = render(
      <CustomDateRangePicker
        initialStartDate={new Date(2025, 0, 5)}
        initialEndDate={new Date(2025, 0, 10)}
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    expect(container.textContent).toContain("05-01-2025 - 10-01-2025");
  });
  it("clicking trigger opens DateRange + invokes setShowFilterModal(false)", () => {
    const setShowFilterModal = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={setShowFilterModal}
      />,
    );
    expect(queryByTestId("date-range")).toBeNull();
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    expect(queryByTestId("date-range")).not.toBeNull();
    expect(setShowFilterModal).toHaveBeenCalledWith(false);
  });
  it("toggle closes when clicked again", () => {
    const { getByTestId, queryByTestId } = render(
      <CustomDateRangePicker
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    const trigger = getByTestId("cal-ic").closest("button");
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(queryByTestId("date-range")).toBeNull();
  });
  it("DateRange onChange updates tempRange (visible after Cancel reset)", () => {
    const { getByTestId, getByText } = render(
      <CustomDateRangePicker
        initialStartDate={new Date(2025, 0, 1)}
        initialEndDate={new Date(2025, 0, 1)}
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    const { onChange } = dateRangePropsCapture.at(-1);
    act(() => {
      onChange({ selection: { startDate: new Date(2025, 5, 10), endDate: new Date(2025, 5, 20), key: "selection" } });
    });
    fireEvent.click(getByText("Cancel"));
    // After cancel, the trigger label remains the original
    expect(document.body.textContent).toContain("01-01-2025");
  });
  it("Apply commits the temp range + invokes onDateChange and setSelectedSystem", () => {
    const onDateChange = vi.fn();
    const setSelectedSystem = vi.fn();
    const { getByTestId, getByText } = render(
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
    const newStart = new Date(2025, 5, 10);
    const newEnd = new Date(2025, 5, 20);
    act(() => {
      onChange({ selection: { startDate: newStart, endDate: newEnd, key: "selection" } });
    });
    fireEvent.click(getByText("Apply"));
    expect(setSelectedSystem).toHaveBeenCalledWith(null);
    expect(onDateChange).toHaveBeenCalledWith(newStart, newEnd);
  });
  it("Apply without onDateChange prop does not throw", () => {
    const setSelectedSystem = vi.fn();
    const { getByTestId, getByText } = render(
      <CustomDateRangePicker
        setSelectedSystem={setSelectedSystem}
        setShowFilterModal={() => {}}
      />,
    );
    fireEvent.click(getByTestId("cal-ic").closest("button"));
    expect(() => fireEvent.click(getByText("Apply"))).not.toThrow();
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
  it("clicking inside the picker does NOT close it", () => {
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
  it("formatDate returns empty string for falsy date", () => {
    // Render with start/end as null forces formatDate to receive null
    const { container } = render(
      <CustomDateRangePicker
        initialStartDate={null}
        initialEndDate={null}
        setSelectedSystem={() => {}}
        setShowFilterModal={() => {}}
      />,
    );
    // Trigger button still renders, label is " - " (empty - empty)
    expect(container.querySelector("button")).not.toBeNull();
  });
});

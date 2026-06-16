import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

const { captured } = vi.hoisted(() => ({ captured: { current: null } }));

vi.mock("react-date-range", () => ({
  DateRangePicker: ({ ranges, onChange }) => {
    captured.current = { ranges, onChange };
    return (
      <div data-testid="date-range-picker">
        <button data-testid="fire-change" onClick={() => onChange({ selection: { startDate: new Date(0), endDate: new Date(1) } })} />
      </div>
    );
  },
}));
vi.mock("react-date-range/dist/styles.css", () => ({}));
vi.mock("react-date-range/dist/theme/default.css", () => ({}));

import RangeDatePicker from "../../../src/pages/user/RangeDatePicker.jsx";

beforeEach(() => {
  captured.current = null;
});

describe("pages/user/RangeDatePicker", () => {
  it("passes selectedDates → ranges and forwards onDateChange", () => {
    const onDateChange = vi.fn();
    render(
      <RangeDatePicker
        onApply={vi.fn()}
        onCancel={vi.fn()}
        onDateChange={onDateChange}
        selectedDates={{ startDate: new Date(2026, 4, 1), endDate: new Date(2026, 4, 7) }}
      />
    );
    expect(captured.current.ranges[0].key).toBe("selection");
    fireEvent.click(screen.getByTestId("fire-change"));
    expect(onDateChange).toHaveBeenCalled();
  });

  it("Apply: invokes onApply (and not onCancel)", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <RangeDatePicker
        onApply={onApply}
        onCancel={onCancel}
        onDateChange={vi.fn()}
        selectedDates={{ startDate: new Date(), endDate: new Date() }}
      />
    );
    fireEvent.click(screen.getByText("Apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Cancel: invokes onCancel (and not onApply)", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <RangeDatePicker
        onApply={onApply}
        onCancel={onCancel}
        onDateChange={vi.fn()}
        selectedDates={{ startDate: new Date(), endDate: new Date() }}
      />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

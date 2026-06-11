import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("rsuite/dist/rsuite.min.css", () => ({}));

const drpPropsCapture = [];
vi.mock("rsuite", () => ({
  DateRangePicker: (props) => {
    drpPropsCapture.push(props);
    return <div data-testid="drp" />;
  },
}));

vi.mock("moment", () => ({
  default: (val) => ({
    toDate: () => (val ? new Date(val) : new Date(2026, 5, 1)),
  }),
}));

vi.mock("js-cookie", () => ({
  default: { get: (k) => (k === "createdAt" ? "2025-01-15" : undefined) },
}));

import Daterangepicker from "../../src/components/Daterangepicker.jsx";

describe("Daterangepicker", () => {
  it("renders rsuite DateRangePicker", () => {
    const { getByTestId } = render(<Daterangepicker onSelect={() => {}} onDateSelectRange={() => {}} />);
    expect(getByTestId("drp")).toBeInTheDocument();
  });
  it("passes shouldDisableDate that returns true for out-of-range dates", () => {
    drpPropsCapture.length = 0;
    render(<Daterangepicker />);
    const { shouldDisableDate } = drpPropsCapture.at(-1);
    // minDate is 2025-01-15; maxDate is the mocked default. A 2024 date should be disabled.
    expect(shouldDisableDate(new Date(2024, 0, 1))).toBe(true);
    // A date inside the range
    expect(shouldDisableDate(new Date(2025, 5, 1))).toBe(false);
  });
  it("onChange handler exists (no-op)", () => {
    drpPropsCapture.length = 0;
    render(<Daterangepicker />);
    const { onChange } = drpPropsCapture.at(-1);
    expect(() => onChange([new Date(), new Date()])).not.toThrow();
  });
});

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Calendar: () => <i data-testid="cal-ic" />,
}));

import DateRangeFilter from "../../../src/components/filters/DateRangeFilter.jsx";

const OPTIONS = ["Last 7 Days", "Last 30 Days", "Custom Date Range"];

describe("DateRangeFilter", () => {
  it("renders each option as a button", () => {
    const { getAllByRole } = render(
      <DateRangeFilter options={OPTIONS} onChange={() => {}} />,
    );
    expect(getAllByRole("button").length).toBe(3);
  });
  it("selecting a non-custom option calls onChange", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <DateRangeFilter options={OPTIONS} onChange={onChange} />,
    );
    fireEvent.click(getByText("Last 7 Days"));
    expect(onChange).toHaveBeenCalledWith("Last 7 Days");
  });
  it("selecting 'Custom Date Range' opens the custom picker", () => {
    const { getByText } = render(
      <DateRangeFilter options={OPTIONS} onChange={() => {}} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    expect(getByText("Custom Range")).toBeInTheDocument();
  });
  it("non-custom click hides the picker if it was open", () => {
    const { getByText, queryByText } = render(
      <DateRangeFilter options={OPTIONS} onChange={() => {}} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    fireEvent.click(getByText("Last 30 Days"));
    expect(queryByText("Custom Range")).toBeNull();
  });
  it("active option has the dot indicator", () => {
    const { container } = render(
      <DateRangeFilter options={OPTIONS} value="Last 7 Days" onChange={() => {}} />,
    );
    expect(container.querySelector("div.bg-\\[\\#335296\\]")).not.toBeNull();
  });
  it("Apply with both dates emits combined value + closes picker", () => {
    const onChange = vi.fn();
    const { getByText, queryByText, getAllByDisplayValue, container } = render(
      <DateRangeFilter options={OPTIONS} onChange={onChange} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    const inputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0], { target: { value: "2025-01-01" } });
    fireEvent.change(inputs[1], { target: { value: "2025-01-31" } });
    fireEvent.click(getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith("2025-01-01 to 2025-01-31");
    expect(queryByText("Custom Range")).toBeNull();
  });
  it("Apply with missing dates is a no-op", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <DateRangeFilter options={OPTIONS} onChange={onChange} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    fireEvent.click(getByText("Apply"));
    expect(onChange).not.toHaveBeenCalled();
  });
  it("Cancel closes the picker", () => {
    const { getByText, queryByText } = render(
      <DateRangeFilter options={OPTIONS} onChange={() => {}} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    fireEvent.click(getByText("Cancel"));
    expect(queryByText("Custom Range")).toBeNull();
  });
});

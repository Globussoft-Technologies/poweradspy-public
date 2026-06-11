import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Calendar: () => <i data-testid="cal-ic" />,
}));

import DatePresetFilter from "../../../src/components/filters/DatePresetFilter.jsx";

describe("DatePresetFilter", () => {
  it("renders each option as a button", () => {
    const { getAllByRole } = render(
      <DatePresetFilter options={["Today", "Yesterday"]} onChange={() => {}} />,
    );
    expect(getAllByRole("button").length).toBe(2);
  });
  it("renders {label, value} options with label text", () => {
    const { getByText } = render(
      <DatePresetFilter options={[{ value: "t", label: "Today" }]} onChange={() => {}} />,
    );
    expect(getByText("Today")).toBeInTheDocument();
  });
  it("selecting a non-custom option calls onChange with the value", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <DatePresetFilter options={["Today"]} onChange={onChange} />,
    );
    fireEvent.click(getByText("Today"));
    expect(onChange).toHaveBeenCalledWith("Today");
  });
  it("'custom' value opens picker without calling onChange", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <DatePresetFilter options={[{ value: "custom", label: "Custom" }]} onChange={onChange} />,
    );
    fireEvent.click(getByText("Custom"));
    expect(onChange).not.toHaveBeenCalled();
    expect(getByText("Custom Range")).toBeInTheDocument();
  });
  it("'Custom Date Range' string also opens picker", () => {
    const { getByText } = render(
      <DatePresetFilter options={["Custom Date Range"]} onChange={() => {}} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    expect(getByText("Custom Range")).toBeInTheDocument();
  });
  it("selecting another preset after custom hides picker", () => {
    const { getByText, queryByText } = render(
      <DatePresetFilter options={["Today", "Custom Date Range"]} onChange={() => {}} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    fireEvent.click(getByText("Today"));
    expect(queryByText("Custom Range")).toBeNull();
  });
  it("active preset has dot indicator (via value)", () => {
    const { container } = render(
      <DatePresetFilter options={["Today"]} value="Today" onChange={() => {}} />,
    );
    expect(container.querySelector("div.bg-\\[\\#335296\\]")).not.toBeNull();
  });
  it("active preset falls back to selected[0]", () => {
    const { container } = render(
      <DatePresetFilter options={["Today", "Yesterday"]} selected={["Yesterday"]} onChange={() => {}} />,
    );
    expect(container.querySelector("div.bg-\\[\\#335296\\]")).not.toBeNull();
  });
  it("no value/selected → no dot", () => {
    const { container } = render(
      <DatePresetFilter options={["Today"]} onChange={() => {}} />,
    );
    expect(container.querySelector("div.bg-\\[\\#335296\\]")).toBeNull();
  });
  it("Apply with both dates emits combined value + closes picker", () => {
    const onChange = vi.fn();
    const { getByText, queryByText, container } = render(
      <DatePresetFilter options={["Custom Date Range"]} onChange={onChange} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    const inputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0], { target: { value: "2025-01-01" } });
    fireEvent.change(inputs[1], { target: { value: "2025-01-31" } });
    fireEvent.click(getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith("2025-01-01 to 2025-01-31");
    expect(queryByText("Custom Range")).toBeNull();
  });
  it("Apply with missing dates → no-op (picker stays open)", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <DatePresetFilter options={["Custom Date Range"]} onChange={onChange} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    fireEvent.click(getByText("Apply"));
    expect(onChange).not.toHaveBeenCalled();
  });
  it("Cancel closes the picker", () => {
    const { getByText, queryByText } = render(
      <DatePresetFilter options={["Custom Date Range"]} onChange={() => {}} />,
    );
    fireEvent.click(getByText("Custom Date Range"));
    fireEvent.click(getByText("Cancel"));
    expect(queryByText("Custom Range")).toBeNull();
  });
});

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  ListFilter: () => <i data-testid="filter-ic" />,
}));

vi.mock("react-icons/go", () => ({
  GoChevronDown: () => <i data-testid="chev-down" />,
  GoChevronUp: () => <i data-testid="chev-up" />,
}));

const datePickerPropsCapture = [];
vi.mock("../../../src/components/Daterangepicker", () => ({
  default: (props) => {
    datePickerPropsCapture.push(props);
    return <div data-testid="date-picker" />;
  },
}));

const selectPropsCapture = [];
vi.mock("react-select", () => ({
  default: (props) => {
    selectPropsCapture.push(props);
    return <div data-testid="rs-select" />;
  },
}));

vi.mock("country-list", () => ({
  default: {
    getData: () => [
      { code: "US", name: "United States" },
      { code: "GB", name: "United Kingdom" },
    ],
  },
}));

import FbAccountFilter from "../../../src/components/Pas/FbAccountFilter.jsx";

beforeEach(() => {
  datePickerPropsCapture.length = 0;
  selectPropsCapture.length = 0;
});

describe("FbAccountFilter", () => {
  it("renders Filter trigger button initially", () => {
    const { getByText, queryByText } = render(<FbAccountFilter onFilterChange={() => {}} />);
    expect(getByText("Filter")).toBeInTheDocument();
    expect(queryByText("Date")).toBeNull();
  });
  it("clicking Filter opens popover with 4 sections", () => {
    const { getByText } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    for (const section of ["Date", "City", "Account Name", "Country"]) {
      expect(getByText(section)).toBeInTheDocument();
    }
    expect(getByText("Apply")).toBeInTheDocument();
    expect(getByText("Clear")).toBeInTheDocument();
  });
  it("toggleDropdown opens Date dropdown → Daterangepicker shown", () => {
    const { getByText, queryByTestId } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Date"));
    expect(queryByTestId("date-picker")).not.toBeNull();
  });
  it("toggleDropdown closes Date when clicked again", () => {
    const { getByText, queryByTestId } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Date"));
    fireEvent.click(getByText("Date"));
    expect(queryByTestId("date-picker")).toBeNull();
  });
  it("opening City closes Date (single-select behavior)", () => {
    const { getByText, queryByTestId } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Date"));
    expect(queryByTestId("date-picker")).not.toBeNull();
    fireEvent.click(getByText("City"));
    expect(queryByTestId("date-picker")).toBeNull();
  });
  it("City dropdown shows Bhilai + Bangalore radio options", () => {
    const { getByText, getByLabelText } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("City"));
    expect(getByLabelText("Bhilai")).toBeInTheDocument();
    expect(getByLabelText("Bangalore")).toBeInTheDocument();
  });
  it("selecting a city updates filter state", () => {
    const onFilterChange = vi.fn();
    const { getByText, getByLabelText } = render(<FbAccountFilter onFilterChange={onFilterChange} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("City"));
    fireEvent.click(getByLabelText("Bangalore"));
    fireEvent.click(getByText("Apply"));
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ city: "Bangalore" }));
  });
  it("Account Name input updates filter state", () => {
    const onFilterChange = vi.fn();
    const { getByText, getByPlaceholderText } = render(<FbAccountFilter onFilterChange={onFilterChange} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Account Name"));
    fireEvent.change(getByPlaceholderText("Type account name"), { target: { value: "Nike" } });
    fireEvent.click(getByText("Apply"));
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ accountName: "Nike" }));
  });
  it("Country Select onChange handles a selected option", () => {
    const onFilterChange = vi.fn();
    const { getByText } = render(<FbAccountFilter onFilterChange={onFilterChange} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Country"));
    const { onChange } = selectPropsCapture.at(-1);
    act(() => { onChange({ label: "United States", value: "US" }); });
    fireEvent.click(getByText("Apply"));
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ country: "United States" }));
  });
  it("Country Select onChange handles cleared (null) selection", () => {
    const onFilterChange = vi.fn();
    const { getByText } = render(<FbAccountFilter onFilterChange={onFilterChange} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Country"));
    const { onChange } = selectPropsCapture.at(-1);
    act(() => { onChange(null); });
    fireEvent.click(getByText("Apply"));
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ country: "" }));
  });
  it("Daterangepicker onDateChange updates filter dateRange", () => {
    const onFilterChange = vi.fn();
    const { getByText } = render(<FbAccountFilter onFilterChange={onFilterChange} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Date"));
    const { onDateChange } = datePickerPropsCapture.at(-1);
    act(() => { onDateChange("2025-01-01", "2025-01-31"); });
    fireEvent.click(getByText("Apply"));
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({
      dateRange: { startDate: "2025-01-01", endDate: "2025-01-31" },
    }));
  });
  it("Apply closes the popover", () => {
    const { getByText, queryByText } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Apply"));
    expect(queryByText("Date")).toBeNull();
  });
  it("Clear resets filters + calls onFilterChange with empty state", () => {
    const onFilterChange = vi.fn();
    const { getByText, getByLabelText } = render(<FbAccountFilter onFilterChange={onFilterChange} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("City"));
    fireEvent.click(getByLabelText("Bhilai"));
    onFilterChange.mockClear();
    fireEvent.click(getByText("Clear"));
    expect(onFilterChange).toHaveBeenCalledWith({
      dateRange: { startDate: null, endDate: null },
      city: "",
      accountName: "",
      country: "",
    });
  });
  it("clicking outside closes popover via setTimeout", () => {
    vi.useFakeTimers();
    const { getByText, queryByText } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    expect(queryByText("Date")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    act(() => { vi.advanceTimersByTime(50); });
    vi.useRealTimers();
    expect(queryByText("Date")).toBeNull();
  });
  it("clicking inside the daterange panel does NOT close popover", () => {
    vi.useFakeTimers();
    const { getByText, queryByText } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    const panel = document.createElement("div");
    panel.className = "rs-picker-daterange-panel";
    document.body.appendChild(panel);
    fireEvent.mouseDown(panel);
    act(() => { vi.advanceTimersByTime(50); });
    vi.useRealTimers();
    expect(queryByText("Date")).not.toBeNull();
    panel.remove();
  });
  it("clicking inside popover does NOT close it", () => {
    vi.useFakeTimers();
    const { getByText, queryByText } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.mouseDown(getByText("Date"));
    act(() => { vi.advanceTimersByTime(50); });
    vi.useRealTimers();
    expect(queryByText("Date")).not.toBeNull();
  });
  it("Select styles.control function merges base with minHeight=40px", () => {
    const { getByText } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Country"));
    const { styles } = selectPropsCapture.at(-1);
    const result = styles.control({ color: "red" });
    expect(result).toEqual({ color: "red", minHeight: "40px" });
  });
  it("ChevronUp shown when a section is open", () => {
    const { getByText, getAllByTestId } = render(<FbAccountFilter onFilterChange={() => {}} />);
    fireEvent.click(getByText("Filter"));
    fireEvent.click(getByText("Date"));
    // At least one chev-up + 3 chev-down siblings
    expect(getAllByTestId("chev-up").length).toBe(1);
  });
});

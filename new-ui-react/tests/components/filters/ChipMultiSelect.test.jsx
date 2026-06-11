import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  X: () => <i data-testid="x-ic" />,
  Search: () => <i data-testid="search-ic" />,
}));

import ChipMultiSelect from "../../../src/components/filters/ChipMultiSelect.jsx";

describe("ChipMultiSelect", () => {
  it("renders all option chips", () => {
    const { getAllByRole } = render(
      <ChipMultiSelect options={["A", "B"]} selected={[]} onChange={() => {}} />,
    );
    expect(getAllByRole("button").length).toBeGreaterThanOrEqual(2);
  });
  it("renders {label,value} option chips with label text", () => {
    const { getByText } = render(
      <ChipMultiSelect
        options={[{ value: "a", label: "Apple" }]}
        selected={[]}
        onChange={() => {}}
      />,
    );
    expect(getByText("Apple")).toBeInTheDocument();
  });
  it("active option shows X icon prefix", () => {
    const { getAllByTestId } = render(
      <ChipMultiSelect options={["A"]} selected={["A"]} onChange={() => {}} />,
    );
    expect(getAllByTestId("x-ic").length).toBe(1);
  });
  it("clicking unselected → adds to selection", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ChipMultiSelect options={["A", "B"]} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });
  it("clicking selected → removes from selection", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ChipMultiSelect options={["A"]} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("showSearch=true (default): search input rendered with default placeholder", () => {
    const { getByPlaceholderText } = render(
      <ChipMultiSelect options={["A"]} onChange={() => {}} />,
    );
    expect(getByPlaceholderText("Search...")).toBeInTheDocument();
  });
  it("search placeholder uses label when provided", () => {
    const { getByPlaceholderText } = render(
      <ChipMultiSelect label="CTA" options={["A"]} onChange={() => {}} />,
    );
    expect(getByPlaceholderText("Search CTA...")).toBeInTheDocument();
  });
  it("showSearch=false hides the search input", () => {
    const { queryByPlaceholderText, queryByTestId } = render(
      <ChipMultiSelect options={["A"]} showSearch={false} onChange={() => {}} />,
    );
    expect(queryByPlaceholderText(/Search/)).toBeNull();
    expect(queryByTestId("search-ic")).toBeNull();
  });
  it("typing filters case-insensitively", () => {
    const { getAllByRole, getByPlaceholderText } = render(
      <ChipMultiSelect
        options={["Apple", "Banana", "Carrot"]}
        onChange={() => {}}
      />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "ban" } });
    const buttons = getAllByRole("button");
    // 1 chip + zero expand buttons
    expect(buttons.length).toBe(1);
  });
  it("shows '+ N more' when >12 options collapsed", () => {
    const opts = Array.from({ length: 15 }, (_, i) => `Opt${i}`);
    const { getByText } = render(
      <ChipMultiSelect options={opts} onChange={() => {}} />,
    );
    expect(getByText(/\+ 3 more/)).toBeInTheDocument();
  });
  it("expand → 'Show less'", () => {
    const opts = Array.from({ length: 15 }, (_, i) => `Opt${i}`);
    const { getByText } = render(
      <ChipMultiSelect options={opts} onChange={() => {}} />,
    );
    fireEvent.click(getByText(/\+ 3 more/));
    expect(getByText("Show less")).toBeInTheDocument();
  });
  it("'Show less' collapses back", () => {
    const opts = Array.from({ length: 15 }, (_, i) => `Opt${i}`);
    const { getByText } = render(
      <ChipMultiSelect options={opts} onChange={() => {}} />,
    );
    fireEvent.click(getByText(/\+ 3 more/));
    fireEvent.click(getByText("Show less"));
    expect(getByText(/\+ 3 more/)).toBeInTheDocument();
  });
  it("≤12 options → no expand controls", () => {
    const opts = Array.from({ length: 5 }, (_, i) => `O${i}`);
    const { queryByText } = render(
      <ChipMultiSelect options={opts} onChange={() => {}} />,
    );
    expect(queryByText(/\+ \d+ more/)).toBeNull();
  });
  it("search active → 'Show less'/'+ N more' suppressed regardless of count", () => {
    const opts = Array.from({ length: 15 }, (_, i) => `Opt${i}`);
    const { getByPlaceholderText, queryByText } = render(
      <ChipMultiSelect options={opts} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "Opt1" } });
    // 6 results (Opt1, Opt10..Opt14) — under 12, so no expand control
    expect(queryByText(/\+ \d+ more/)).toBeNull();
  });
});

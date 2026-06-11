import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Search: () => <i data-testid="search-ic" />,
  Check: () => <i data-testid="check-ic" />,
}));

import FilterCheckboxList from "../../../src/components/filters/FilterCheckboxList.jsx";

describe("FilterCheckboxList", () => {
  it("renders options as buttons", () => {
    const { getAllByRole } = render(
      <FilterCheckboxList options={["A", "B"]} onChange={() => {}} />,
    );
    // 2 option buttons (+ search input not a button)
    expect(getAllByRole("button").length).toBeGreaterThanOrEqual(2);
  });
  it("active option shows Check icon", () => {
    const { getAllByTestId } = render(
      <FilterCheckboxList options={["A", "B"]} selected={["A"]} onChange={() => {}} />,
    );
    expect(getAllByTestId("check-ic").length).toBe(1);
  });
  it("clicking unselected adds to selection", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <FilterCheckboxList options={["A", "B"]} selected={["A"]} onChange={onChange} showSearch={false} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });
  it("clicking selected removes it", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <FilterCheckboxList options={["A"]} selected={["A"]} onChange={onChange} showSearch={false} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("maxItems blocks adding past limit", () => {
    const onChange = vi.fn();
    const { getAllByRole, getByText } = render(
      <FilterCheckboxList options={["A", "B"]} selected={["A"]} maxItems={1}
        onChange={onChange} showSearch={false} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).not.toHaveBeenCalled();
    expect(getByText(/Maximum 1 items selected/)).toBeInTheDocument();
  });
  it("maxItems allows removing past limit", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <FilterCheckboxList options={["A", "B"]} selected={["A"]} maxItems={1}
        onChange={onChange} showSearch={false} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("showSearch=true (default) shows search input", () => {
    const { getByPlaceholderText } = render(
      <FilterCheckboxList options={["A"]} onChange={() => {}} />,
    );
    expect(getByPlaceholderText("Search...")).toBeInTheDocument();
  });
  it("search placeholder uses label", () => {
    const { getByPlaceholderText } = render(
      <FilterCheckboxList label="Countries" options={["A"]} onChange={() => {}} />,
    );
    expect(getByPlaceholderText("Search Countries...")).toBeInTheDocument();
  });
  it("showSearch=false hides search", () => {
    const { queryByPlaceholderText } = render(
      <FilterCheckboxList options={["A"]} showSearch={false} onChange={() => {}} />,
    );
    expect(queryByPlaceholderText(/Search/)).toBeNull();
  });
  it("typing filters options case-insensitively", () => {
    const { getAllByRole, getByPlaceholderText } = render(
      <FilterCheckboxList options={["Apple", "Banana"]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "BAN" } });
    expect(getAllByRole("button").length).toBe(1);
  });
  it("'+ N more' visible when >5 options, expands and collapses", () => {
    const opts = Array.from({ length: 7 }, (_, i) => `O${i}`);
    const { getByText, queryByText } = render(
      <FilterCheckboxList options={opts} showSearch={false} onChange={() => {}} />,
    );
    expect(getByText(/\+ 2 more/)).toBeInTheDocument();
    fireEvent.click(getByText(/\+ 2 more/));
    expect(getByText("Show less")).toBeInTheDocument();
    fireEvent.click(getByText("Show less"));
    expect(queryByText("Show less")).toBeNull();
  });
  it("≤5 options → no expand control", () => {
    const { queryByText } = render(
      <FilterCheckboxList options={["A", "B", "C"]} showSearch={false} onChange={() => {}} />,
    );
    expect(queryByText(/\+ \d+ more/)).toBeNull();
  });
  it("opt.value missing → falls back to opt.label", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <FilterCheckboxList options={[{ label: "Apple" }]} showSearch={false} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith(["Apple"]);
  });
});

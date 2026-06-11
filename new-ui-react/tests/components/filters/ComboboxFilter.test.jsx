import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Search: () => <i data-testid="search-ic" />,
  Check: () => <i data-testid="check-ic" />,
}));

import ComboboxFilter from "../../../src/components/filters/ComboboxFilter.jsx";

describe("ComboboxFilter", () => {
  it("renders all options when no search", () => {
    const { getAllByRole } = render(
      <ComboboxFilter options={["A", "B", "C"]} onChange={() => {}} />,
    );
    expect(getAllByRole("button").length).toBe(3);
  });
  it("placeholder default uses label", () => {
    const { getByPlaceholderText } = render(
      <ComboboxFilter label="Countries" options={[]} onChange={() => {}} />,
    );
    expect(getByPlaceholderText("Search Countries...")).toBeInTheDocument();
  });
  it("placeholder falls back to 'Search...' when no label", () => {
    const { getByPlaceholderText } = render(
      <ComboboxFilter options={[]} onChange={() => {}} />,
    );
    expect(getByPlaceholderText("Search...")).toBeInTheDocument();
  });
  it("custom placeholder honored", () => {
    const { getByPlaceholderText } = render(
      <ComboboxFilter options={[]} onChange={() => {}} placeholder="Find a country" />,
    );
    expect(getByPlaceholderText("Find a country")).toBeInTheDocument();
  });
  it("typing filters case-insensitively", () => {
    const { getAllByRole, getByPlaceholderText } = render(
      <ComboboxFilter options={["Apple", "Banana", "Carrot"]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "ban" } });
    const btns = getAllByRole("button");
    expect(btns.length).toBe(1);
    expect(btns[0].textContent).toBe("Banana");
  });
  it("filter on {label,value} objects matches label", () => {
    const { getAllByRole, getByPlaceholderText } = render(
      <ComboboxFilter
        options={[{ label: "Apple", value: "a" }, { label: "Banana", value: "b" }]}
        onChange={() => {}}
      />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "appl" } });
    expect(getAllByRole("button").length).toBe(1);
  });
  it("no matches → 'No matches'", () => {
    const { getByText, getByPlaceholderText } = render(
      <ComboboxFilter options={["A"]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "zzz" } });
    expect(getByText("No matches")).toBeInTheDocument();
  });
  it("active option shows Check icon", () => {
    const { getAllByTestId } = render(
      <ComboboxFilter options={["A", "B"]} selected={["A"]} onChange={() => {}} />,
    );
    expect(getAllByTestId("check-ic").length).toBe(1);
  });
  it("multiSelect=true: adds to selection", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ComboboxFilter options={["A", "B"]} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });
  it("multiSelect=true: removes selection", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ComboboxFilter options={["A", "B"]} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("multiSelect=false: clicking active deselects to []", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ComboboxFilter options={["A", "B"]} selected={["A"]} multiSelect={false} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("multiSelect=false: clicking unselected replaces", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ComboboxFilter options={["A", "B"]} selected={["A"]} multiSelect={false} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });
  it("valueKey='label' stores label as the value", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ComboboxFilter
        options={[{ label: "Apple", value: "a" }]}
        valueKey="label"
        onChange={onChange}
      />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith(["Apple"]);
  });
  it("valueKey='label' on raw string option falls back to opt (line 29 nullish)", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ComboboxFilter options={["RawStr"]} valueKey="label" onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith(["RawStr"]);
  });
  it("opt.value missing → falls back to opt.label for value", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <ComboboxFilter options={[{ label: "Apple" }]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith(["Apple"]);
  });
});

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FilterRadioList from "../../../src/components/filters/FilterRadioList.jsx";

describe("FilterRadioList", () => {
  it("renders options as buttons (string form)", () => {
    const { getAllByRole } = render(
      <FilterRadioList options={["A", "B"]} onChange={() => {}} />,
    );
    expect(getAllByRole("button").length).toBe(2);
  });
  it("renders {label, value} options", () => {
    const { getByText } = render(
      <FilterRadioList
        options={[{ value: "a", label: "Apple" }, { value: "b", label: "Banana" }]}
        value="a" onChange={() => {}}
      />,
    );
    expect(getByText("Apple")).toBeInTheDocument();
  });
  it("marks active option with the dot indicator", () => {
    const { container } = render(
      <FilterRadioList options={["A", "B"]} value="A" onChange={() => {}} />,
    );
    // The inner dot has class bg-[#335296]
    expect(container.querySelector("div.bg-\\[\\#335296\\]")).not.toBeNull();
  });
  it("selected[0] fallback when value undefined", () => {
    const { container } = render(
      <FilterRadioList options={["A", "B"]} selected={["B"]} onChange={() => {}} />,
    );
    expect(container.querySelector("div.bg-\\[\\#335296\\]")).not.toBeNull();
  });
  it("no value or selected → currentValue=''; no dot rendered", () => {
    const { container } = render(
      <FilterRadioList options={["A", "B"]} onChange={() => {}} />,
    );
    expect(container.querySelector("div.bg-\\[\\#335296\\]")).toBeNull();
  });
  it("clicking a button calls onChange with the value", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <FilterRadioList options={["A", "B"]} value="A" onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith("B");
  });
  it("opt.value missing → falls back to opt.label", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <FilterRadioList options={[{ label: "L1" }]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith("L1");
  });
  it("shows '+ N more' when >5 options collapsed", () => {
    const { getByText } = render(
      <FilterRadioList options={["A", "B", "C", "D", "E", "F", "G"]} onChange={() => {}} />,
    );
    expect(getByText(/\+ 2 more/)).toBeInTheDocument();
  });
  it("clicking '+ N more' expands and shows 'Show less'", () => {
    const { getByText, queryByText } = render(
      <FilterRadioList options={["A", "B", "C", "D", "E", "F", "G"]} onChange={() => {}} />,
    );
    fireEvent.click(getByText(/\+ 2 more/));
    expect(getByText("Show less")).toBeInTheDocument();
    expect(queryByText(/\+ 2 more/)).toBeNull();
  });
  it("clicking 'Show less' collapses back", () => {
    const { getByText } = render(
      <FilterRadioList options={["A", "B", "C", "D", "E", "F", "G"]} onChange={() => {}} />,
    );
    fireEvent.click(getByText(/\+ 2 more/));
    fireEvent.click(getByText("Show less"));
    expect(getByText(/\+ 2 more/)).toBeInTheDocument();
  });
  it("5 or fewer options → no '+ N more'", () => {
    const { queryByText } = render(
      <FilterRadioList options={["A", "B", "C"]} onChange={() => {}} />,
    );
    expect(queryByText(/\+ \d more/)).toBeNull();
  });
});

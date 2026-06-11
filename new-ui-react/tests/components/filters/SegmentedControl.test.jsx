import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import SegmentedControl from "../../../src/components/filters/SegmentedControl.jsx";

describe("SegmentedControl", () => {
  it("renders label when provided", () => {
    const { getByText } = render(
      <SegmentedControl label="Sort" options={["asc", "desc"]} value="asc" onChange={() => {}} />,
    );
    expect(getByText("Sort")).toBeInTheDocument();
  });
  it("omits label when not provided", () => {
    const { container } = render(
      <SegmentedControl options={["asc", "desc"]} value="asc" onChange={() => {}} />,
    );
    expect(container.querySelector("span")).toBeNull();
  });
  it("renders options as buttons (string form)", () => {
    const { getAllByRole } = render(
      <SegmentedControl options={["asc", "desc"]} value="asc" onChange={() => {}} />,
    );
    const btns = getAllByRole("button");
    expect(btns.length).toBe(2);
    expect(btns[0].textContent).toBe("asc");
  });
  it("renders options with {value, label} form", () => {
    const { getByText } = render(
      <SegmentedControl
        options={[{ value: "a", label: "Apple" }, { value: "b", label: "Banana" }]}
        value="a" onChange={() => {}}
      />,
    );
    expect(getByText("Apple")).toBeInTheDocument();
    expect(getByText("Banana")).toBeInTheDocument();
  });
  it("active option styled differently (bg-[#335296])", () => {
    const { getAllByRole } = render(
      <SegmentedControl options={["asc", "desc"]} value="desc" onChange={() => {}} />,
    );
    expect(getAllByRole("button")[1].className).toMatch(/335296/);
    expect(getAllByRole("button")[0].className).not.toMatch(/335296/);
  });
  it("falls back to selected[0] when value undefined", () => {
    const { getAllByRole } = render(
      <SegmentedControl options={["a", "b"]} selected={["b"]} onChange={() => {}} />,
    );
    expect(getAllByRole("button")[1].className).toMatch(/335296/);
  });
  it("currentValue defaults to '' when neither value nor selected provided", () => {
    const { getAllByRole } = render(
      <SegmentedControl options={["a", "b"]} onChange={() => {}} />,
    );
    // No button matches "" → none get active styling
    expect(getAllByRole("button")[0].className).not.toMatch(/335296/);
  });
  it("clicking a button calls onChange with the value", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <SegmentedControl options={["a", "b"]} value="a" onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith("b");
  });
  it("falls back to opt.label when opt.value missing", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <SegmentedControl options={[{ label: "X" }]} value="X" onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith("X");
  });
});

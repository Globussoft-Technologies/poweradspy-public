import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DropdownFilter from "../../../src/components/filters/DropdownFilter";

const options = [
  { label: "All", value: "all", selected_by_default: true },
  { label: "SEARCH", value: "SEARCH" },
];

describe("DropdownFilter", () => {
  it("shows All by default and emits the selected scalar value", () => {
    const onChange = vi.fn();
    render(<DropdownFilter label="Platform" options={options} onChange={onChange} />);

    const select = screen.getByRole("combobox", { name: "Platform" });
    expect(select).toHaveValue("all");
    fireEvent.change(select, { target: { value: "SEARCH" } });
    expect(onChange).toHaveBeenCalledWith("SEARCH");
  });
});

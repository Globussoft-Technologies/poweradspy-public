import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ToggleSwitchFilter from "../../../src/components/filters/ToggleSwitchFilter.jsx";

describe("ToggleSwitchFilter", () => {
  it("keeps toggle labels on one line without changing the standard font size", () => {
    const { getByText } = render(
      <ToggleSwitchFilter
        label="Google Transparency Ads"
        onChange={() => {}}
      />,
    );
    expect(getByText("Google Transparency Ads")).toHaveClass(
      "whitespace-nowrap",
      "text-[14px]",
    );
  });

  it("renders label", () => {
    const { getByText } = render(<ToggleSwitchFilter label="Verified" onChange={() => {}} />);
    expect(getByText("Verified")).toBeInTheDocument();
  });
  it("value=true → ON styling (bg-[#335296])", () => {
    const { container } = render(<ToggleSwitchFilter label="X" value={true} onChange={() => {}} />);
    expect(container.innerHTML).toMatch(/bg-\[#335296\]/);
  });
  it("value=false → OFF styling (bg-[#333])", () => {
    const { container } = render(<ToggleSwitchFilter label="X" value={false} onChange={() => {}} />);
    expect(container.innerHTML).toMatch(/bg-\[#333\]/);
  });
  it("clicking flips onChange to opposite", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<ToggleSwitchFilter label="X" value={false} onChange={onChange} />);
    fireEvent.click(getByRole("button"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it("clicking when ON calls onChange(false)", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<ToggleSwitchFilter label="X" value={true} onChange={onChange} />);
    fireEvent.click(getByRole("button"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
  it("disabled → no button, opacity-35 wrapper", () => {
    const { queryByRole, container } = render(
      <ToggleSwitchFilter label="X" disabled onChange={() => {}} />,
    );
    expect(queryByRole("button")).toBeNull();
    expect(container.querySelector(".opacity-35")).not.toBeNull();
  });
});

import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("lucide-react", () => ({
  Check: () => <i data-testid="check-icon" />,
}));

import ColorSwatchMultiSelect from "../../../src/components/filters/ColorSwatchMultiSelect";

const OPTIONS = [
  { label: "#E03131", value: "#E03131" },
  { label: "#1971C2", value: "#1971C2" },
];

describe("ColorSwatchMultiSelect", () => {
  it("shows color names while emitting the original hex value", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <ColorSwatchMultiSelect
        label="Colors"
        options={OPTIONS}
        selected={[]}
        onChange={onChange}
        accented
      />,
    );

    fireEvent.click(getByRole("button", { name: "Red" }));
    expect(onChange).toHaveBeenCalledWith(["#E03131"]);
  });

  it("marks a selected swatch and can remove it", () => {
    const onChange = vi.fn();
    const { getByRole, getByTestId } = render(
      <ColorSwatchMultiSelect
        label="Colors"
        options={OPTIONS}
        selected={["#1971c2"]}
        onChange={onChange}
        accented
      />,
    );

    expect(getByTestId("check-icon")).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "Blue, selected" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});


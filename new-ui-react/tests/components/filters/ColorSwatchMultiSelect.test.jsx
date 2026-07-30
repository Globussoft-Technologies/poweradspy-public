import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("lucide-react", () => ({
  Check: () => <i data-testid="check-icon" />,
}));

import ColorSwatchMultiSelect from "../../../src/components/filters/ColorSwatchMultiSelect";

const OPTIONS = [
  { label: "#E03131", value: "#E03131" },
  { label: "#F76707", value: "#F76707" },
  { label: "#F2CC0C", value: "#F2CC0C" },
  { label: "#E64980", value: "#E64980" },
  { label: "#C9A227", value: "#C9A227" },
  { label: "#1971C2", value: "#1971C2" },
];

describe("ColorSwatchMultiSelect", () => {
  it("keeps color names accessible without rendering visible swatch labels", () => {
    const onChange = vi.fn();
    const { getByRole, queryByText } = render(
      <ColorSwatchMultiSelect
        label="Colors"
        options={OPTIONS}
        selected={[]}
        onChange={onChange}
        accented
      />,
    );

    const redSwatch = getByRole("button", { name: "Red" });
    expect(redSwatch).toHaveAttribute("title", "Red");
    expect(queryByText("Red")).not.toBeInTheDocument();
    fireEvent.click(redSwatch);
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

  it("selects the backend hex values represented by a curated palette", () => {
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

    fireEvent.click(getByRole("button", { name: "Warm Glow" }));
    expect(onChange).toHaveBeenCalledWith([
      "#E03131",
      "#F76707",
      "#F2CC0C",
      "#E64980",
      "#C9A227",
    ]);
  });
});

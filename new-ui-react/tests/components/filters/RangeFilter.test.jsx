import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import RangeFilter from "../../../src/components/filters/RangeFilter.jsx";

describe("RangeFilter", () => {
  it("renders label and Min/Max inputs", () => {
    const { getByText, getByPlaceholderText } = render(
      <RangeFilter icon={<span>I</span>} label="Likes" />,
    );
    expect(getByText("Likes")).toBeInTheDocument();
    expect(getByPlaceholderText("Min")).toBeInTheDocument();
    expect(getByPlaceholderText("Max")).toBeInTheDocument();
  });
  it("renders the provided icon node", () => {
    const { getByText } = render(<RangeFilter icon={<span>★</span>} label="Stars" />);
    expect(getByText("★")).toBeInTheDocument();
  });
});

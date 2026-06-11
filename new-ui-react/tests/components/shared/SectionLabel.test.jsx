import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SectionLabel from "../../../src/components/shared/SectionLabel.jsx";

describe("SectionLabel", () => {
  it("renders label when not collapsed", () => {
    const { getByText } = render(<SectionLabel label="Filters" />);
    expect(getByText("Filters")).toBeInTheDocument();
  });
  it("hides label when collapsed (adds 'hidden' class)", () => {
    const { container, queryByText } = render(<SectionLabel label="Filters" collapsed />);
    expect(queryByText("Filters")).toBeNull();
    expect(container.querySelector("div.hidden")).not.toBeNull();
  });
});

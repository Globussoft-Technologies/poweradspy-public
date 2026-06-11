import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FilterChip from "../../../src/components/filters/FilterChip.jsx";

vi.mock("lucide-react", () => ({ X: ({ size }) => <i data-testid="x" data-size={size} /> }));

describe("FilterChip", () => {
  it("renders label", () => {
    const { getByText } = render(<FilterChip label="Foo" onRemove={() => {}} />);
    expect(getByText("Foo")).toBeInTheDocument();
  });
  it("calls onRemove when X clicked", () => {
    const onRemove = vi.fn();
    const { getByRole } = render(<FilterChip label="Foo" onRemove={onRemove} />);
    fireEvent.click(getByRole("button"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  ChevronFirst: () => <i data-testid="first-ic" />,
  ChevronLast: () => <i data-testid="last-ic" />,
  ChevronLeft: () => <i data-testid="left-ic" />,
  ChevronRight: () => <i data-testid="right-ic" />,
}));

import PaginationCompetitor from "../../../src/components/Pagination/PaginationCompetitor.jsx";

describe("PaginationCompetitor", () => {
  it("renders 'Page X of Y' label", () => {
    const { getByText } = render(
      <PaginationCompetitor totalCount={50} pageSize={10} pageIndex={2} setPageIndex={() => {}} />,
    );
    expect(getByText("Page 3 of 5")).toBeInTheDocument();
  });
  it("prev disabled on first page", () => {
    const { getByTestId } = render(
      <PaginationCompetitor totalCount={50} pageSize={10} pageIndex={0} setPageIndex={() => {}} />,
    );
    expect(getByTestId("left-ic").closest("button").disabled).toBe(true);
  });
  it("next disabled on last page", () => {
    const { getByTestId } = render(
      <PaginationCompetitor totalCount={20} pageSize={10} pageIndex={1} setPageIndex={() => {}} />,
    );
    expect(getByTestId("right-ic").closest("button").disabled).toBe(true);
  });
  it("prev click decrements pageIndex (uses functional updater)", () => {
    const setPageIndex = vi.fn();
    const { getByTestId } = render(
      <PaginationCompetitor totalCount={50} pageSize={10} pageIndex={2} setPageIndex={setPageIndex} />,
    );
    fireEvent.click(getByTestId("left-ic").closest("button"));
    expect(setPageIndex).toHaveBeenCalled();
    const updater = setPageIndex.mock.calls[0][0];
    expect(updater(2)).toBe(1);
    expect(updater(0)).toBe(0); // floor at 0
  });
  it("next click increments pageIndex (clamps at totalPages-1)", () => {
    const setPageIndex = vi.fn();
    const { getByTestId } = render(
      <PaginationCompetitor totalCount={50} pageSize={10} pageIndex={2} setPageIndex={setPageIndex} />,
    );
    fireEvent.click(getByTestId("right-ic").closest("button"));
    const updater = setPageIndex.mock.calls[0][0];
    expect(updater(2)).toBe(3);
    expect(updater(4)).toBe(4); // ceiling
  });
});

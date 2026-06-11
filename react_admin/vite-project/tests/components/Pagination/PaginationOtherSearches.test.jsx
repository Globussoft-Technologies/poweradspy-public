import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  ChevronFirst: () => <i data-testid="first-ic" />,
  ChevronLast: () => <i data-testid="last-ic" />,
  ChevronLeft: () => <i data-testid="left-ic" />,
  ChevronRight: () => <i data-testid="right-ic" />,
}));

import PaginationOtherSearches from "../../../src/components/Pagination/PaginationOtherSearches.jsx";

describe("PaginationOtherSearches", () => {
  it("pageSize=10 uses ceil; pageSize!=10 uses floor", () => {
    const a = render(
      <PaginationOtherSearches totalCount={25} pageSize={10} pageIndex={0}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(a.getByText("Page 1 of 3")).toBeInTheDocument();
    a.unmount();
    const b = render(
      <PaginationOtherSearches totalCount={25} pageSize={20} pageIndex={0}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(b.getByText("Page 1 of 1")).toBeInTheDocument();
  });
  it("prev disabled on page 0", () => {
    const { getByTestId } = render(
      <PaginationOtherSearches totalCount={50} pageSize={10} pageIndex={0}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(getByTestId("left-ic").closest("button").disabled).toBe(true);
  });
  it("next disabled on last page", () => {
    const { getByTestId } = render(
      <PaginationOtherSearches totalCount={20} pageSize={10} pageIndex={1}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(getByTestId("right-ic").closest("button").disabled).toBe(true);
  });
  it("prev click invokes handlePrevPage", () => {
    const handlePrevPage = vi.fn();
    const { getByTestId } = render(
      <PaginationOtherSearches totalCount={50} pageSize={10} pageIndex={2}
        handlePrevPage={handlePrevPage} handleNextPage={() => {}} />,
    );
    fireEvent.click(getByTestId("left-ic").closest("button"));
    expect(handlePrevPage).toHaveBeenCalled();
  });
  it("next click invokes handleNextPage", () => {
    const handleNextPage = vi.fn();
    const { getByTestId } = render(
      <PaginationOtherSearches totalCount={50} pageSize={10} pageIndex={2}
        handlePrevPage={() => {}} handleNextPage={handleNextPage} />,
    );
    fireEvent.click(getByTestId("right-ic").closest("button"));
    expect(handleNextPage).toHaveBeenCalled();
  });
});

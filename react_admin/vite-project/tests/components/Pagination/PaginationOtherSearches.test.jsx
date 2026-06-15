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
  it("renders nothing when totalCount is 0 or missing", () => {
    const a = render(
      <PaginationOtherSearches totalCount={0} pageSize={10} pageIndex={0}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(a.container.firstChild).toBeNull();
    a.unmount();
    const b = render(
      <PaginationOtherSearches pageSize={10} pageIndex={0}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(b.container.firstChild).toBeNull();
  });
  it("falls back to 1 page when pageSize is missing (ceil(NaN) || 1)", () => {
    const { getByText } = render(
      <PaginationOtherSearches totalCount={25} pageIndex={0}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(getByText("Page 1 of 1")).toBeInTheDocument();
  });
  it("computes total pages with Math.ceil(totalCount / pageSize)", () => {
    const a = render(
      <PaginationOtherSearches totalCount={25} pageSize={10} pageIndex={0}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(a.getByText("Page 1 of 3")).toBeInTheDocument(); // ceil(25/10)=3
    a.unmount();
    const b = render(
      <PaginationOtherSearches totalCount={25} pageSize={20} pageIndex={0}
        handlePrevPage={() => {}} handleNextPage={() => {}} />,
    );
    expect(b.getByText("Page 1 of 2")).toBeInTheDocument(); // ceil(25/20)=2
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

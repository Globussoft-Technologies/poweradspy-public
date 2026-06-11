import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  ChevronFirst: () => <i data-testid="first-ic" />,
  ChevronLast: () => <i data-testid="last-ic" />,
  ChevronLeft: () => <i data-testid="left-ic" />,
  ChevronRight: () => <i data-testid="right-ic" />,
}));

import Pagination from "../../../src/components/Pagination/Pagination.jsx";

describe("Pagination", () => {
  it("pageSize=10 → uses Math.ceil for totalPages (rounds up)", () => {
    const { getByText } = render(
      <Pagination totalCount={25} pageSize={10} pageIndex={0} setPageIndex={() => {}} />,
    );
    // ceil(25/10) = 3
    expect(getByText("Page 1 of 3")).toBeInTheDocument();
  });
  it("pageSize!=10 → uses Math.floor for totalPages (rounds down)", () => {
    const { getByText } = render(
      <Pagination totalCount={25} pageSize={20} pageIndex={0} setPageIndex={() => {}} />,
    );
    // floor(25/20) = 1
    expect(getByText("Page 1 of 1")).toBeInTheDocument();
  });
  it("prev disabled at pageIndex=0", () => {
    const { getByTestId } = render(
      <Pagination totalCount={50} pageSize={10} pageIndex={0} setPageIndex={() => {}} />,
    );
    expect(getByTestId("left-ic").closest("button").disabled).toBe(true);
  });
  it("next disabled at last page", () => {
    const { getByTestId } = render(
      <Pagination totalCount={20} pageSize={10} pageIndex={1} setPageIndex={() => {}} />,
    );
    expect(getByTestId("right-ic").closest("button").disabled).toBe(true);
  });
  it("prev click invokes setPageIndex with Math.max-floored updater", () => {
    const setPageIndex = vi.fn();
    const { getByTestId } = render(
      <Pagination totalCount={50} pageSize={10} pageIndex={3} setPageIndex={setPageIndex} />,
    );
    fireEvent.click(getByTestId("left-ic").closest("button"));
    const updater = setPageIndex.mock.calls[0][0];
    expect(updater(3)).toBe(2);
    expect(updater(0)).toBe(0);
  });
  it("next click invokes setPageIndex with Math.min-ceilinged updater", () => {
    const setPageIndex = vi.fn();
    const { getByTestId } = render(
      <Pagination totalCount={50} pageSize={10} pageIndex={1} setPageIndex={setPageIndex} />,
    );
    fireEvent.click(getByTestId("right-ic").closest("button"));
    const updater = setPageIndex.mock.calls[0][0];
    expect(updater(1)).toBe(2);
    expect(updater(4)).toBe(4);
  });
});

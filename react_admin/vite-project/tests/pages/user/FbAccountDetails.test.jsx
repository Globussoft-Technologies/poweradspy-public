import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

const { useDispatchSpy, useSelectorSpy, fetchSpy, filterChangeRef } = vi.hoisted(() => ({
  useDispatchSpy: vi.fn(),
  useSelectorSpy: vi.fn(),
  fetchSpy: vi.fn(),
  filterChangeRef: { current: null },
}));

vi.mock("react-redux", () => ({
  useDispatch: () => useDispatchSpy,
  useSelector: (sel) => useSelectorSpy(sel),
}));

vi.mock("../../../src/store/actions/powerAdsPyActionsApi", () => ({
  fetchAccountDetails: (payload) => {
    fetchSpy(payload);
    return { type: "FETCH_ACCOUNTS", payload };
  },
}));

vi.mock("../../../src/components/Pas/FbAccountFilter", () => ({
  default: ({ onFilterChange }) => {
    filterChangeRef.current = onFilterChange;
    return (
      <button
        data-testid="trigger-filter"
        onClick={() =>
          onFilterChange({
            dateRange: { startDate: "2026-05-01", endDate: "2026-05-31" },
            city: "Pune", accountName: "alice", country: "IN",
          })
        }
      />
    );
  },
}));

import FbAccountDetails from "../../../src/pages/user/FbAccountDetails.jsx";

beforeEach(() => {
  useDispatchSpy.mockReset();
  useSelectorSpy.mockReset();
  fetchSpy.mockReset();
  filterChangeRef.current = null;
});

const renderWith = (accountData, isLoading = false) => {
  useSelectorSpy.mockImplementation((sel) => sel({ poweradspy: { accountData } }));
  return render(<FbAccountDetails isLoading={isLoading} />);
};

describe("pages/user/FbAccountDetails", () => {
  it("dispatches fetchAccountDetails on mount with initial filters/pagination", () => {
    renderWith([]);
    expect(useDispatchSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith({
      network: "facebook",
      fromDate: null, toDate: null,
      city: "", name: "", country: "",
      limit: 10, skip: 0,
    });
  });

  it("renders 'No data found' when empty and not loading", () => {
    renderWith([]);
    expect(screen.getByText("No data found")).toBeInTheDocument();
  });

  it("renders 'Loading...' when empty and isLoading=true", () => {
    renderWith([], true);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders data rows with the account fields", () => {
    renderWith([
      {
        name: "Alice",
        facebook_id: "FB1",
        created_date: "2026-01-01",
        current_country: "India",
        ad_count: 5,
      },
      {
        // exercises the `|| 'N/A'` and `|| 1` fallbacks
      },
    ]);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("FB1")).toBeInTheDocument();
    expect(screen.getByText("India")).toBeInTheDocument();
    // Fallbacks: second row has all 'N/A's and current_count = 1
    const naCells = screen.getAllByText("N/A");
    expect(naCells.length).toBeGreaterThan(5);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("Next button is disabled when fewer than `limit` rows", () => {
    renderWith([{ name: "x" }]);
    const next = screen.getByText(">").closest("button");
    expect(next).toBeDisabled();
  });

  it("Next button enables + advances page when exactly `limit` rows are present", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `n${i}` }));
    renderWith(ten);
    const next = screen.getByText(">").closest("button");
    expect(next).not.toBeDisabled();
    fetchSpy.mockClear();
    fireEvent.click(next);
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ skip: 10 }));
  });

  it("Prev button is disabled on the first page", () => {
    renderWith([]);
    const prev = screen.getByText("<").closest("button");
    expect(prev).toBeDisabled();
  });

  it("Prev button rewinds page after advancing", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `n${i}` }));
    renderWith(ten);
    const next = screen.getByText(">").closest("button");
    fireEvent.click(next);
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("<").closest("button"));
    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
  });

  it("handleFilterChange re-fetches with the new filters and resets page to 0", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `n${i}` }));
    renderWith(ten);
    // advance to page 2 first
    fireEvent.click(screen.getByText(">").closest("button"));
    fetchSpy.mockClear();
    // trigger filter change
    fireEvent.click(screen.getByTestId("trigger-filter"));
    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({
      city: "Pune", name: "alice", country: "IN", skip: 0,
    }));
    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
  });

  it("handleNext is a no-op when current rows !== limit (button enabled but handler guards)", () => {
    // 11 rows: disabled = (11 < 10) = false → enabled.
    // handleNext checks `=== limit` → false branch fires (no setPage).
    const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `n${i}` }));
    renderWith(eleven);
    const next = screen.getByText(">").closest("button");
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
  });
});

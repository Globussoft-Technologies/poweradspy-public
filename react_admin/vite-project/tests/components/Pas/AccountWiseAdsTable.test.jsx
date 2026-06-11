import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("react-icons/fi", () => ({
  FiSearch: () => <i data-testid="search-ic" />,
}));
vi.mock("lucide-react", () => ({
  ChevronLeft: () => <i data-testid="left-ic" />,
  ChevronRight: () => <i data-testid="right-ic" />,
}));

import AccountWiseAdsTable from "../../../src/components/Pas/AccountWiseAdsTable.jsx";

const makeAccounts = (n) =>
  Array.from({ length: n }, (_, i) => ({
    account_name: `Acct ${i + 1}`,
    country: "US",
    account_id: `${10000 + i}`,
    total_ads: 100 + i,
  }));

beforeEach(() => {
  window.open = vi.fn();
});

describe("AccountWiseAdsTable", () => {
  it("renders header + search input", () => {
    const { getByText, getByPlaceholderText } = render(
      <AccountWiseAdsTable accounts={[]} />,
    );
    expect(getByText("Account Wise Ads")).toBeInTheDocument();
    expect(getByPlaceholderText("Search Account Name")).toBeInTheDocument();
  });
  it("'No accounts found' empty-state when accounts list empty", () => {
    const { getByText } = render(<AccountWiseAdsTable accounts={[]} />);
    expect(getByText("No accounts found")).toBeInTheDocument();
  });
  it("renders up to 5 rows per page (default itemsPerPage)", () => {
    const { container } = render(<AccountWiseAdsTable accounts={makeAccounts(8)} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(5);
  });
  it("totalPages capped at Math.min(totalPages, 3) buttons", () => {
    const { container } = render(<AccountWiseAdsTable accounts={makeAccounts(20)} />);
    const pageBtns = Array.from(container.querySelectorAll("button"))
      .filter(b => /^[0-9]+$/.test(b.textContent));
    expect(pageBtns.length).toBe(3);
  });
  it("totalPages=1 → only 1 page button", () => {
    const { container } = render(<AccountWiseAdsTable accounts={makeAccounts(3)} />);
    const pageBtns = Array.from(container.querySelectorAll("button"))
      .filter(b => /^[0-9]+$/.test(b.textContent));
    expect(pageBtns.length).toBe(1);
  });
  it("clicking a page button switches pages", () => {
    const { container, getByText } = render(<AccountWiseAdsTable accounts={makeAccounts(15)} />);
    fireEvent.click(getByText("2"));
    expect(container.querySelector("button.\\!bg-\\[\\#9ca9ff\\]").textContent).toBe("2");
  });
  it("disable prev on page 1, next on last page", () => {
    const { getByTestId } = render(<AccountWiseAdsTable accounts={makeAccounts(15)} />);
    const prev = getByTestId("left-ic").closest("button");
    const next = getByTestId("right-ic").closest("button");
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
  });
  it("prev/next chevron click changes page", () => {
    const { getByTestId, container } = render(<AccountWiseAdsTable accounts={makeAccounts(15)} />);
    fireEvent.click(getByTestId("right-ic").closest("button"));
    expect(container.querySelector("button.\\!bg-\\[\\#9ca9ff\\]").textContent).toBe("2");
    fireEvent.click(getByTestId("left-ic").closest("button"));
    expect(container.querySelector("button.\\!bg-\\[\\#9ca9ff\\]").textContent).toBe("1");
  });
  it("search filters accounts by name (case-insensitive)", () => {
    const accounts = [
      { account_name: "Nike", country: "US", account_id: "1", total_ads: 5 },
      { account_name: "Adidas", country: "DE", account_id: "2", total_ads: 7 },
    ];
    const { getByPlaceholderText, queryByText } = render(<AccountWiseAdsTable accounts={accounts} />);
    fireEvent.change(getByPlaceholderText("Search Account Name"), { target: { value: "nike" } });
    expect(queryByText("Nike")).not.toBeNull();
    expect(queryByText("Adidas")).toBeNull();
  });
  it("search falls back to account_id when account_name is null", () => {
    const accounts = [
      { account_name: null, country: "US", account_id: "ID-42", total_ads: 5 },
      { account_name: "Other", country: "DE", account_id: "11111", total_ads: 7 },
    ];
    const { getByPlaceholderText, queryAllByText, queryByText } = render(<AccountWiseAdsTable accounts={accounts} />);
    fireEvent.change(getByPlaceholderText("Search Account Name"), { target: { value: "id-42" } });
    expect(queryAllByText("ID-42").length).toBeGreaterThan(0);
    expect(queryByText("Other")).toBeNull();
  });
  it("displays account_id when account_name is null in the table row", () => {
    const accounts = [
      { account_name: null, country: "US", account_id: "FALLBACK-ID", total_ads: 5 },
    ];
    const { getAllByText } = render(<AccountWiseAdsTable accounts={accounts} />);
    expect(getAllByText("FALLBACK-ID").length).toBeGreaterThan(0);
  });
  it("clicking row's account-name cell opens FB profile in new tab", () => {
    const accounts = [
      { account_name: "Nike", country: "US", account_id: "9999", total_ads: 5 },
    ];
    const { getByText } = render(<AccountWiseAdsTable accounts={accounts} />);
    fireEvent.click(getByText("Nike"));
    expect(window.open).toHaveBeenCalledWith(
      "https://www.facebook.com/profile.php?id=9999",
      "_blank",
    );
  });
  it("currentPage===totalPages branch (with 4 total pages, click last)", () => {
    const accounts = makeAccounts(20); // 4 pages
    const { getByText, container } = render(<AccountWiseAdsTable accounts={accounts} />);
    fireEvent.click(getByText("3")); // page 3
    fireEvent.click(getByText("4")); // click button labeled "4" → wait does it appear?
    // At currentPage=3, buttons are 2,3,4. So we click "4" → currentPage=4.
    // Then re-render: pageNums for currentPage===totalPages = totalPages-2+i = 2,3,4
    expect(container.querySelector("button.\\!bg-\\[\\#9ca9ff\\]").textContent).toBe("4");
  });
  it("currentPage in the middle: 3 pages shown around current", () => {
    const accounts = makeAccounts(50); // 10 pages
    const { getByText, container } = render(<AccountWiseAdsTable accounts={accounts} />);
    fireEvent.click(getByText("2"));
    fireEvent.click(getByText("3"));
    // Now pageNums should be 2,3,4
    const pageBtns = Array.from(container.querySelectorAll("button"))
      .filter(b => /^[0-9]+$/.test(b.textContent))
      .map(b => b.textContent);
    expect(pageBtns).toEqual(["2", "3", "4"]);
  });
  it("accounts undefined → effect short-circuits, empty state", () => {
    const { getByText } = render(<AccountWiseAdsTable accounts={undefined} />);
    expect(getByText("No accounts found")).toBeInTheDocument();
  });
});

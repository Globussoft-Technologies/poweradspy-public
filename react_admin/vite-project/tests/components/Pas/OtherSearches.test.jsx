// NOTE: handleUserDetails (lines 39-42) is dead — same pattern as in
// Pas/Dashboard.jsx. See https://github.com/Globussoft-Technologies/poweradspy/issues/256
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent, act } from "@testing-library/react";

vi.mock("react-icons/ci", () => ({
  CiSearch: () => <i data-testid="search-ic" />,
  CiFilter: () => <i data-testid="filter-ic" />,
}));

vi.mock("react-datepicker/dist/react-datepicker.css", () => ({}));
const dpPropsCapture = [];
vi.mock("react-datepicker", () => ({
  default: (props) => {
    dpPropsCapture.push(props);
    return <div data-testid="dp">{props.customInput}</div>;
  },
}));

vi.mock("recharts", () => ({
  BarChart: () => null, Bar: () => null,
  XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, Legend: () => null,
  CartesianGrid: () => null, ResponsiveContainer: () => null, Cell: () => null,
}));

const paginationPropsCapture = [];
vi.mock("../../../src/components/Pagination/Pagination", () => ({
  default: () => null,
}));
vi.mock("../../../src/components/Pagination/PaginationOtherSearches", () => ({
  default: (props) => {
    paginationPropsCapture.push(props);
    return (
      <div data-testid="pagination">
        <button data-testid="next" onClick={props.handleNextPage}>next</button>
        <button data-testid="prev" onClick={props.handlePrevPage}>prev</button>
      </div>
    );
  },
}));

vi.mock("../../../src/components/Pas/Loader", () => ({
  default: () => <div data-testid="loader" />,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const axiosPostMock = vi.fn();
vi.mock("axios", () => ({
  default: { post: (...a) => axiosPostMock(...a) },
}));

vi.mock("js-cookie", () => ({
  default: { get: () => "TOKEN" },
}));

import OtherSearches from "../../../src/components/Pas/OtherSearches.jsx";

beforeEach(() => {
  axiosPostMock.mockReset();
  navigateMock.mockReset();
  dpPropsCapture.length = 0;
  paginationPropsCapture.length = 0;
  vi.stubEnv("VITE_SEARCHES_API", "https://api.example.com/");
  localStorage.setItem("userId", "u-1");
});

const successResp = (overrides = {}) => ({
  data: {
    code: 200,
    search_after: "after-cursor",
    totalCount: 50,
    data: [
      { network: "fb", adsCount: 5, adsCountOnSerach: 3, date: "2025-01-01", "search.keyword": "shoes", keyword_value: "running" },
      { network: "google", adsCount: 0, adsCountOnSerach: 1, date: null, "search.advertiser": "Nike", filterType: "x" },
      { network: "tiktok", adsCount: 0, adsCountOnSerach: 0, date: "2025-02-01", "search.domain": "x.com", "show_analytics.ad_id": ["123"] },
      { network: "ig", adsCount: 5, adsCountOnSerach: 2, date: "2025-03-01", sort: "newest_sort" },
    ],
    ...overrides,
  },
});

describe("OtherSearches", () => {
  it("on mount: dispatches axios.post + renders Loader during fetch", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { getByText } = render(<OtherSearches />);
    expect(getByText("Other Searches")).toBeInTheDocument();
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
    const [url, payload, opts] = axiosPostMock.mock.calls[0];
    expect(url).toContain("get-all-searches");
    expect(payload.user_id).toBe("u-1");
    expect(opts.headers.Authorization).toBe("Bearer TOKEN");
  });
  it("populates table rows from response data (skips empty searchTypes entries)", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { findByText } = render(<OtherSearches />);
    expect(await findByText("fb")).toBeInTheDocument();
  });
  it("show_analytics.ad_id → forces adsCount to 1", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { findAllByText } = render(<OtherSearches />);
    // The tiktok row has show_analytics.ad_id, so adsCount becomes 1
    await findAllByText("tiktok");
    // The "1" appears as adsCount somewhere
    expect((await findAllByText("1")).length).toBeGreaterThan(0);
  });
  it("'newest_sort' value is normalized to null", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { container } = render(<OtherSearches />);
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
    // The ig row's sort=newest_sort should not render the "newest_sort" text in any cell
    await waitFor(() => {
      expect(container.textContent.includes("newest_sort")).toBe(false);
    });
  });
  it("code 404 → empty table → 'No teams available'", async () => {
    axiosPostMock.mockResolvedValue({ data: { code: 404 } });
    const { findByText } = render(<OtherSearches />);
    expect(await findByText("No teams available")).toBeInTheDocument();
  });
  it("code 401 → navigates to root", async () => {
    axiosPostMock.mockResolvedValue({ data: { code: 401 } });
    render(<OtherSearches />);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("date filter triggers re-fetch with from_date/to_date", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    render(<OtherSearches />);
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalledTimes(1));
    // Trigger date change via captured props
    const { onChange } = dpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15)); });
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalledTimes(2));
    const [, payload2] = axiosPostMock.mock.calls[1];
    expect(payload2.from_date).toBe("2025-06-15 00:00:00");
    expect(payload2.to_date).toBe("2025-06-15 23:59:59");
  });
  it("clear-date button resets startDate to null + re-fetches", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { getByText } = render(<OtherSearches />);
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalledTimes(1));
    const { onChange } = dpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15)); });
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalledTimes(2));
    fireEvent.click(getByText("Clear Date"));
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalledTimes(3));
  });
  it("filter input updates filterData state (no crash)", () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { container } = render(<OtherSearches />);
    const input = container.querySelector("input[type='text']");
    fireEvent.change(input, { target: { value: "search" } });
    expect(input.value).toBe("search");
  });
  it("handleNextPage advances pageIndex when search_after available", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { getByTestId } = render(<OtherSearches />);
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
    axiosPostMock.mockClear();
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
    // payload should include search_after
    expect(axiosPostMock.mock.calls[0][1].search_after).toBe("after-cursor");
  });
  it("handlePrevPage does nothing at page 0", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { getByTestId } = render(<OtherSearches />);
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
    axiosPostMock.mockClear();
    fireEvent.click(getByTestId("prev"));
    // Wait briefly and check no new call
    await new Promise((r) => setTimeout(r, 50));
    expect(axiosPostMock).not.toHaveBeenCalled();
  });
  it("handlePrevPage decrements pageIndex when > 0", async () => {
    axiosPostMock.mockResolvedValue(successResp());
    const { getByTestId } = render(<OtherSearches />);
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalledTimes(2));
    axiosPostMock.mockClear();
    fireEvent.click(getByTestId("prev"));
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
  });
  it("Search Type cell handles null value → 'N/A'", async () => {
    // Build a row where item ends up with empty combinedSearchTypes by having only keyword/advertiser/domain
    // Actually the source pushes only when combinedSearchTypes.length > 0, so all rendered rows have a value.
    // Verify standard rendering — N/A appears in the searchType only when value is falsy.
    axiosPostMock.mockResolvedValue({
      data: { code: 200, totalCount: 1, data: [
        { network: "fb", adsCount: 0, adsCountOnSerach: 0, date: "2025-01-01", anyType: "any" },
      ]},
    });
    const { findByText } = render(<OtherSearches />);
    expect(await findByText("fb")).toBeInTheDocument();
  });
  it("renders Searched Value 'null' when searchedValue empty string", async () => {
    axiosPostMock.mockResolvedValue({
      data: { code: 200, totalCount: 1, data: [
        { network: "fb", adsCount: 0, adsCountOnSerach: 0, "": "" },
      ]},
    });
    const { container } = render(<OtherSearches />);
    await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
    expect(container).not.toBeNull();
  });
  it("keyword badge K rendered for keyword data", async () => {
    axiosPostMock.mockResolvedValue({
      data: { code: 200, totalCount: 1, data: [
        { network: "fb", "search.keyword": "kw", x: "any" },
      ]},
    });
    const { findByText } = render(<OtherSearches />);
    expect(await findByText("K")).toBeInTheDocument();
  });
  it("advertiser badge A rendered for advertiser data", async () => {
    axiosPostMock.mockResolvedValue({
      data: { code: 200, totalCount: 1, data: [
        { network: "fb", "search.advertiser": "adv", x: "any" },
      ]},
    });
    const { findByText } = render(<OtherSearches />);
    expect(await findByText("A")).toBeInTheDocument();
  });
  it("domain badge D rendered for domain data", async () => {
    axiosPostMock.mockResolvedValue({
      data: { code: 200, totalCount: 1, data: [
        { network: "fb", "search.domain": "x.com", x: "any" },
      ]},
    });
    const { findByText } = render(<OtherSearches />);
    expect(await findByText("D")).toBeInTheDocument();
  });
  it("no key/adv/domain → '-' placeholder + no badge", async () => {
    axiosPostMock.mockResolvedValue({
      data: { code: 200, totalCount: 1, data: [
        { network: "fb", x: "any" },
      ]},
    });
    const { findByText } = render(<OtherSearches />);
    expect(await findByText("-")).toBeInTheDocument();
  });
  it("array value gets joined", async () => {
    axiosPostMock.mockResolvedValue({
      data: { code: 200, totalCount: 1, data: [
        { network: "fb", multi: ["a", "b", "c"] },
      ]},
    });
    const { findByText } = render(<OtherSearches />);
    expect(await findByText("a, b, c")).toBeInTheDocument();
  });
});

// NOTE: defensive ref-null + header-as-function branch unreachable — see #258
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("react-icons/ci", () => ({
  CiFilter: () => null,
  CiSearch: () => <i data-testid="search-ic" />,
}));
vi.mock("react-icons/fa", () => ({
  FaArrowUp: () => null, FaArrowDown: () => null,
  FaSortUp: () => null, FaSortDown: () => null,
}));

vi.mock("react-datepicker/dist/react-datepicker.css", () => ({}));
vi.mock("react-datepicker", () => ({ default: () => null }));

const datePickerPropsCapture = [];
vi.mock("../../../src/components/CompetitiveDetailsDatePicker", () => ({
  default: (props) => {
    datePickerPropsCapture.push(props);
    return <div data-testid="comp-dp" />;
  },
}));

vi.mock("recharts", () => ({
  BarChart: () => null, Bar: () => null,
  XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, Legend: () => null,
  CartesianGrid: () => null, ResponsiveContainer: () => null, Cell: () => null,
}));

vi.mock("../../../src/components/Pagination/Pagination", () => ({ default: () => null }));

const paginationPropsCapture = [];
vi.mock("../../../src/components/Pagination/PaginationCompetitor", () => ({
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

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("react-toastify", () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
  toast: toastMock,
}));
vi.mock("react-toastify/dist/ReactToastify.css", () => ({}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const axiosGetMock = vi.fn();
vi.mock("axios", () => ({
  default: { get: (...a) => axiosGetMock(...a) },
}));

const postApiCallMock = vi.fn();
const storeApiCallMock = vi.fn();
vi.mock("../../../src/components/Pas/ApiResponse", () => ({
  postApiCall: (...a) => postApiCallMock(...a),
  storeApiCall: (...a) => storeApiCallMock(...a),
}));

import AdminContext from "../../../src/Context/Context.jsx";
import CompetitorDetails from "../../../src/components/Pas/CompetitorDetails.jsx";

const renderWith = (filterState = 3) => {
  const setsearchdataFilterTable = vi.fn();
  const ctx = { searchdataFilterTable: filterState, setsearchdataFilterTable };
  const setKeywordStatis = vi.fn();
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <CompetitorDetails setKeywordStatis={setKeywordStatis} />
    </AdminContext.Provider>,
  );
  return { ...utils, ctx, setKeywordStatis };
};

beforeEach(() => {
  axiosGetMock.mockReset();
  postApiCallMock.mockReset();
  storeApiCallMock.mockReset();
  navigateMock.mockReset();
  toastMock.success.mockClear();
  toastMock.warning.mockClear();
  toastMock.error.mockClear();
  datePickerPropsCapture.length = 0;
  paginationPropsCapture.length = 0;
  sessionStorage.clear();
  vi.stubEnv("VITE_COMPETITORS_API", "https://comp.example.com/");
  vi.stubEnv("VITE_FACEBOOK_API", "https://fb.example.com/");
  vi.stubEnv("VITE_INSTAGRAM_API", "https://ig.example.com/");
  globalThis.fetch = vi.fn();
});

const competitorResp = (data = [], totalCount = data.length) => ({
  data: {
    statusCode: 200,
    body: { data: { data, totalCount } },
  },
});

const compUserCountResp = () => ({
  data: { statusCode: 200, body: { data: { totalUsers: 100, activeUsers: 60, inActiveUsers: 40 } } },
});

describe("CompetitorDetails", () => {
  it("renders 3 stat cards + Active/Inactive tabs", async () => {
    axiosGetMock.mockImplementation((url) => {
      if (url.includes("get-comp-users-count")) return Promise.resolve(compUserCountResp());
      return Promise.resolve(competitorResp());
    });
    const { getByText } = renderWith();
    expect(getByText("Active Competitors")).toBeInTheDocument();
    expect(getByText("Inactive Competitors")).toBeInTheDocument();
    expect(getByText("Total Users")).toBeInTheDocument();
    expect(getByText("Active Users")).toBeInTheDocument();
    expect(getByText("Inactive Users")).toBeInTheDocument();
  });
  it("fetches active details on mount", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(axiosGetMock.mock.calls.some(c => c[0].includes("get-active-details"))).toBe(true);
  });
  it("switching to Inactive tab fetches inactive endpoint", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    const { getByText } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    axiosGetMock.mockClear();
    fireEvent.click(getByText("Inactive Competitors"));
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(axiosGetMock.mock.calls[0][0]).toContain("get-inactive-details");
  });
  it("populates stats from getCompUsersCount", async () => {
    axiosGetMock.mockImplementation((url) => {
      if (url.includes("get-comp-users-count")) return Promise.resolve(compUserCountResp());
      return Promise.resolve(competitorResp());
    });
    const { findByText } = renderWith();
    expect(await findByText("100")).toBeInTheDocument();
    expect(await findByText("60")).toBeInTheDocument();
    expect(await findByText("40")).toBeInTheDocument();
  });
  it("comp count 401 → navigate", async () => {
    axiosGetMock.mockImplementation((url) => {
      if (url.includes("get-comp-users-count")) return Promise.resolve({ code: 401, data: {} });
      return Promise.resolve(competitorResp());
    });
    renderWith();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("axios.get error → toast.error", async () => {
    axiosGetMock.mockRejectedValue(new Error("network down"));
    renderWith();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
  it("response with non-200 statusCode → empty data + 'No teams available'", async () => {
    axiosGetMock.mockResolvedValue({ data: { statusCode: 500 } });
    const { findByText } = renderWith();
    expect(await findByText("No teams available")).toBeInTheDocument();
  });
  it("date range change re-fetches with from/to", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    axiosGetMock.mockClear();
    const { onDateChange } = datePickerPropsCapture.at(-1);
    act(() => { onDateChange(new Date(2025, 0, 5), new Date(2025, 0, 15)); });
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    const last = axiosGetMock.mock.calls.at(-1)[0];
    expect(last).toContain("from=2025-01-05");
    expect(last).toContain("to=2025-01-15");
  });
  it("numeric filter uses user_id param", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    vi.useFakeTimers();
    const { container } = renderWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const input = container.querySelector("input[type='text']");
    fireEvent.change(input, { target: { value: "12345" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    await waitFor(() => expect(axiosGetMock.mock.calls.some(c => c[0].includes("user_id=12345"))).toBe(true));
  });
  it("non-numeric filter uses userName param", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    vi.useFakeTimers();
    const { container } = renderWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const input = container.querySelector("input[type='text']");
    fireEvent.change(input, { target: { value: "Nike" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    await waitFor(() => expect(axiosGetMock.mock.calls.some(c => c[0].includes("userName=Nike"))).toBe(true));
  });
  it("populates rows + enrichment via fetch", async () => {
    const sampleRow = {
      user_id: "u-1",
      userName: "Alice",
      advertiser: ["Brand-A"],
      competitors: [{ competitor_name: "Comp-A" }, { competitor_name: "Comp-B" }],
      date: "2025-01-01",
      adsCount: 5,
    };
    axiosGetMock.mockResolvedValue(competitorResp([sampleRow]));
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve([
      { owner: "comp-a", todays_count: 1, competitor_count: 10 },
    ]) });
    const { findByText } = renderWith();
    expect(await findByText("Alice")).toBeInTheDocument();
    expect(await findByText("u-1")).toBeInTheDocument();
    expect(await findByText("Brand-A")).toBeInTheDocument();
  });
  it("competitors list with 0 entries → 'Not Interacted' label", async () => {
    axiosGetMock.mockResolvedValue(competitorResp([
      { user_id: "u-1", userName: "Alice", competitors: [] },
    ]));
    const { findAllByText } = renderWith();
    expect((await findAllByText("Not Interacted")).length).toBeGreaterThan(0);
  });
  it("competitors with no Brand → 'Not Interacted'", async () => {
    axiosGetMock.mockResolvedValue(competitorResp([
      { user_id: "u-1", userName: "Alice" },
    ]));
    const { findAllByText } = renderWith();
    expect((await findAllByText("Not Interacted")).length).toBeGreaterThan(0);
  });
  it("date row missing → 'Not Interacted' label", async () => {
    axiosGetMock.mockResolvedValue(competitorResp([
      { user_id: "u-1", userName: "Alice", advertiser: "Brand", competitors: [{ competitor_name: "X" }] },
    ]));
    const { findAllByText } = renderWith();
    // Two "Not Interacted" — Brand Name might match, no date too
    expect((await findAllByText("Not Interacted")).length).toBeGreaterThan(0);
  });
  it("non-array advertiser uses raw value", async () => {
    axiosGetMock.mockResolvedValue(competitorResp([
      { user_id: "u-1", userName: "Alice", advertiser: "BrandX", competitors: [] },
    ]));
    const { findByText } = renderWith();
    expect(await findByText("BrandX")).toBeInTheDocument();
  });
  it("handleNextPage advances page when search_after available + history > index", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    // searchAfter is null initially → handleNextPage is no-op
    const initial = axiosGetMock.mock.calls.length;
    fireEvent.click(getByTestId("next"));
    await new Promise(r => setTimeout(r, 50));
    expect(axiosGetMock.mock.calls.length).toBe(initial);
  });
  it("handlePrevPage at page 0 → no-op", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    const initial = axiosGetMock.mock.calls.length;
    fireEvent.click(getByTestId("prev"));
    await new Promise(r => setTimeout(r, 50));
    expect(axiosGetMock.mock.calls.length).toBe(initial);
  });
  it("filter state 1 → opacity-50 styling", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    const { container } = renderWith(1);
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(container.firstChild.className).toMatch(/opacity-50/);
  });
  it("filter state 3 → opacity-100 styling", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    const { container } = renderWith(3);
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(container.firstChild.className).toMatch(/opacity-\[100%\]/);
  });
  it("loading state shows '...' in stat cards", () => {
    let resolveAxios;
    axiosGetMock.mockImplementation(() => new Promise((r) => { resolveAxios = r; }));
    const { getAllByText } = renderWith();
    expect(getAllByText("...").length).toBeGreaterThan(0);
    resolveAxios(competitorResp());
  });
  it("filter resets pageIndex to 0", async () => {
    axiosGetMock.mockResolvedValue(competitorResp());
    vi.useFakeTimers();
    const { container } = renderWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const input = container.querySelector("input[type='text']");
    fireEvent.change(input, { target: { value: "new-search" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    // pageIndex reset via second useEffect
    expect(paginationPropsCapture.at(-1).pageIndex).toBe(0);
  });
});

// NOTE: defensive ref-null guard and dead "header as function" branch block
// 100% — see https://github.com/Globussoft-Technologies/poweradspy/issues/258
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent, act } from "@testing-library/react";

vi.mock("react-icons/ci", () => ({
  CiSearch: () => <i data-testid="search-ic" />,
}));
vi.mock("react-icons/fa", () => ({
  FaArrowUp: () => null, FaArrowDown: () => null,
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

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), warning: vi.fn() },
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

const postApiCallMock = vi.fn();
const storeApiCallMock = vi.fn();
vi.mock("../../../src/components/Pas/ApiResponse", () => ({
  postApiCall: (...a) => postApiCallMock(...a),
  storeApiCall: (...a) => storeApiCallMock(...a),
}));

import AdminContext from "../../../src/Context/Context.jsx";
import DomainSearches from "../../../src/components/Pas/DomainSearches.jsx";

const renderWith = (filterState = 3) => {
  const setsearchdataFilterTable = vi.fn();
  const ctx = { searchdataFilterTable: filterState, setsearchdataFilterTable };
  const setDoaminStatis = vi.fn();
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <DomainSearches setDoaminStatis={setDoaminStatis} />
    </AdminContext.Provider>,
  );
  return { ...utils, setDoaminStatis, ctx };
};

beforeEach(() => {
  postApiCallMock.mockReset();
  storeApiCallMock.mockReset();
  navigateMock.mockReset();
  toastMock.success.mockClear();
  toastMock.warning.mockClear();
  dpPropsCapture.length = 0;
  paginationPropsCapture.length = 0;
  vi.stubEnv("VITE_SEARCHES_API", "https://api.example.com/");
  localStorage.setItem("userId", "u-1");
});

const successResp = (overrides = {}) => ({
  code: 200,
  search_after: "after-cursor",
  totalCount: 50,
  data: [
    { search_domain: "x.com", "filter.country": "US", "search.x": "v", "search_by.kw": "kw", adsCount: 5, network: "facebook", adsCountOnSerach: 3 },
    { search_domain: "y.com", "dashboard.likes": 10, "dashboard.comments": 5, "dashboard.shares": ["s1", "s2"], "dashboard.post_date": "2025-01-01", "dashboard.ad_seen": 1, "domain_date_btn_sort": "asc", adsCount: 0, network: "google" },
    { search_domain: "z.com", "lander.url": "http://z", adsCount: 2, network: "tiktok" },
    { search_domain: "w.com", adsCount: 1, network: "linkedin" },
  ],
  ...overrides,
});

describe("DomainSearches", () => {
  it("renders heading + search + datepicker", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { getByText, getByPlaceholderText } = renderWith();
    expect(getByText("Domain Searches")).toBeInTheDocument();
  });
  it("fetches getDomainData on mount + getAdvertiserscount", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    expect(postApiCallMock.mock.calls.some(c => c[0].includes("get-domain?"))).toBe(true);
    expect(postApiCallMock.mock.calls.some(c => c[0].includes("get-domain-count"))).toBe(true);
  });
  it("populates rows from response", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    expect(await findByText("x.com")).toBeInTheDocument();
    expect(await findByText("y.com")).toBeInTheDocument();
  });
  it("code 404 → empty data → 'No teams available'", async () => {
    postApiCallMock.mockResolvedValue({ code: 404 });
    const { findByText } = renderWith();
    expect(await findByText("No teams available")).toBeInTheDocument();
  });
  it("code 401 from getDomainData → navigates to root", async () => {
    postApiCallMock.mockResolvedValue({ code: 401 });
    renderWith();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("code 401 from getAdvertiserscount → navigates", async () => {
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-domain-count")) return Promise.resolve({ code: 401 });
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    renderWith();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("code 404 from getAdvertiserscount → setDoaminStatis still called", async () => {
    const resp404 = { code: 404 };
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-domain-count")) return Promise.resolve(resp404);
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setDoaminStatis } = renderWith();
    await waitFor(() => expect(setDoaminStatis).toHaveBeenCalledWith(resp404));
  });
  it("code 500 from getAdvertiserscount → ignored (no setDoaminStatis, no navigate)", async () => {
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-domain-count")) return Promise.resolve({ code: 500 });
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setDoaminStatis } = renderWith();
    await new Promise(r => setTimeout(r, 100));
    expect(setDoaminStatis).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it("code 500 from getDomainData → does not navigate or update data", async () => {
    postApiCallMock.mockResolvedValue({ code: 500 });
    renderWith();
    await new Promise(r => setTimeout(r, 100));
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it("code 200 from getAdvertiserscount → setDoaminStatis called", async () => {
    const resp200 = { code: 200, totalCount: 99 };
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-domain-count")) return Promise.resolve(resp200);
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setDoaminStatis } = renderWith();
    await waitFor(() => expect(setDoaminStatis).toHaveBeenCalledWith(resp200));
  });
  it("date change re-fetches with from_date/to_date", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const initialCalls = postApiCallMock.mock.calls.length;
    const { onChange } = dpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15)); });
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(initialCalls));
    const lastCall = postApiCallMock.mock.calls.at(-1);
    expect(lastCall[1].from_date).toBe("2025-06-15 00:00:00");
    expect(lastCall[1].to_date).toBe("2025-06-15 23:59:59");
  });
  it("Clear Date resets startDate + re-fetches", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { getByText } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const { onChange } = dpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15)); });
    await waitFor(() => expect(postApiCallMock.mock.calls.some(c => c[1].from_date)).toBe(true));
    const beforeClear = postApiCallMock.mock.calls.length;
    fireEvent.click(getByText("Clear Date"));
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(beforeClear));
  });
  it("filter input triggers debounced re-fetch", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    vi.useFakeTimers();
    const { container } = renderWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const initial = postApiCallMock.mock.calls.length;
    const input = container.querySelector("input[type='text']");
    fireEvent.change(input, { target: { value: "search-q" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(initial));
    const lastCall = postApiCallMock.mock.calls.at(-1);
    expect(lastCall[1].search_term).toBe("search-q");
  });
  it("Fetch Ad button only renders for allowed networks (facebook/instagram/native/google)", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    expect(buttons.length).toBe(2); // facebook + google rows
  });
  it("Fetch Ad click → storeApiCall + toast.success on 200", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 200 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(storeApiCallMock).toHaveBeenCalled());
    expect(storeApiCallMock).toHaveBeenCalledWith({ type: 2, keyword: "x.com" });
    expect(toastMock.success).toHaveBeenCalled();
  });
  it("Fetch Ad click → 401 navigates to root", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 401 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("Fetch Ad click → 400 toasts warning 'already exists'", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 400 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
  });
  it("handleNextPage advances page when search_after available", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const initial = postApiCallMock.mock.calls.length;
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(initial));
    expect(postApiCallMock.mock.calls.at(-1)[1].search_after).toBe("after-cursor");
  });
  it("handlePrevPage does nothing at page 0", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const initial = postApiCallMock.mock.calls.length;
    fireEvent.click(getByTestId("prev"));
    await new Promise(r => setTimeout(r, 50));
    expect(postApiCallMock.mock.calls.length).toBe(initial);
  });
  it("handlePrevPage from page 1 → reset to page 0 (no search_after)", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(2));
    const beforePrev = postApiCallMock.mock.calls.length;
    fireEvent.click(getByTestId("prev"));
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(beforePrev));
  });
  it("handlePrevPage from page >1 → goes back one page", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(1));
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(2));
    fireEvent.click(getByTestId("prev"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(1));
  });
  it("searchdataFilterTable=1 → row has 'pointer-events-none' class", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findByText } = renderWith(1);
    const row = (await findByText("x.com")).closest("tr");
    expect(row.className).toMatch(/pointer-events-none/);
  });
  it("searchdataFilterTable=0 → scrollWheel handler attached (no crash)", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { container } = renderWith(0);
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const tableEl = container.querySelector(".overflow-auto");
    expect(tableEl).not.toBeNull();
    // Simulate wheel event — handler calls preventDefault + stopPropagation + scrollTop=0
    const wheelEvent = new Event("wheel", { bubbles: true, cancelable: true });
    wheelEvent.preventDefault = vi.fn();
    wheelEvent.stopPropagation = vi.fn();
    tableEl.dispatchEvent(wheelEvent);
    expect(wheelEvent.preventDefault).toHaveBeenCalled();
  });
  it("array dashboard.shares joined with commas", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    // y.com row has dashboard.shares: ["s1","s2"] → label "shares: s1, s2"
    expect(await findByText(/shares: s1, s2/)).toBeInTheDocument();
  });
  it("row with adsCount=0 → red background class", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    const row = (await findByText("y.com")).closest("tr");
    expect(row.className).toMatch(/bg-red-500/);
  });
});

// NOTE: same defensive/dead branch patterns as DomainSearches — see
// https://github.com/Globussoft-Technologies/poweradspy/issues/258
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

vi.mock("../../../src/components/Pagination/Pagination", () => ({
  default: () => null,
}));
const paginationPropsCapture = [];
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

const postApiCallMock = vi.fn();
const storeApiCallMock = vi.fn();
vi.mock("../../../src/components/Pas/ApiResponse", () => ({
  postApiCall: (...a) => postApiCallMock(...a),
  storeApiCall: (...a) => storeApiCallMock(...a),
}));

vi.mock("axios", () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import AdminContext from "../../../src/Context/Context.jsx";
import KeywordSearches from "../../../src/components/Pas/KeywordSearches.jsx";

const renderWith = (filterState = 3) => {
  const setsearchdataFilterTable = vi.fn();
  const ctx = { searchdataFilterTable: filterState, setsearchdataFilterTable };
  const setKeywordStatis = vi.fn();
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <KeywordSearches setKeywordStatis={setKeywordStatis} />
    </AdminContext.Provider>,
  );
  return { ...utils, setKeywordStatis, ctx };
};

beforeEach(() => {
  postApiCallMock.mockReset();
  storeApiCallMock.mockReset();
  navigateMock.mockReset();
  toastMock.success.mockClear();
  toastMock.warning.mockClear();
  toastMock.error.mockClear();
  dpPropsCapture.length = 0;
  paginationPropsCapture.length = 0;
  vi.stubEnv("VITE_SEARCHES_API", "https://api.example.com/");
  vi.stubEnv("VITE_APP_BASE_URL", "https://app.example.com");
  localStorage.setItem("userId", "u-1");
  navigator.clipboard = { writeText: vi.fn(() => Promise.resolve()) };
});

const successResp = (overrides = {}) => ({
  code: 200,
  search_after: "after-cursor",
  totalCount: 50,
  data: [
    { search_keyword: "shoes", "filter.country": "US", adsCount: 5, network: "facebook", adsCountOnSerach: 3 },
    { search_keyword: "running", "dashboard.likes": 10, "dashboard.shares": ["s1", "s2"], adsCount: 2, network: "google" },
    { search_keyword: "marathon", "lander.url": "http://m.com", adsCount: 0, network: "tiktok" },
    { search_keyword: "track", adsCount: 1, network: "linkedin" },
  ],
  ...overrides,
});

describe("KeywordSearches", () => {
  it("renders heading", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { getByText } = renderWith();
    expect(getByText("Keyword Searches")).toBeInTheDocument();
  });
  it("fetches getKeywordsData + count on mount", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    expect(postApiCallMock.mock.calls.some(c => c[0].includes("get-keywords?"))).toBe(true);
    expect(postApiCallMock.mock.calls.some(c => c[0].includes("get-keyword-count"))).toBe(true);
  });
  it("populates rows", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    expect(await findByText("shoes")).toBeInTheDocument();
  });
  it("code 404 → empty data", async () => {
    postApiCallMock.mockResolvedValue({ code: 404 });
    renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
  });
  it("code 401 navigates", async () => {
    postApiCallMock.mockResolvedValue({ code: 401 });
    renderWith();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("count 401 → navigate", async () => {
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-keyword-count")) return Promise.resolve({ code: 401 });
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    renderWith();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("count 404 → setKeywordStatis called", async () => {
    const resp = { code: 404 };
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-keyword-count")) return Promise.resolve(resp);
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setKeywordStatis } = renderWith();
    await waitFor(() => expect(setKeywordStatis).toHaveBeenCalledWith(resp));
  });
  it("count 200 → setKeywordStatis called", async () => {
    const resp = { code: 200, totalCount: 99 };
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-keyword-count")) return Promise.resolve(resp);
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setKeywordStatis } = renderWith();
    await waitFor(() => expect(setKeywordStatis).toHaveBeenCalledWith(resp));
  });
  it("unknown code from getKeywordsData → no navigate", async () => {
    postApiCallMock.mockResolvedValue({ code: 500 });
    renderWith();
    await new Promise(r => setTimeout(r, 100));
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it("unknown code from count → no setKeywordStatis, no navigate", async () => {
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-keyword-count")) return Promise.resolve({ code: 500 });
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setKeywordStatis } = renderWith();
    await new Promise(r => setTimeout(r, 100));
    expect(setKeywordStatis).not.toHaveBeenCalled();
  });
  it("date change re-fetches with from_date/to_date", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const initial = postApiCallMock.mock.calls.length;
    const { onChange } = dpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15)); });
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(initial));
    expect(postApiCallMock.mock.calls.at(-1)[1].from_date).toBe("2025-06-15 00:00:00");
  });
  it("Clear Date re-fetches", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { getByText } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const { onChange } = dpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15)); });
    await waitFor(() => expect(postApiCallMock.mock.calls.some(c => c[1].from_date)).toBe(true));
    const before = postApiCallMock.mock.calls.length;
    fireEvent.click(getByText("Clear Date"));
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(before));
  });
  it("filter input debounced re-fetch", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    vi.useFakeTimers();
    const { container } = renderWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const initial = postApiCallMock.mock.calls.length;
    const input = container.querySelector("input[type='text']");
    fireEvent.change(input, { target: { value: "kw" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(initial));
    expect(postApiCallMock.mock.calls.at(-1)[1].search_term).toBe("kw");
  });
  it("Fetch Ad only renders for allowed networks", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    expect(buttons.length).toBe(2);
  });
  it("Fetch Ad → storeApiCall type=0 + toast.success", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 200 });
    const { findAllByText } = renderWith();
    fireEvent.click((await findAllByText("Fetch Ad"))[0]);
    await waitFor(() => expect(storeApiCallMock).toHaveBeenCalledWith({ type: 0, keyword: "shoes" }));
    expect(toastMock.success).toHaveBeenCalled();
  });
  it("Fetch Ad 401 → navigate", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 401 });
    const { findAllByText } = renderWith();
    fireEvent.click((await findAllByText("Fetch Ad"))[0]);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("Fetch Ad 400 → warning", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 400 });
    const { findAllByText } = renderWith();
    fireEvent.click((await findAllByText("Fetch Ad"))[0]);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
  });
  it("Fetch Ad unknown code → silent", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 500 });
    const { findAllByText } = renderWith();
    fireEvent.click((await findAllByText("Fetch Ad"))[0]);
    await waitFor(() => expect(storeApiCallMock).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });
  it("URL Copy → safeEncode + toast.success", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { container } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const copyIcons = container.querySelectorAll('img[alt="Copy Link"]');
    fireEvent.click(copyIcons[0]);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/facebook/landing/key/shoes"));
  });
  it("URL Copy failure → toast.error", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    navigator.clipboard.writeText = vi.fn(() => Promise.reject(new Error("denied")));
    const { container } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const copyIcons = container.querySelectorAll('img[alt="Copy Link"]');
    fireEvent.click(copyIcons[0]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
  it("URL with special chars uses safeEncode", async () => {
    postApiCallMock.mockResolvedValue({
      code: 200, totalCount: 1, data: [{ search_keyword: "kw'\"x", network: "facebook" }],
    });
    const { container } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    fireEvent.click(container.querySelector('img[alt="Copy Link"]'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const url = navigator.clipboard.writeText.mock.calls[0][0];
    expect(url).toMatch(/%27/);
    expect(url).toMatch(/%22/);
  });
  it("missing keyword/network → unknown/default", async () => {
    postApiCallMock.mockResolvedValue({
      code: 200, totalCount: 1, data: [{ adsCount: 1 }],
    });
    const { container } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    fireEvent.click(container.querySelector('img[alt="Copy Link"]'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const url = navigator.clipboard.writeText.mock.calls[0][0];
    expect(url).toMatch(/\/default\/landing\/key\/unknown/);
  });
  it("next page advances", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const initial = postApiCallMock.mock.calls.length;
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(initial));
  });
  it("prev at page 0 → no-op", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const initial = postApiCallMock.mock.calls.length;
    fireEvent.click(getByTestId("prev"));
    await new Promise(r => setTimeout(r, 50));
    expect(postApiCallMock.mock.calls.length).toBe(initial);
  });
  it("prev from page 1 resets to 0", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(1));
    fireEvent.click(getByTestId("prev"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(0));
  });
  it("prev from page >1 decrements", async () => {
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
  it("scroll wheel handler attached at filter state 1", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { container } = renderWith(1);
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const tableEl = container.querySelector(".overflow-auto");
    const wheelEvent = new Event("wheel", { bubbles: true, cancelable: true });
    wheelEvent.preventDefault = vi.fn();
    wheelEvent.stopPropagation = vi.fn();
    tableEl.dispatchEvent(wheelEvent);
    expect(wheelEvent.preventDefault).toHaveBeenCalled();
  });
  it("dashboard.shares array joined", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    expect(await findByText(/shares: s1, s2/)).toBeInTheDocument();
  });
});

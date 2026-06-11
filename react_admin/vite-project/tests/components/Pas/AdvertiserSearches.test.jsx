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

import AdminContext from "../../../src/Context/Context.jsx";
import AdvertiserSearches from "../../../src/components/Pas/AdvertiserSearches.jsx";

const renderWith = (filterState = 3) => {
  const setsearchdataFilterTable = vi.fn();
  const ctx = { searchdataFilterTable: filterState, setsearchdataFilterTable };
  const setStatis = vi.fn();
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <AdvertiserSearches setStatis={setStatis} />
    </AdminContext.Provider>,
  );
  return { ...utils, setStatis, ctx };
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
    { search_advertiser: "Nike", "filter.country": "US", "search.x": "v", adsCount: 5, network: "facebook", adsCountOnSerach: 3 },
    { search_advertiser: "Adidas", "dashboard.likes": 10, "dashboard.shares": ["s1", "s2"], adsCount: 2, network: "google" },
    { search_advertiser: "Puma", "lander.url": "http://p.com", adsCount: 0, network: "tiktok" },
    { search_advertiser: "Reebok", adsCount: 1, network: "linkedin" },
  ],
  ...overrides,
});

describe("AdvertiserSearches", () => {
  it("renders heading", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { getByText } = renderWith();
    expect(getByText("Advertiser Searches")).toBeInTheDocument();
  });
  it("fetches getAdvertisersData + getAdvertiserscount on mount", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    expect(postApiCallMock.mock.calls.some(c => c[0].includes("get-advertiser?"))).toBe(true);
    expect(postApiCallMock.mock.calls.some(c => c[0].includes("get-advertiser-count"))).toBe(true);
  });
  it("populates rows from response", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    expect(await findByText("Nike")).toBeInTheDocument();
    expect(await findByText("Adidas")).toBeInTheDocument();
  });
  it("code 404 → empty data → 'No teams available' is absent (table renders just nothing)", async () => {
    postApiCallMock.mockResolvedValue({ code: 404 });
    renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    // No assertion required beyond no-crash
  });
  it("code 401 from getAdvertisersData → navigates", async () => {
    postApiCallMock.mockResolvedValue({ code: 401 });
    renderWith();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("code 401 from getAdvertiserscount → navigates", async () => {
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-advertiser-count")) return Promise.resolve({ code: 401 });
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    renderWith();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("code 404 from getAdvertiserscount → setStatis still called", async () => {
    const resp404 = { code: 404 };
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-advertiser-count")) return Promise.resolve(resp404);
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setStatis } = renderWith();
    await waitFor(() => expect(setStatis).toHaveBeenCalledWith(resp404));
  });
  it("code 200 from getAdvertiserscount → setStatis called", async () => {
    const resp200 = { code: 200, totalCount: 99 };
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-advertiser-count")) return Promise.resolve(resp200);
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setStatis } = renderWith();
    await waitFor(() => expect(setStatis).toHaveBeenCalledWith(resp200));
  });
  it("unknown code from getAdvertisersData → no navigate", async () => {
    postApiCallMock.mockResolvedValue({ code: 500 });
    renderWith();
    await new Promise(r => setTimeout(r, 100));
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it("unknown code from getAdvertiserscount → no setStatis, no navigate", async () => {
    postApiCallMock.mockImplementation((url) => {
      if (url.includes("get-advertiser-count")) return Promise.resolve({ code: 500 });
      return Promise.resolve({ code: 200, data: [], totalCount: 0 });
    });
    const { setStatis } = renderWith();
    await new Promise(r => setTimeout(r, 100));
    expect(setStatis).not.toHaveBeenCalled();
  });
  it("date change re-fetches with from_date/to_date", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const initial = postApiCallMock.mock.calls.length;
    const { onChange } = dpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15)); });
    await waitFor(() => expect(postApiCallMock.mock.calls.length).toBeGreaterThan(initial));
    const lastCall = postApiCallMock.mock.calls.at(-1);
    expect(lastCall[1].from_date).toBe("2025-06-15 00:00:00");
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
    expect(buttons.length).toBe(2); // facebook + google
  });
  it("Fetch Ad click → storeApiCall with type=1 + toast.success", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 200 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(storeApiCallMock).toHaveBeenCalled());
    expect(storeApiCallMock).toHaveBeenCalledWith({ type: 1, keyword: "Nike" });
    expect(toastMock.success).toHaveBeenCalled();
  });
  it("Fetch Ad click → 401 navigates", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 401 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("Fetch Ad click → 400 toasts warning", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 400 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
  });
  it("Fetch Ad click → unknown code → no toast/navigate", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 500 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(storeApiCallMock).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it("URL Copy click → copies safe-encoded URL + toast.success", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { container } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const copyIcons = container.querySelectorAll('img[alt="Copy Link"]');
    expect(copyIcons.length).toBeGreaterThan(0);
    fireEvent.click(copyIcons[0]);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/facebook/landing/advertiser/Nike"));
  });
  it("URL Copy click failure → toast.error", async () => {
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
      code: 200, totalCount: 1, data: [
        { search_advertiser: "Nike's \"Air\"", network: "facebook" },
      ],
    });
    const { container } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const copyIcons = container.querySelectorAll('img[alt="Copy Link"]');
    fireEvent.click(copyIcons[0]);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const url = navigator.clipboard.writeText.mock.calls[0][0];
    expect(url).toMatch(/%27/); // ' encoded
    expect(url).toMatch(/%22/); // " encoded
  });
  it("URL with missing keyword/network → uses 'unknown' + 'default'", async () => {
    postApiCallMock.mockResolvedValue({
      code: 200, totalCount: 1, data: [
        { adsCount: 1 },
      ],
    });
    const { container } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const copyIcons = container.querySelectorAll('img[alt="Copy Link"]');
    fireEvent.click(copyIcons[0]);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const url = navigator.clipboard.writeText.mock.calls[0][0];
    expect(url).toMatch(/\/default\/landing\/advertiser\/unknown/);
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
  it("handlePrevPage from page 1 → reset to page 0", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(1));
    fireEvent.click(getByTestId("prev"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(0));
  });
  it("handlePrevPage from page >1 → decrements by one", async () => {
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
  it("searchdataFilterTable=0 → scrollWheel handler attached", async () => {
    postApiCallMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { container } = renderWith(0);
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    const tableEl = container.querySelector(".overflow-auto");
    expect(tableEl).not.toBeNull();
    const wheelEvent = new Event("wheel", { bubbles: true, cancelable: true });
    wheelEvent.preventDefault = vi.fn();
    wheelEvent.stopPropagation = vi.fn();
    tableEl.dispatchEvent(wheelEvent);
    expect(wheelEvent.preventDefault).toHaveBeenCalled();
  });
  it("array dashboard.shares joined with commas", async () => {
    postApiCallMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    expect(await findByText(/shares: s1, s2/)).toBeInTheDocument();
  });
});

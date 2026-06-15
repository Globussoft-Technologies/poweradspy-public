import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent, act } from "@testing-library/react";

vi.mock("react-icons/ci", () => ({
  CiSearch: () => <i data-testid="search-ic" />,
}));
vi.mock("react-icons/fa", () => ({
  FaArrowUp: () => null, FaArrowDown: () => null,
}));

const drpPropsCapture = [];
vi.mock("../../../src/components/Pas/DateRangePickerCustom", () => ({
  default: (props) => {
    drpPropsCapture.push(props);
    return (
      <div data-testid="drp">
        <button data-testid="clear-date" onClick={() => props.onChange(null, null)}>
          Clear Filter
        </button>
      </div>
    );
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

const postApiCallWithBodyMock = vi.fn();
const storeApiCallMock = vi.fn();
vi.mock("../../../src/components/Pas/ApiResponse", () => ({
  postApiCallWithBody: (...a) => postApiCallWithBodyMock(...a),
  storeApiCall: (...a) => storeApiCallMock(...a),
}));

import AdminContext from "../../../src/Context/Context.jsx";
import DomainSearches from "../../../src/components/Pas/DomainSearches.jsx";

const renderWith = (filterState = 3) => {
  const setsearchdataFilterTable = vi.fn();
  const ctx = { searchdataFilterTable: filterState, setsearchdataFilterTable };
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <DomainSearches />
    </AdminContext.Provider>,
  );
  return { ...utils, ctx };
};

beforeEach(() => {
  postApiCallWithBodyMock.mockReset();
  storeApiCallMock.mockReset();
  navigateMock.mockReset();
  toastMock.success.mockClear();
  toastMock.warning.mockClear();
  toastMock.error.mockClear();
  drpPropsCapture.length = 0;
  paginationPropsCapture.length = 0;
  vi.stubEnv("VITE_NODE_USER_ACTIVITY_API", "https://api.example.com/");
  vi.stubEnv("VITE_APP_BASE_URL", "https://app.example.com");
  localStorage.setItem("userId", "u-1");
  navigator.clipboard = { writeText: vi.fn(() => Promise.resolve()) };
});

const successResp = (overrides = {}) => ({
  code: 200,
  search_after: "after-cursor",
  totalCount: 50,
  data: [
    { search_domain: "x.com", "filter.country": "US", "search.x": "v", adsCount: 5, network: "facebook", adsCountOnSerach: 3 },
    { search_domain: "y.com", "dashboard.likes": 10, "dashboard.shares": ["s1", "s2"], adsCount: 2, network: "google" },
    { search_domain: "z.com", "lander.url": "http://z", adsCount: 0, network: "tiktok" },
    { search_domain: "w.com", adsCount: 1, network: "linkedin" },
  ],
  ...overrides,
});

describe("DomainSearches", () => {
  it("renders heading", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { getByText } = renderWith();
    expect(getByText("Domain Searches")).toBeInTheDocument();
  });
  it("fetches get-domain with a body on mount", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    renderWith();
    await waitFor(() => expect(postApiCallWithBodyMock).toHaveBeenCalled());
    expect(postApiCallWithBodyMock.mock.calls.some(c => c[0].includes("get-domain"))).toBe(true);
    const body = postApiCallWithBodyMock.mock.calls.at(-1)[1];
    expect(body.user_id).toBe("u-1");
    expect(body.size).toBeDefined();
  });
  it("populates rows from response", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    expect(await findByText("x.com")).toBeInTheDocument();
    expect(await findByText("y.com")).toBeInTheDocument();
  });
  it("code 404 → empty data (no crash)", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 404 });
    renderWith();
    await waitFor(() => expect(postApiCallWithBodyMock).toHaveBeenCalled());
  });
  it("code 401 from get-domain → navigates", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 401 });
    renderWith();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("unknown code from get-domain → no navigate", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 500 });
    renderWith();
    await new Promise(r => setTimeout(r, 100));
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it("date change re-fetches with from_date/to_date", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    renderWith();
    await waitFor(() => expect(postApiCallWithBodyMock).toHaveBeenCalled());
    const initial = postApiCallWithBodyMock.mock.calls.length;
    const { onChange } = drpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15), new Date(2025, 5, 15)); });
    await waitFor(() => expect(postApiCallWithBodyMock.mock.calls.length).toBeGreaterThan(initial));
    const lastCall = postApiCallWithBodyMock.mock.calls.at(-1);
    expect(lastCall[1].from_date).toBe("2025-06-15 00:00:00");
    expect(lastCall[1].to_date).toBe("2025-06-15 23:59:59");
  });
  it("Clear Filter resets the date range + re-fetches", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { getByText } = renderWith();
    await waitFor(() => expect(postApiCallWithBodyMock).toHaveBeenCalled());
    const { onChange } = drpPropsCapture.at(-1);
    act(() => { onChange(new Date(2025, 5, 15), new Date(2025, 5, 15)); });
    await waitFor(() => expect(postApiCallWithBodyMock.mock.calls.some(c => c[1].from_date)).toBe(true));
    const beforeClear = postApiCallWithBodyMock.mock.calls.length;
    fireEvent.click(getByText("Clear Filter"));
    await waitFor(() => expect(postApiCallWithBodyMock.mock.calls.length).toBeGreaterThan(beforeClear));
  });
  it("filter input triggers debounced re-fetch with search_term", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    vi.useFakeTimers();
    const { container } = renderWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const initial = postApiCallWithBodyMock.mock.calls.length;
    const input = container.querySelector("input[type='text']");
    fireEvent.change(input, { target: { value: "search-q" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    await waitFor(() => expect(postApiCallWithBodyMock.mock.calls.length).toBeGreaterThan(initial));
    const lastCall = postApiCallWithBodyMock.mock.calls.at(-1);
    expect(lastCall[1].search_term).toBe("search-q");
  });
  it("Fetch Ad button only renders for allowed networks (facebook/instagram/native/google)", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    expect(buttons.length).toBe(2); // facebook + google
  });
  it("Fetch Ad click → storeApiCall with type=2 + toast.success", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 200 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(storeApiCallMock).toHaveBeenCalled());
    expect(storeApiCallMock).toHaveBeenCalledWith({ type: 2, keyword: "x.com" });
    expect(toastMock.success).toHaveBeenCalled();
  });
  it("Fetch Ad click → 401 navigates", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 401 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("Fetch Ad click → 400 toasts warning", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    storeApiCallMock.mockResolvedValue({ code: 400 });
    const { findAllByText } = renderWith();
    const buttons = await findAllByText("Fetch Ad");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
  });
  it("handleNextPage advances page when search_after available", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallWithBodyMock).toHaveBeenCalled());
    const initial = postApiCallWithBodyMock.mock.calls.length;
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(postApiCallWithBodyMock.mock.calls.length).toBeGreaterThan(initial));
    expect(postApiCallWithBodyMock.mock.calls.at(-1)[1].search_after).toBe("after-cursor");
  });
  it("handlePrevPage does nothing at page 0", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallWithBodyMock).toHaveBeenCalled());
    const initial = postApiCallWithBodyMock.mock.calls.length;
    fireEvent.click(getByTestId("prev"));
    await new Promise(r => setTimeout(r, 50));
    expect(postApiCallWithBodyMock.mock.calls.length).toBe(initial);
  });
  it("handlePrevPage from page 1 → reset to page 0", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    const { getByTestId } = renderWith();
    await waitFor(() => expect(postApiCallWithBodyMock).toHaveBeenCalled());
    fireEvent.click(getByTestId("next"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(1));
    fireEvent.click(getByTestId("prev"));
    await waitFor(() => expect(paginationPropsCapture.at(-1).pageIndex).toBe(0));
  });
  it("searchdataFilterTable=0 → scrollWheel handler attached", async () => {
    postApiCallWithBodyMock.mockResolvedValue({ code: 200, data: [], totalCount: 0 });
    const { container } = renderWith(0);
    await waitFor(() => expect(postApiCallWithBodyMock).toHaveBeenCalled());
    const tableEl = container.querySelector(".overflow-auto");
    expect(tableEl).not.toBeNull();
    const wheelEvent = new Event("wheel", { bubbles: true, cancelable: true });
    wheelEvent.preventDefault = vi.fn();
    wheelEvent.stopPropagation = vi.fn();
    tableEl.dispatchEvent(wheelEvent);
    expect(wheelEvent.preventDefault).toHaveBeenCalled();
  });
  it("array dashboard.shares joined with commas", async () => {
    postApiCallWithBodyMock.mockResolvedValue(successResp());
    const { findByText } = renderWith();
    expect(await findByText(/shares: s1, s2/)).toBeInTheDocument();
  });
});

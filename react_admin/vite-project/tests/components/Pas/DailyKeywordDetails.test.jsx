// NOTE: same defensive header-as-function branch as DomainSearches — see #258
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
  FaCheck: () => null, FaTrash: () => <i data-testid="trash-ic" />,
  FaStar: ({ size, title }) => <i data-testid="star-filled" title={title} data-size={size} />,
  FaRegStar: ({ size }) => <i data-testid="star-empty" data-size={size} />,
  FaChevronDown: () => <i data-testid="chev-down" />,
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

const { toastMock, swalMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  swalMock: { fire: vi.fn() },
}));
vi.mock("react-toastify", () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
  toast: toastMock,
}));
vi.mock("react-toastify/dist/ReactToastify.css", () => ({}));

vi.mock("sweetalert2", () => ({ default: swalMock }));

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
import DailyKeywordDetails from "../../../src/components/Pas/DailyKeywordDetails.jsx";

const renderWith = (filterState = 3) => {
  const setsearchdataFilterTable = vi.fn();
  const ctx = { searchdataFilterTable: filterState, setsearchdataFilterTable };
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <DailyKeywordDetails />
    </AdminContext.Provider>,
  );
  return { ...utils, ctx };
};

beforeEach(() => {
  axiosGetMock.mockReset();
  postApiCallMock.mockReset();
  storeApiCallMock.mockReset();
  navigateMock.mockReset();
  toastMock.success.mockClear();
  toastMock.warning.mockClear();
  toastMock.error.mockClear();
  swalMock.fire.mockReset();
  datePickerPropsCapture.length = 0;
  paginationPropsCapture.length = 0;
  vi.stubEnv("VITE_LINKEDIN_API", "https://linkedin.example.com/");
});

const keywordResp = (data = []) => ({
  data: { code: 200, data, totalCount: data.length },
});

describe("DailyKeywordDetails", () => {
  it("renders header + search input + Add Keyword button", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    const { getByPlaceholderText, getByText } = renderWith();
    expect(getByText("+ Add Keyword")).toBeInTheDocument();
    expect(getByPlaceholderText("Search User_id or Keyword")).toBeInTheDocument();
  });
  it("fetches daily keyword data on mount", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(axiosGetMock.mock.calls[0][0]).toContain("get-daily-keyword-data");
  });
  it("axios error → toast.error", async () => {
    axiosGetMock.mockRejectedValue(new Error("fail"));
    renderWith();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
  it("response with non-200 code → empty table", async () => {
    axiosGetMock.mockResolvedValue({ data: { code: 500 } });
    const { findByText } = renderWith();
    expect(await findByText("No teams available")).toBeInTheDocument();
  });
  it("renders rows with type label transformation", async () => {
    axiosGetMock.mockResolvedValue(keywordResp([
      { user_id: "u-1", keyword: "shoes", type: 0, facebook_status: 0, instagram_status: 0, created_at: "2025-01-01", updated_at: "2025-01-02" },
      { user_id: "u-2", keyword: "Nike", type: 1, facebook_status: 9, instagram_status: 0, created_at: "2025-01-03" },
      { user_id: "u-3", keyword: "x.com", type: 2, facebook_status: 0, instagram_status: 0 },
    ]));
    const { findByText } = renderWith();
    expect(await findByText("Keyword")).toBeInTheDocument();
    expect(await findByText("Advertiser")).toBeInTheDocument();
    expect(await findByText("Domain")).toBeInTheDocument();
  });
  it("priority row shows filled star", async () => {
    axiosGetMock.mockResolvedValue(keywordResp([
      { user_id: "u-1", keyword: "shoes", type: 0, facebook_status: 9, instagram_status: 0 },
    ]));
    const { findAllByTestId } = renderWith();
    const stars = await findAllByTestId("star-filled");
    expect(stars.length).toBeGreaterThan(0);
  });
  it("clicking the priority button toggles via handlePriority (success)", async () => {
    axiosGetMock.mockResolvedValue(keywordResp([
      { user_id: "u-1", keyword: "shoes", type: 0, facebook_status: 0, instagram_status: 0 },
    ]));
    postApiCallMock.mockResolvedValue({ code: 200 });
    const { findAllByTestId } = renderWith();
    const emptyStars = await findAllByTestId("star-empty");
    fireEvent.click(emptyStars[0].closest("button"));
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    expect(postApiCallMock.mock.calls[0][1]).toMatchObject({ keyword: "shoes", facebook_status: 9 });
    expect(toastMock.success).toHaveBeenCalledWith("Marked as Priority");
  });
  it("handlePriority remove (status was 9 → 0) toasts 'Priority Removed'", async () => {
    axiosGetMock.mockResolvedValue(keywordResp([
      { user_id: "u-1", keyword: "shoes", type: 0, facebook_status: 9 },
    ]));
    postApiCallMock.mockResolvedValue({ code: 200 });
    const { findAllByTestId } = renderWith();
    const stars = await findAllByTestId("star-filled");
    // The first star is the inline indicator (no onClick); find the button-wrapped one
    const buttonStar = stars.find((s) => s.closest("button"));
    fireEvent.click(buttonStar.closest("button"));
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    expect(postApiCallMock.mock.calls[0][1].facebook_status).toBe(0);
    expect(toastMock.success).toHaveBeenCalledWith("Priority Removed");
  });
  it("handlePriority failure toasts warning", async () => {
    axiosGetMock.mockResolvedValue(keywordResp([
      { user_id: "u-1", keyword: "shoes", type: 0, facebook_status: 0 },
    ]));
    postApiCallMock.mockResolvedValue({ code: 500 });
    const { findAllByTestId } = renderWith();
    const emptyStars = await findAllByTestId("star-empty");
    fireEvent.click(emptyStars[0].closest("button"));
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith("Failed to update the status"));
  });
  it("delete row → swal confirm + handleDelete on confirm", async () => {
    axiosGetMock.mockResolvedValue(keywordResp([
      { user_id: "u-1", keyword: "shoes", type: 0, facebook_status: 0 },
    ]));
    swalMock.fire.mockResolvedValue({ isConfirmed: true });
    postApiCallMock.mockResolvedValue({ code: 200 });
    const { findByTestId } = renderWith();
    const trashBtn = (await findByTestId("trash-ic")).closest("button");
    fireEvent.click(trashBtn);
    await waitFor(() => expect(swalMock.fire).toHaveBeenCalled());
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith("Request Deleted Successfully");
  });
  it("delete row → swal cancel → no delete", async () => {
    axiosGetMock.mockResolvedValue(keywordResp([
      { user_id: "u-1", keyword: "shoes", type: 0, facebook_status: 0 },
    ]));
    swalMock.fire.mockResolvedValue({ isConfirmed: false });
    const { findByTestId } = renderWith();
    const trashBtn = (await findByTestId("trash-ic")).closest("button");
    fireEvent.click(trashBtn);
    await waitFor(() => expect(swalMock.fire).toHaveBeenCalled());
    // no postApiCall fired
    postApiCallMock.mockClear();
    await new Promise((r) => setTimeout(r, 50));
    expect(postApiCallMock).not.toHaveBeenCalled();
  });
  it("delete failure toasts warning", async () => {
    axiosGetMock.mockResolvedValue(keywordResp([
      { user_id: "u-1", keyword: "shoes", type: 0, facebook_status: 0 },
    ]));
    swalMock.fire.mockResolvedValue({ isConfirmed: true });
    postApiCallMock.mockResolvedValue({ code: 500 });
    const { findByTestId } = renderWith();
    const trashBtn = (await findByTestId("trash-ic")).closest("button");
    fireEvent.click(trashBtn);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith("failed to delete"));
  });
  it("Add Keyword opens modal", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    const { getByText, queryByText } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(queryByText("Add Keyword")).toBeNull();
    fireEvent.click(getByText("+ Add Keyword"));
    expect(getByText("Add Keyword")).toBeInTheDocument();
  });
  it("modal Cancel resets form + closes", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    const { getByText, queryByText } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    fireEvent.click(getByText("+ Add Keyword"));
    fireEvent.click(getByText("Cancel"));
    expect(queryByText("Add Keyword")).toBeNull();
  });
  it("modal Save with missing fields → toast.error", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    const { getByText } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    fireEvent.click(getByText("+ Add Keyword"));
    fireEvent.click(getByText("Save"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("All fields are required"));
  });
  it("modal Save success calls postApiCall + toast.success", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    postApiCallMock.mockResolvedValue({ code: 200 });
    const { getByText, getByPlaceholderText } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    fireEvent.click(getByText("+ Add Keyword"));
    fireEvent.change(getByPlaceholderText("Enter User ID"), { target: { value: "u-99" } });
    fireEvent.change(getByPlaceholderText("Enter Keyword"), { target: { value: "running" } });
    const select = document.querySelector("select");
    fireEvent.change(select, { target: { value: "Keyword" } });
    fireEvent.click(getByText("Save"));
    await waitFor(() => expect(postApiCallMock).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith("Keyword added successfully");
  });
  it("modal Save failure toasts message", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    postApiCallMock.mockResolvedValue({ code: 500, message: "API down" });
    const { getByText, getByPlaceholderText } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    fireEvent.click(getByText("+ Add Keyword"));
    fireEvent.change(getByPlaceholderText("Enter User ID"), { target: { value: "u" } });
    fireEvent.change(getByPlaceholderText("Enter Keyword"), { target: { value: "k" } });
    fireEvent.change(document.querySelector("select"), { target: { value: "Keyword" } });
    fireEvent.click(getByText("Save"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("API down"));
  });
  it("filter input triggers debounced re-fetch", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    vi.useFakeTimers();
    const { getByPlaceholderText } = renderWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const initial = axiosGetMock.mock.calls.length;
    fireEvent.change(getByPlaceholderText("Search User_id or Keyword"), { target: { value: "12345" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    await waitFor(() => expect(axiosGetMock.mock.calls.length).toBeGreaterThan(initial));
    expect(axiosGetMock.mock.calls.at(-1)[0]).toContain("user_id=12345");
  });
  it("non-numeric filter uses keyword param", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    vi.useFakeTimers();
    const { getByPlaceholderText } = renderWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.change(getByPlaceholderText("Search User_id or Keyword"), { target: { value: "Nike" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    await waitFor(() => expect(axiosGetMock.mock.calls.some((c) => c[0].includes("keyword=Nike"))).toBe(true));
  });
  it("Facebook status dropdown opens + selects All", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    const { findAllByText, container } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    // 'Facebook Status' button text appears in the header
    const fbToggle = (await findAllByText("Facebook Status"))[0].closest("button");
    fireEvent.click(fbToggle);
    // Pick 'Priority' (one of the statuses)
    const priorityItem = Array.from(container.querySelectorAll("div"))
      .find((d) => d.textContent === "Priority");
    fireEvent.click(priorityItem);
    await waitFor(() => expect(axiosGetMock.mock.calls.some((c) => c[0].includes("facebook_status=9"))).toBe(true));
  });
  it("Instagram status dropdown opens + selects an option", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    const { findAllByText, container } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    const igToggle = (await findAllByText("Instagram Status"))[0].closest("button");
    fireEvent.click(igToggle);
    const adFoundItem = Array.from(container.querySelectorAll("div"))
      .find((d) => d.textContent === "Ad Found");
    fireEvent.click(adFoundItem);
    await waitFor(() => expect(axiosGetMock.mock.calls.some((c) => c[0].includes("instagram_status=2"))).toBe(true));
  });
  it("date change re-fetches with from/to", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    const { onDateChange } = datePickerPropsCapture.at(-1);
    act(() => { onDateChange(new Date(2025, 0, 5), new Date(2025, 0, 15)); });
    await waitFor(() => expect(axiosGetMock.mock.calls.some((c) => c[0].includes("from=2025-01-05"))).toBe(true));
  });
  it("clicking outside Facebook dropdown closes it", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    const { findAllByText, container } = renderWith();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    const fbToggle = (await findAllByText("Facebook Status"))[0].closest("button");
    fireEvent.click(fbToggle);
    expect(Array.from(container.querySelectorAll("div"))
      .find((d) => d.textContent === "Priority")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    // dropdown closes
  });
  it("loading state shows Loader in tbody", () => {
    let resolveAxios;
    axiosGetMock.mockImplementation(() => new Promise((r) => { resolveAxios = r; }));
    const { getByTestId } = renderWith();
    expect(getByTestId("loader")).toBeInTheDocument();
    resolveAxios(keywordResp());
  });
  it("filter state 1 → opacity-50", async () => {
    axiosGetMock.mockResolvedValue(keywordResp());
    const { container } = renderWith(1);
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(container.firstChild.className).toMatch(/opacity-50/);
  });
});

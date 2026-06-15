import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("react-icons/fa", () => ({
  FaArrowUp: () => null, FaArrowDown: () => null,
  FaSortUp: () => null, FaSortDown: () => null,
}));
vi.mock("react-icons/ci", () => ({
  CiSearch: () => <i data-testid="search-ic" />,
}));
vi.mock("react-icons/io", () => ({
  IoIosArrowDown: () => <i data-testid="arrow-down-ic" />,
}));

vi.mock("recharts", () => ({
  BarChart: ({ children }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ children }) => <div>{children}</div>,
  Cell: ({ fill }) => <div data-testid="cell" data-fill={fill} />,
  XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, Legend: () => null,
  CartesianGrid: () => null, ResponsiveContainer: ({ children }) => <div>{children}</div>,
}));

vi.mock("../../../src/components/Pagination/Pagination", () => ({
  default: ({ totalCount, pageIndex, setPageIndex }) => (
    <div data-testid="pagination">
      <button data-testid="next" onClick={() => setPageIndex(pageIndex + 1)}>next</button>
    </div>
  ),
}));

vi.mock("../../../src/components/Pas/Loader", () => ({
  default: () => <div data-testid="loader" />,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const axiosGetMock = vi.fn();
vi.mock("axios", () => ({
  default: { get: (...a) => axiosGetMock(...a) },
}));

vi.mock("js-cookie", () => ({
  default: { get: () => "TOKEN" },
}));

vi.mock("../../../src/components/Pas/ApiResponse", () => ({
  getApiCall: vi.fn(),
}));

import UserDetailsPas, { CustomBarChart } from "../../../src/components/Pas/UserDetailsPas.jsx";

beforeEach(() => {
  navigateMock.mockReset();
  axiosGetMock.mockReset();
  vi.stubEnv("VITE_SEARCHES_API", "https://api.example.com/");
  localStorage.clear();
});

const userListResp = (data = []) => ({
  data: { code: 200, data, totalCount: data.length },
});

describe("UserDetailsPas", () => {
  it("renders stat cards + Users Data heading", async () => {
    axiosGetMock.mockResolvedValue(userListResp());
    const { getByText, getAllByText } = render(<UserDetailsPas />);
    expect(getByText("Users Data")).toBeInTheDocument();
    expect(getAllByText("Active Users").length).toBeGreaterThan(0);
    expect(getByText("Expired Users")).toBeInTheDocument();
    expect(getByText("Pending Users")).toBeInTheDocument();
    expect(getByText("Overall User Activity")).toBeInTheDocument();
    expect(getByText("Overall Top Users")).toBeInTheDocument();
  });
  it("fetches active users + users-count endpoints on mount", async () => {
    axiosGetMock.mockResolvedValue(userListResp());
    render(<UserDetailsPas />);
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    const calls = axiosGetMock.mock.calls.map((c) => c[0]);
    expect(calls.some(u => u.includes("get-active-users"))).toBe(true);
    expect(calls.some(u => u.includes("get-users-count"))).toBe(true);
  });
  it("renders user rows from response", async () => {
    axiosGetMock.mockResolvedValue(userListResp([
      { user_id: "u1", name: "Alice", email: "a@x.com" },
    ]));
    const { findByText } = render(<UserDetailsPas />);
    expect(await findByText("Alice")).toBeInTheDocument();
    expect(await findByText("u1")).toBeInTheDocument();
  });
  it("'No teams available' when empty list", async () => {
    axiosGetMock.mockResolvedValue(userListResp([]));
    const { findByText } = render(<UserDetailsPas />);
    expect(await findByText("No teams available")).toBeInTheDocument();
  });
  it("code 401 → navigates to root", async () => {
    axiosGetMock.mockResolvedValue({ data: { code: 401 } });
    render(<UserDetailsPas />);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("code 400 → empty table + totalCount 0", async () => {
    axiosGetMock.mockResolvedValue({ data: { code: 400 } });
    const { findByText } = render(<UserDetailsPas />);
    expect(await findByText("No teams available")).toBeInTheDocument();
  });
  it("getUsersCount 200 populates stats", async () => {
    axiosGetMock.mockImplementation((url) => {
      if (url.includes("get-users-count")) {
        return Promise.resolve({ data: { code: 200, activeUsersCount: 10, expireUsersCount: 5, pendingUserCount: 3 } });
      }
      return Promise.resolve(userListResp());
    });
    const { findByText } = render(<UserDetailsPas />);
    expect(await findByText("10")).toBeInTheDocument();
    expect(await findByText("5")).toBeInTheDocument();
    expect(await findByText("3")).toBeInTheDocument();
  });
  it("getUsersCount 401 → navigate", async () => {
    axiosGetMock.mockImplementation((url) => {
      if (url.includes("get-users-count")) {
        return Promise.resolve({ code: 401, data: { code: 401 } });
      }
      return Promise.resolve(userListResp());
    });
    render(<UserDetailsPas />);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("get-active-users list 401 → navigate", async () => {
    axiosGetMock.mockImplementation((url) => {
      if (url.includes("get-active-users")) {
        return Promise.resolve({ data: { code: 401 } });
      }
      return Promise.resolve(userListResp());
    });
    render(<UserDetailsPas />);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it("View Details click → sets localStorage + navigates", async () => {
    axiosGetMock.mockResolvedValue(userListResp([
      { user_id: "u-99", name: "Z", email: "z@x.com" },
    ]));
    const { findByText } = render(<UserDetailsPas />);
    fireEvent.click(await findByText("View Details"));
    expect(localStorage.getItem("userId")).toBe("u-99");
    expect(localStorage.getItem("userNameS")).toBe("Z");
    expect(localStorage.getItem("emailF")).toBe("z@x.com");
    expect(navigateMock).toHaveBeenCalledWith("/pas");
  });
  it("dropdown toggle reveals 3 category options", async () => {
    axiosGetMock.mockResolvedValue(userListResp());
    const { container } = render(<UserDetailsPas />);
    const toggleBtn = container.querySelector('[data-testid="arrow-down-ic"]').closest("button");
    fireEvent.click(toggleBtn);
    const menuItems = Array.from(container.querySelectorAll("li")).map(li => li.textContent);
    expect(menuItems).toContain("Active Users");
    expect(menuItems).toContain("Expired Users");
    expect(menuItems).toContain("Pending Users");
  });
  it("category change to 'Expired Users' fetches expired endpoint", async () => {
    axiosGetMock.mockResolvedValue(userListResp());
    const { container, getByText } = render(<UserDetailsPas />);
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    // Open dropdown via the toggle button (it has the "Active Users" label initially)
    const toggleBtn = container.querySelector('[data-testid="arrow-down-ic"]').closest("button");
    fireEvent.click(toggleBtn);
    axiosGetMock.mockClear();
    // Click the dropdown item "Expired Users" — there are two ("Expired Users" appears as stat card and as menu item)
    // Use getAllByText
    const allExpired = Array.from(container.querySelectorAll("li")).find(li => li.textContent === "Expired Users");
    fireEvent.click(allExpired);
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(axiosGetMock.mock.calls[0][0]).toContain("get-expired-users");
  });
  it("category change to 'Pending Users' fetches pending endpoint", async () => {
    axiosGetMock.mockResolvedValue(userListResp());
    const { container } = render(<UserDetailsPas />);
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    const toggleBtn = container.querySelector('[data-testid="arrow-down-ic"]').closest("button");
    fireEvent.click(toggleBtn);
    axiosGetMock.mockClear();
    const pendingItem = Array.from(container.querySelectorAll("li")).find(li => li.textContent === "Pending Users");
    fireEvent.click(pendingItem);
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(axiosGetMock.mock.calls[0][0]).toContain("get-pending-users");
  });
  it("search filter triggers debounced re-fetch with user_id param", async () => {
    axiosGetMock.mockResolvedValue(userListResp());
    vi.useFakeTimers();
    const { container } = render(<UserDetailsPas />);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    axiosGetMock.mockClear();
    const input = container.querySelector("input[type='text']");
    fireEvent.change(input, { target: { value: "search-q" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    await waitFor(() => expect(axiosGetMock).toHaveBeenCalled());
    expect(axiosGetMock.mock.calls.at(-1)[0]).toContain("user_id=search-q");
  });
  it("loader shown during initial load", async () => {
    let resolvePromise;
    axiosGetMock.mockImplementation(() => new Promise((r) => { resolvePromise = r; }));
    const { getByTestId } = render(<UserDetailsPas />);
    expect(getByTestId("loader")).toBeInTheDocument();
    resolvePromise(userListResp());
  });
  it("clicking outside dropdown closes it", async () => {
    axiosGetMock.mockResolvedValue(userListResp());
    const { container } = render(<UserDetailsPas />);
    const toggleBtn = container.querySelector('[data-testid="arrow-down-ic"]').closest("button");
    fireEvent.click(toggleBtn);
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    fireEvent.mouseDown(document.body);
    expect(container.querySelectorAll("li").length).toBe(0);
  });
  it("clicking inside dropdown does NOT close it (mouseDown on menu item)", async () => {
    axiosGetMock.mockResolvedValue(userListResp());
    const { container } = render(<UserDetailsPas />);
    const toggleBtn = container.querySelector('[data-testid="arrow-down-ic"]').closest("button");
    fireEvent.click(toggleBtn);
    const pendingItem = Array.from(container.querySelectorAll("li")).find(li => li.textContent === "Pending Users");
    fireEvent.mouseDown(pendingItem);
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
  });
  it("user name fallback 'N/A' when missing", async () => {
    axiosGetMock.mockResolvedValue(userListResp([
      { user_id: "u-1", email: "a@x.com" },
    ]));
    const { findAllByText } = render(<UserDetailsPas />);
    expect((await findAllByText("N/A")).length).toBeGreaterThan(0);
  });
});

describe("CustomBarChart (Pas/UserDetailsPas export)", () => {
  it("renders cells with highest-index colored", () => {
    const data = [
      { name: "A", uv: 100 },
      { name: "B", uv: 500 },
      { name: "C", uv: 200 },
    ];
    const { getAllByTestId } = render(<CustomBarChart data={data} color="#ff0000" index={0} />);
    const cells = getAllByTestId("cell");
    expect(cells.length).toBe(3);
    expect(cells[1].getAttribute("data-fill")).toBe("#ff0000");
    expect(cells[0].getAttribute("data-fill")).toBe("#ff000033");
  });
  it("works with index > activeind length", () => {
    const { getAllByTestId } = render(<CustomBarChart data={[{ uv: 1 }]} color="#abc" index={5} />);
    expect(getAllByTestId("cell").length).toBe(1);
  });
});

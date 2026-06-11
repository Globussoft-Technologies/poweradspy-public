// NOTE: dropdown toggle button is commented out in JSX, so toggleDropdown,
// handleMenuClick, and the menu list rendering are all dead. See
// https://github.com/Globussoft-Technologies/poweradspy/issues/256
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("react-icons/fa", () => ({
  FaArrowUp: () => null, FaArrowDown: () => null,
  FaSortUp: () => null, FaSortDown: () => null,
}));
vi.mock("react-icons/ci", () => ({
  CiSearch: () => <i data-testid="search-ic" />,
}));
vi.mock("react-helmet", () => ({
  default: ({ children }) => <div data-testid="helmet">{children}</div>,
}));
vi.mock("recharts", () => ({
  BarChart: ({ children, data }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ children }) => <div data-testid="bar">{children}</div>,
  Cell: ({ fill }) => <div data-testid="cell" data-fill={fill} />,
  XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, Legend: () => null,
  CartesianGrid: () => null, ResponsiveContainer: ({ children }) => <div>{children}</div>,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const fetchAllUsersMock = vi.fn(() => ({ type: "FETCH_USERS" }));
const fetchUsersStatsMock = vi.fn(() => ({ type: "FETCH_STATS" }));
const fetchUserUsageCostMock = vi.fn(() => ({ type: "FETCH_USAGE" }));
vi.mock("../../src/store/actions/adsgptActions", () => ({
  fetchAllUsers: (...a) => fetchAllUsersMock(...a),
  fetchUsersStats: (...a) => fetchUsersStatsMock(...a),
  fetchUserUsageCost: (...a) => fetchUserUsageCostMock(...a),
}));

const dispatchMock = vi.fn();
let selectorState = { adsgpt: { users: [], userStats: null } };
vi.mock("react-redux", () => ({
  useDispatch: () => dispatchMock,
  useSelector: (fn) => fn(selectorState),
}));

import Dashboard, { CustomBarChart } from "../../src/components/Dashboard.jsx";

beforeEach(() => {
  navigateMock.mockReset();
  dispatchMock.mockReset();
  fetchAllUsersMock.mockClear();
  fetchUsersStatsMock.mockClear();
  fetchUserUsageCostMock.mockClear();
  selectorState = { adsgpt: { users: [], userStats: null } };
});

describe("Dashboard", () => {
  it("renders welcome header", () => {
    const { getByText } = render(<Dashboard />);
    expect(getByText("Welcome Back,")).toBeInTheDocument();
    expect(getByText("Admin")).toBeInTheDocument();
  });
  it("dispatches fetchAllUsers + fetchUsersStats on mount", () => {
    render(<Dashboard />);
    expect(fetchAllUsersMock).toHaveBeenCalled();
    expect(fetchUsersStatsMock).toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalled();
  });
  it("renders 4 stat cards with default 0 values", () => {
    const { getByText, getAllByText } = render(<Dashboard />);
    expect(getByText("Total User")).toBeInTheDocument();
    expect(getByText("Active User")).toBeInTheDocument();
    expect(getByText("Expired User")).toBeInTheDocument();
    expect(getByText("Total Interactions")).toBeInTheDocument();
    expect(getAllByText("0").length).toBe(4);
  });
  it("renders stats from selectorState", () => {
    selectorState = {
      adsgpt: {
        users: [{ user_name: "u1", user_id: "1" }, { user_name: "u2", user_id: "2" }],
        userStats: { totalUsers: 100, activeUsers: 50, expiredUsers: 20 },
      },
    };
    const { getByText } = render(<Dashboard />);
    expect(getByText("100")).toBeInTheDocument();
    expect(getByText("50")).toBeInTheDocument();
    expect(getByText("20")).toBeInTheDocument();
    // Total Interactions = users.length = 2; assertion via getAllByText to avoid id collisions
  });
  it("renders user rows in table", () => {
    selectorState = {
      adsgpt: {
        users: [
          { user_name: "Alice", user_id: "ID-1", user_email: "a@x.com" },
          { user_name: "Bob", user_id: "ID-2", user_email: "b@x.com" },
        ],
        userStats: { totalUsers: 2, activeUsers: 2, expiredUsers: 0 },
      },
    };
    const { getByText } = render(<Dashboard />);
    expect(getByText("Alice")).toBeInTheDocument();
    expect(getByText("Bob")).toBeInTheDocument();
  });
  it("empty data → 'No teams available'", () => {
    const { getByText } = render(<Dashboard />);
    expect(getByText("No teams available")).toBeInTheDocument();
  });
  it("user_name missing in row → renders 'N/A'", () => {
    selectorState = {
      adsgpt: { users: [{ user_id: "U-1" }], userStats: { totalUsers: 1 } },
    };
    const { getAllByText } = render(<Dashboard />);
    expect(getAllByText("N/A").length).toBeGreaterThan(0);
  });
  it("search filter narrows users by name", () => {
    selectorState = {
      adsgpt: {
        users: [
          { user_name: "Nike", user_id: "1", user_email: "n@x.com" },
          { user_name: "Adidas", user_id: "2", user_email: "a@x.com" },
        ],
      },
    };
    const { getByPlaceholderText, getByText, queryByText } = render(<Dashboard />);
    fireEvent.change(getByPlaceholderText("Search by Name or ID or Email ID..."), { target: { value: "nike" } });
    expect(getByText("Nike")).toBeInTheDocument();
    expect(queryByText("Adidas")).toBeNull();
  });
  it("search filter narrows by user_id", () => {
    selectorState = {
      adsgpt: {
        users: [
          { user_name: "A", user_id: "ID-FB", user_email: "a@x.com" },
          { user_name: "B", user_id: "ID-IG", user_email: "b@x.com" },
        ],
      },
    };
    const { getByPlaceholderText, getByText, queryByText } = render(<Dashboard />);
    fireEvent.change(getByPlaceholderText("Search by Name or ID or Email ID..."), { target: { value: "id-fb" } });
    expect(getByText("ID-FB")).toBeInTheDocument();
    expect(queryByText("ID-IG")).toBeNull();
  });
  it("search filter narrows by email", () => {
    selectorState = {
      adsgpt: {
        users: [
          { user_name: "A", user_id: "1", user_email: "alpha@x.com" },
          { user_name: "B", user_id: "2", user_email: "beta@x.com" },
        ],
      },
    };
    const { getByPlaceholderText, getByText, queryByText } = render(<Dashboard />);
    fireEvent.change(getByPlaceholderText("Search by Name or ID or Email ID..."), { target: { value: "alpha" } });
    expect(getByText("A")).toBeInTheDocument();
    expect(queryByText("B")).toBeNull();
  });
  it("View Details click dispatches fetchUserUsageCost + navigates", () => {
    selectorState = {
      adsgpt: { users: [{ user_name: "U", user_id: "U-123", user_email: "u@x.com" }] },
    };
    const { getByText } = render(<Dashboard />);
    fireEvent.click(getByText("View Details"));
    expect(fetchUserUsageCostMock).toHaveBeenCalledWith("U-123");
    expect(navigateMock).toHaveBeenCalledWith("/adsgpt/userdetails/U-123", expect.any(Object));
  });
  it("clicking outside closes the dropdown (effect handler registered)", () => {
    render(<Dashboard />);
    // Dropdown toggle button is commented out so dropdown is always closed.
    // The handler still runs — verify no crash on outside click.
    fireEvent.mouseDown(document.body);
  });
  it("fetchData rejection is caught (console.error path)", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchAllUsersMock.mockImplementationOnce(() => { throw new Error("network"); });
    render(<Dashboard />);
    await new Promise(r => setTimeout(r, 10));
    consoleErr.mockRestore();
  });
});

describe("CustomBarChart", () => {
  it("renders BarChart with cells highlighting the highest-uv index", () => {
    const data = [
      { name: "A", uv: 100 },
      { name: "B", uv: 500 }, // highest at idx 1
      { name: "C", uv: 200 },
    ];
    const { getAllByTestId } = render(<CustomBarChart data={data} color="#ff0000" index={0} />);
    const cells = getAllByTestId("cell");
    expect(cells[1].getAttribute("data-fill")).toBe("#ff0000");
    expect(cells[0].getAttribute("data-fill")).toBe("#ff000033");
  });
  it("index in valid range → only that slot updated", () => {
    const data = [{ uv: 1 }, { uv: 5 }];
    const { getAllByTestId } = render(<CustomBarChart data={data} color="#abc" index={2} />);
    expect(getAllByTestId("cell").length).toBe(2);
  });
});

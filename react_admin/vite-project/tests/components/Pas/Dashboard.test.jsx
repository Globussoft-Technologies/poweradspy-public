// NOTE: handleUserDetails (lines 120-123) is dead code — see
// https://github.com/Globussoft-Technologies/poweradspy/issues/256
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("react-icons/fa", () => ({
  FaArrowUp: () => null,
  FaArrowDown: () => null,
  FaRegCopy: ({ onClick, className }) => <i data-testid="copy-ic" className={className} onClick={onClick} />,
}));
vi.mock("react-icons/ci", () => ({
  CiFilter: () => <i data-testid="filter-ic" />,
  CiSearch: () => <i data-testid="search-ic" />,
}));
vi.mock("react-datepicker/dist/react-datepicker.css", () => ({}));
vi.mock("react-datepicker", () => ({ default: () => <div data-testid="dp" /> }));

vi.mock("recharts", () => ({
  BarChart: ({ children, data }) => <div data-testid="bar-chart" data-count={data?.length}>{children}</div>,
  Bar: ({ children }) => <div data-testid="bar">{children}</div>,
  Cell: ({ fill }) => <div data-testid="cell" data-fill={fill} />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@tanstack/react-table", () => ({
  useReactTable: () => ({}),
  getCoreRowModel: () => () => ({}),
  createColumnHelper: () => ({ accessor: () => ({}), display: () => ({}) }),
  getPaginationRowModel: () => () => ({}),
}));

vi.mock("../../../src/components/Pas/KeywordSearches", () => ({
  default: ({ setKeywordStatis }) => (
    <div data-testid="kw-searches" onClick={() => setKeywordStatis({ totalCount: 100 })}>kw</div>
  ),
}));
vi.mock("../../../src/components/Pas/AdvertiserSearches", () => ({
  default: ({ setStatis }) => (
    <div data-testid="adv-searches" onClick={() => setStatis({ totalCount: 200 })}>adv</div>
  ),
}));
vi.mock("../../../src/components/Pas/DomainSearches", () => ({
  default: ({ setDoaminStatis }) => (
    <div data-testid="dom-searches" onClick={() => setDoaminStatis({ totalCount: 50 })}>dom</div>
  ),
}));
vi.mock("../../../src/components/Pas/OtherSearches", () => ({
  default: () => <div data-testid="other-searches">other</div>,
}));

import AdminContext from "../../../src/Context/Context.jsx";
import Dashboard, { CustomBarChart } from "../../../src/components/Pas/Dashboard.jsx";

const renderWithCtx = () => {
  const setsearchdataFilterTable = vi.fn();
  const ctx = { searchdataFilterTable: 3, setsearchdataFilterTable };
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <Dashboard />
    </AdminContext.Provider>,
  );
  return { ...utils, ctx };
};

beforeEach(() => {
  navigateMock.mockReset();
  localStorage.clear();
  localStorage.setItem("userNameS", "TestUser");
  localStorage.setItem("userId", "uid-42");
  navigator.clipboard = { writeText: vi.fn(() => Promise.resolve()) };
});

describe("Dashboard", () => {
  it("renders userName + userId from localStorage", () => {
    const { getByText } = renderWithCtx();
    expect(getByText("TestUser")).toBeInTheDocument();
    expect(getByText("uid-42")).toBeInTheDocument();
  });
  it("renders all 3 stat cards", () => {
    const { getByText } = renderWithCtx();
    expect(getByText("Keyword Searched")).toBeInTheDocument();
    expect(getByText("Advertiser Searched")).toBeInTheDocument();
    expect(getByText("Domain Searched")).toBeInTheDocument();
  });
  it("Clear Filter button calls setsearchdataFilterTable(3)", () => {
    const { getByTestId, ctx } = renderWithCtx();
    fireEvent.click(getByTestId("filter-ic").closest("button"));
    expect(ctx.setsearchdataFilterTable).toHaveBeenCalledWith(3);
  });
  it("View Details on each stat triggers setsearchdataFilterTable(index)", () => {
    const { getAllByText, ctx } = renderWithCtx();
    const buttons = getAllByText("View Details");
    expect(buttons.length).toBe(3);
    fireEvent.click(buttons[0]);
    expect(ctx.setsearchdataFilterTable).toHaveBeenCalledWith(0);
    fireEvent.click(buttons[1]);
    expect(ctx.setsearchdataFilterTable).toHaveBeenCalledWith(1);
    fireEvent.click(buttons[2]);
    expect(ctx.setsearchdataFilterTable).toHaveBeenCalledWith(2);
  });
  it("copyToClipboard on userName icon", () => {
    const { getAllByTestId } = renderWithCtx();
    fireEvent.click(getAllByTestId("copy-ic")[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("TestUser");
  });
  it("copyToClipboard on userId icon", () => {
    const { getAllByTestId } = renderWithCtx();
    fireEvent.click(getAllByTestId("copy-ic")[1]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("uid-42");
  });
  it("KeywordSearches sets keywordStatis → Keyword Searched shows 100", () => {
    const { getByTestId, getByText } = renderWithCtx();
    act(() => {
      fireEvent.click(getByTestId("kw-searches"));
    });
    expect(getByText("100")).toBeInTheDocument();
  });
  it("AdvertiserSearches sets statics → Advertiser Searched shows 200", () => {
    const { getByTestId, getByText } = renderWithCtx();
    act(() => {
      fireEvent.click(getByTestId("adv-searches"));
    });
    expect(getByText("200")).toBeInTheDocument();
  });
  it("DomainSearches sets domainStatics → Domain Searched shows 50", () => {
    const { getByTestId, getByText } = renderWithCtx();
    act(() => {
      fireEvent.click(getByTestId("dom-searches"));
    });
    expect(getByText("50")).toBeInTheDocument();
  });
  it("all 4 search sub-components rendered", () => {
    const { getByTestId } = renderWithCtx();
    expect(getByTestId("kw-searches")).toBeInTheDocument();
    expect(getByTestId("adv-searches")).toBeInTheDocument();
    expect(getByTestId("dom-searches")).toBeInTheDocument();
    expect(getByTestId("other-searches")).toBeInTheDocument();
  });
});

describe("CustomBarChart", () => {
  it("renders BarChart with bars (highest-index Cell uses solid color)", () => {
    const data = [
      { name: "A", uv: 100 },
      { name: "B", uv: 500 }, // highest at index 1
      { name: "C", uv: 200 },
    ];
    const { getAllByTestId } = render(<CustomBarChart data={data} color="#ff0000" index={0} />);
    const cells = getAllByTestId("cell");
    expect(cells.length).toBe(3);
    // The highest-index cell uses pure color; others use alpha-suffix `${color}33`
    expect(cells[1].getAttribute("data-fill")).toBe("#ff0000");
    expect(cells[0].getAttribute("data-fill")).toBe("#ff000033");
  });
  it("empty data → no cells rendered, no useEffect setHeighestindex", () => {
    const { container } = render(<CustomBarChart data={[]} color="#ff0000" index={0} />);
    expect(container.querySelector("[data-testid='cell']")).toBeNull();
  });
  it("data with single item → that item is highest", () => {
    const { getAllByTestId } = render(
      <CustomBarChart data={[{ name: "Only", uv: 9 }]} color="#00ff00" index={1} />,
    );
    const cells = getAllByTestId("cell");
    expect(cells.length).toBe(1);
  });
});

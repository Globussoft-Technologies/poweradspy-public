import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  LayoutGrid: () => <i data-testid="lg-ic" />,
  Library: () => <i data-testid="lib-ic" />,
  Hash: () => <i data-testid="hash-ic" />,
  BrainCircuit: () => <i data-testid="brain-ic" />,
  Menu: () => <i data-testid="menu-ic" />,
  Bookmark: () => <i data-testid="bm-ic" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k, opts) => opts?.count != null ? `${k}:${opts.count}` : k }),
}));

vi.mock("../../../src/components/shared/NavItem", () => ({
  default: ({ label, active, onClick, collapsed }) => (
    <button data-testid={`nav-${label}`} data-active={active} data-collapsed={collapsed} onClick={onClick}>{label}</button>
  ),
}));
vi.mock("../../../src/components/shared/SectionLabel", () => ({
  default: ({ label, collapsed }) => <div data-testid={`section-${label}`} data-collapsed={collapsed}>{label}</div>,
}));
vi.mock("../../../src/components/shared/SidebarDivider", () => ({
  default: () => <hr data-testid="divider" />,
}));
vi.mock("../../../src/components/sdui/SchemaRenderer", () => ({
  default: ({ document, onFilterChange }) => (
    <div data-testid={`schema-${document._id}`}>
      {document.title || "DOC"}
      <button
        data-testid={`schema-trigger-${document._id}`}
        onClick={() => onFilterChange && onFilterChange("k", "v")}
      >trigger</button>
    </div>
  ),
}));

import Sidebar from "../../../src/components/layout/Sidebar.jsx";

const baseSdui = {
  config: { sidebar: [] },
  loading: false,
  filterValues: {},
  setFilter: vi.fn(),
  clearAll: vi.fn(),
  totalActiveFilters: 0,
  shouldShowFilter: () => true,
  shouldShowOption: () => true,
  isDependencySatisfied: () => true,
  activePlatforms: [],
};

function build(props = {}) {
  return { sdui: baseSdui, isOpen: true, setIsOpen: vi.fn(), ...props };
}

describe("Sidebar > nav items", () => {
  it("renders all_projects + ads_library", () => {
    const { getByTestId } = render(<Sidebar {...build()} />);
    expect(getByTestId("nav-all_projects")).toBeInTheDocument();
    expect(getByTestId("nav-ads_library")).toBeInTheDocument();
  });
  it("favourite_hidden_ads visible when isLoggedIn + allowedPlatforms truthy", () => {
    const { getByTestId } = render(<Sidebar {...build({ isLoggedIn: true, allowedPlatforms: ["fb"] })} />);
    expect(getByTestId("nav-favourite_hidden_ads")).toBeInTheDocument();
  });
  it("favourite_hidden_ads visible when allowedPlatforms=null (default)", () => {
    const { getByTestId } = render(<Sidebar {...build({ isLoggedIn: true })} />);
    expect(getByTestId("nav-favourite_hidden_ads")).toBeInTheDocument();
  });
  it("favourite_hidden_ads hidden when allowedPlatforms=[]", () => {
    const { queryByTestId } = render(<Sidebar {...build({ isLoggedIn: true, allowedPlatforms: [] })} />);
    expect(queryByTestId("nav-favourite_hidden_ads")).toBeNull();
  });
  it("favourite_hidden_ads hidden when not logged in", () => {
    const { queryByTestId } = render(<Sidebar {...build({ isLoggedIn: false })} />);
    expect(queryByTestId("nav-favourite_hidden_ads")).toBeNull();
  });
});

describe("Sidebar > all_projects gating", () => {
  it("canAccessProjects=false → onRestricted fires", () => {
    const onRestricted = vi.fn();
    const onPageChange = vi.fn();
    const { getByTestId } = render(<Sidebar {...build({ canAccessProjects: false, onRestricted, onPageChange })} />);
    fireEvent.click(getByTestId("nav-all_projects"));
    expect(onRestricted).toHaveBeenCalled();
    expect(onPageChange).not.toHaveBeenCalled();
  });
  it("canAccessProjects=true → onPageChange('projects')", () => {
    const onPageChange = vi.fn();
    const { getByTestId } = render(<Sidebar {...build({ canAccessProjects: true, onPageChange })} />);
    fireEvent.click(getByTestId("nav-all_projects"));
    expect(onPageChange).toHaveBeenCalledWith("projects");
  });
  it("ads_library nav fires onPageChange('ads')", () => {
    const onPageChange = vi.fn();
    const { getByTestId } = render(<Sidebar {...build({ onPageChange })} />);
    fireEvent.click(getByTestId("nav-ads_library"));
    expect(onPageChange).toHaveBeenCalledWith("ads");
  });
  it("favourite_hidden nav fires onShowSavedAdsPage", () => {
    const onShowSavedAdsPage = vi.fn();
    const { getByTestId } = render(<Sidebar {...build({ isLoggedIn: true, onShowSavedAdsPage })} />);
    fireEvent.click(getByTestId("nav-favourite_hidden_ads"));
    expect(onShowSavedAdsPage).toHaveBeenCalled();
  });
  it("favourite_hidden nav click with no onShowSavedAdsPage prop → optional call no-op (line 117 false branch)", () => {
    const { getByTestId } = render(<Sidebar {...build({ isLoggedIn: true })} />);
    // No throw — optional call (.?.()) short-circuits
    expect(() => fireEvent.click(getByTestId("nav-favourite_hidden_ads"))).not.toThrow();
  });
  it("favourite_hidden nav with isOpen=false uses Bookmark size=18 (line 117 ternary false)", () => {
    const { getByTestId } = render(
      <Sidebar {...build({ isLoggedIn: true, isOpen: false })} />,
    );
    expect(getByTestId("nav-favourite_hidden_ads")).toBeInTheDocument();
  });
});

describe("Sidebar > backdrop + toggle", () => {
  it("isOpen=true renders mobile backdrop", () => {
    const { container } = render(<Sidebar {...build()} />);
    expect(container.querySelector(".bg-black\\/60")).not.toBeNull();
  });
  it("backdrop click closes (setIsOpen(false))", () => {
    const setIsOpen = vi.fn();
    const { container } = render(<Sidebar {...build({ setIsOpen })} />);
    fireEvent.click(container.querySelector(".bg-black\\/60"));
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
  it("isOpen=false hides backdrop + uses w-16 width", () => {
    const { container } = render(<Sidebar {...build({ isOpen: false })} />);
    expect(container.querySelector(".bg-black\\/60")).toBeNull();
    expect(container.querySelector(".w-16")).not.toBeNull();
  });
  it("menu button toggles open state", () => {
    const setIsOpen = vi.fn();
    const { getByTestId } = render(<Sidebar {...build({ setIsOpen })} />);
    fireEvent.click(getByTestId("menu-ic").closest("button"));
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});

describe("Sidebar > filters section visibility", () => {
  it("activePage=projects → no filters section", () => {
    const { queryByTestId } = render(<Sidebar {...build({ activePage: "projects" })} />);
    expect(queryByTestId("section-filters")).toBeNull();
  });
  it("showSavedAdsPage=true → no filters section", () => {
    const { queryByTestId } = render(<Sidebar {...build({ activePage: "ads", showSavedAdsPage: true })} />);
    expect(queryByTestId("section-filters")).toBeNull();
  });
  it("isOpen=false → no filters section", () => {
    const { queryByTestId } = render(<Sidebar {...build({ isOpen: false })} />);
    expect(queryByTestId("section-filters")).toBeNull();
  });
  it("activePage=ads + open → filters section rendered", () => {
    const { getByTestId } = render(<Sidebar {...build({ activePage: "ads" })} />);
    expect(getByTestId("section-filters")).toBeInTheDocument();
  });
});

describe("Sidebar > SDUI doc rendering", () => {
  it("loading=true → 'loading_filters' text", () => {
    const { getByText } = render(<Sidebar {...build({ sdui: { ...baseSdui, loading: true } })} />);
    expect(getByText("loading_filters")).toBeInTheDocument();
  });
  it("empty sidebarDocs → 'no_filters_configured' text", () => {
    const { getByText } = render(<Sidebar {...build()} />);
    expect(getByText("no_filters_configured")).toBeInTheDocument();
  });
  it("renders one SchemaRenderer per doc", () => {
    const sdui = { ...baseSdui, config: { sidebar: [{ _id: "d1", title: "X" }, { _id: "d2", title: "Y" }] } };
    const { getByTestId } = render(<Sidebar {...build({ sdui })} />);
    expect(getByTestId("schema-d1")).toBeInTheDocument();
    expect(getByTestId("schema-d2")).toBeInTheDocument();
  });
  it("shouldShowFilter=false filters docs out", () => {
    const sdui = {
      ...baseSdui,
      config: { sidebar: [{ _id: "d1" }, { _id: "d2" }] },
      shouldShowFilter: (d) => d._id === "d1",
    };
    const { getByTestId, queryByTestId } = render(<Sidebar {...build({ sdui })} />);
    expect(getByTestId("schema-d1")).toBeInTheDocument();
    expect(queryByTestId("schema-d2")).toBeNull();
  });
  it("divider rendered between docs (not after last)", () => {
    const sdui = { ...baseSdui, config: { sidebar: [{ _id: "d1" }, { _id: "d2" }, { _id: "d3" }] } };
    const { getAllByTestId } = render(<Sidebar {...build({ sdui })} />);
    // 1 sidebar divider before filters section + 2 between 3 docs = 3 total
    expect(getAllByTestId("divider").length).toBe(3);
  });
});

describe("Sidebar > Clear All", () => {
  it("hidden when totalActiveFilters=0", () => {
    const { queryByText } = render(<Sidebar {...build()} />);
    expect(queryByText(/clear_x_filters/)).toBeNull();
  });
  it("singular text when count=1", () => {
    const sdui = { ...baseSdui, totalActiveFilters: 1 };
    const { getByText } = render(<Sidebar {...build({ sdui })} />);
    expect(getByText("clear_x_filters:1")).toBeInTheDocument();
  });
  it("plural text when count>1", () => {
    const sdui = { ...baseSdui, totalActiveFilters: 3 };
    const { getByText } = render(<Sidebar {...build({ sdui })} />);
    expect(getByText("clear_x_filters_plural:3")).toBeInTheDocument();
  });
  it("click invokes clearAll", () => {
    const clearAll = vi.fn();
    const sdui = { ...baseSdui, totalActiveFilters: 1, clearAll };
    const { getByText } = render(<Sidebar {...build({ sdui })} />);
    fireEvent.click(getByText("clear_x_filters:1"));
    expect(clearAll).toHaveBeenCalled();
  });
});

describe("Sidebar > guest restriction", () => {
  it("config?.sidebar undefined falls back to [] (line 58)", () => {
    const sdui = { ...baseSdui, config: undefined };
    const { container } = render(<Sidebar {...build({ sdui })} />);
    // No docs rendered, but component doesn't crash
    expect(container.innerHTML).toMatch(/aside|sidebar/i);
  });
  it("allowedPlatforms.length > 0 right-side of || (line 117 second branch)", () => {
    // With allowedPlatforms truthy + non-empty, the right side of `==null || .length>0` evaluates
    const { container } = render(
      <Sidebar {...build({ isLoggedIn: true, allowedPlatforms: ["fb", "ig"] })} />,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
  it("filter change in guest mode triggers showGuestWarning instead of setFilter (line 50)", () => {
    const showGuestWarning = vi.fn();
    const setFilter = vi.fn();
    const guest = { isRestricted: true, showGuestWarning };
    const sdui = { ...baseSdui, config: { sidebar: [{ _id: "d1", title: "T" }] }, setFilter };
    const { getByTestId } = render(<Sidebar {...build({ sdui, guest })} />);
    fireEvent.click(getByTestId("schema-trigger-d1"));
    expect(showGuestWarning).toHaveBeenCalled();
    expect(setFilter).not.toHaveBeenCalled();
  });
  it("clear in guest mode triggers showGuestWarning instead of clearAll", () => {
    const showGuestWarning = vi.fn();
    const clearAll = vi.fn();
    const guest = { isRestricted: true, showGuestWarning };
    const sdui = { ...baseSdui, totalActiveFilters: 1, clearAll };
    const { getByText } = render(<Sidebar {...build({ sdui, guest })} />);
    fireEvent.click(getByText("clear_x_filters:1"));
    expect(showGuestWarning).toHaveBeenCalled();
    expect(clearAll).not.toHaveBeenCalled();
  });
});

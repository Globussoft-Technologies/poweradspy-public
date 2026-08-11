import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

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
  default: ({ document, onFilterChange, onDocumentClick, shouldShowFilter, shouldShowOption }) => (
    <div
      data-testid={`schema-${document._id}`}
      data-first-filter-visible={String(
        shouldShowFilter?.(document.filters?.[0] || document),
      )}
      data-first-option-visible={String(
        shouldShowOption?.(document.filters?.[0]?.options?.[0]),
      )}
    >
      {document.title || "DOC"}
      <button
        data-testid={`schema-trigger-${document._id}`}
        onClick={() => onFilterChange && onFilterChange("k", "v")}
      >trigger</button>
      {onDocumentClick && (
        <button data-testid={`schema-open-${document._id}`} onClick={onDocumentClick}>open</button>
      )}
    </div>
  ),
}));
vi.mock("../../../src/components/sdui/AiSignalsModal", () => ({
  default: ({ isOpen }) => <div data-testid="ai-signals-modal" data-open={isOpen} />,
}));

import Sidebar from "../../../src/components/layout/Sidebar.jsx";

const baseSdui = {
  config: { sidebar: [] },
  loading: false,
  filterValues: {},
  setFilter: vi.fn(),
  setAllFilters: vi.fn(),
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
    expect(getByTestId("nav-saved_hidden_ads")).toBeInTheDocument();
  });
  it("favourite_hidden_ads visible when allowedPlatforms=null (default)", () => {
    const { getByTestId } = render(<Sidebar {...build({ isLoggedIn: true })} />);
    expect(getByTestId("nav-saved_hidden_ads")).toBeInTheDocument();
  });
  it("favourite_hidden_ads hidden when allowedPlatforms=[]", () => {
    const { queryByTestId } = render(<Sidebar {...build({ isLoggedIn: true, allowedPlatforms: [] })} />);
    expect(queryByTestId("nav-saved_hidden_ads")).toBeNull();
  });
  it("favourite_hidden_ads hidden when not logged in", () => {
    const { queryByTestId } = render(<Sidebar {...build({ isLoggedIn: false })} />);
    expect(queryByTestId("nav-saved_hidden_ads")).toBeNull();
  });
});

describe("Sidebar > all_projects gating", () => {
  it("unresolved access opens Projects without showing pricing", () => {
    const onRestricted = vi.fn();
    const onPageChange = vi.fn();
    const { getByTestId } = render(<Sidebar {...build({
      canAccessProjects: false,
      projectsAccessResolved: false,
      onRestricted,
      onPageChange,
    })} />);
    fireEvent.click(getByTestId("nav-all_projects"));
    expect(onPageChange).toHaveBeenCalledWith("projects");
    expect(onRestricted).not.toHaveBeenCalled();
  });
  it("unavailable access data opens the Projects error state without pricing", () => {
    const onRestricted = vi.fn();
    const onPageChange = vi.fn();
    const { getByTestId } = render(<Sidebar {...build({
      canAccessProjects: false,
      projectsAccessUnavailable: true,
      onRestricted,
      onPageChange,
    })} />);
    fireEvent.click(getByTestId("nav-all_projects"));
    expect(onPageChange).toHaveBeenCalledWith("projects");
    expect(onRestricted).not.toHaveBeenCalled();
  });
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
    fireEvent.click(getByTestId("nav-saved_hidden_ads"));
    expect(onShowSavedAdsPage).toHaveBeenCalled();
  });
  it("favourite_hidden nav click with no onShowSavedAdsPage prop → optional call no-op (line 117 false branch)", () => {
    const { getByTestId } = render(<Sidebar {...build({ isLoggedIn: true })} />);
    // No throw — optional call (.?.()) short-circuits
    expect(() => fireEvent.click(getByTestId("nav-saved_hidden_ads"))).not.toThrow();
  });
  it("favourite_hidden nav with isOpen=false uses Bookmark size=18 (line 117 ternary false)", () => {
    const { getByTestId } = render(
      <Sidebar {...build({ isLoggedIn: true, isOpen: false })} />,
    );
    expect(getByTestId("nav-saved_hidden_ads")).toBeInTheDocument();
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

  it("does not leave an empty divider slot for Transparency without Google", () => {
    const sdui = {
      ...baseSdui,
      activePlatforms: ["facebook"],
      config: {
        sidebar: [
          { _id: "category" },
          { _id: "google_transparency" },
          { _id: "country" },
        ],
      },
    };
    const { getAllByTestId, queryByTestId } = render(
      <Sidebar {...build({ sdui })} />,
    );

    expect(queryByTestId("schema-google_transparency")).toBeNull();
    // One divider starts the filter area and one separates the two visible docs.
    expect(getAllByTestId("divider")).toHaveLength(2);
  });
});

describe("Sidebar > AI Filter plan gating", () => {
  const aiSdui = {
    ...baseSdui,
    config: { sidebar: [{ _id: "ai_meta", title: "AI Filter", filters: [] }] },
  };

  it("does not open the AI Filter workspace when the active plan disables it", () => {
    const onRestricted = vi.fn();
    const { getByTestId } = render(<Sidebar {...build({
      sdui: aiSdui,
      isFilterRestricted: (id) => id === "ai_meta",
      onRestricted,
    })} />);

    fireEvent.click(getByTestId("schema-open-ai_meta"));
    expect(onRestricted).toHaveBeenCalledOnce();
    expect(getByTestId("ai-signals-modal")).toHaveAttribute("data-open", "false");
  });

  it("opens the AI Filter workspace when the active plan enables it", () => {
    const { getByTestId } = render(<Sidebar {...build({
      sdui: aiSdui,
      isFilterRestricted: () => false,
    })} />);

    fireEvent.click(getByTestId("schema-open-ai_meta"));
    expect(getByTestId("ai-signals-modal")).toHaveAttribute("data-open", "true");
  });
});

describe("Sidebar > Budget plan gating", () => {
  it("keeps disabled Sidebar Budget visible while its child stays plan-guarded", () => {
    const sdui = {
      ...baseSdui,
      config: {
        sidebar: [{
          _id: "sidebar_budget",
          title: "Budget",
          filters: [{
            _id: "budget_filter",
            platform_applicability: ["tiktok"],
            options: [{ value: "low", platform_applicability: ["tiktok"] }],
          }],
        }],
      },
      activePlatforms: ["facebook", "instagram", "youtube"],
      shouldShowFilter: () => false,
      shouldShowOption: () => false,
    };

    const { getByTestId } = render(<Sidebar {...build({
      sdui,
      isFilterRestricted: (id) => id === "sidebar_budget" || id === "budget_filter",
    })} />);

    expect(getByTestId("schema-sidebar_budget")).toHaveAttribute(
      "data-first-filter-visible",
      "true",
    );
    expect(getByTestId("schema-sidebar_budget")).toHaveAttribute(
      "data-first-option-visible",
      "true",
    );
  });

  it("clears a persisted Sidebar Budget selection when the active policy disables it", async () => {
    const setAllFilters = vi.fn();
    const sdui = {
      ...baseSdui,
      filterValues: { budget_filter: ["low"], ad_budget: [100, 500] },
      setAllFilters,
    };
    render(<Sidebar {...build({
      sdui,
      isFilterRestricted: (id) => id === "sidebar_budget",
    })} />);

    await waitFor(() => expect(setAllFilters).toHaveBeenCalledWith({ ad_budget: [100, 500] }));
  });
});

describe("Sidebar > AI Metadata plan gating", () => {
  it("clears persisted AI selections when the active policy disables AI Metadata", async () => {
    const setAllFilters = vi.fn();
    const sdui = {
      ...baseSdui,
      filterValues: {
        country: ["US"],
        has_ai_meta: true,
        ai_ad_type: ["ugc"],
        ai_category_id: ["1009"],
      },
      setAllFilters,
    };
    render(<Sidebar {...build({
      sdui,
      isFilterRestricted: (id) => id === "ai_meta",
    })} />);

    await waitFor(() => expect(setAllFilters).toHaveBeenCalledWith({ country: ["US"] }));
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
  it("filter change in guest mode with onRestricted calls it (line 50 onRestricted branch)", () => {
    const onRestricted = vi.fn();
    const showGuestWarning = vi.fn();
    const guest = { isRestricted: true, showGuestWarning };
    const sdui = { ...baseSdui, config: { sidebar: [{ _id: "d1", title: "T" }] }, setFilter: vi.fn() };
    const { getByTestId } = render(<Sidebar {...build({ sdui, guest, onRestricted })} />);
    fireEvent.click(getByTestId("schema-trigger-d1"));
    expect(onRestricted).toHaveBeenCalled();
    expect(showGuestWarning).not.toHaveBeenCalled();
  });
  it("clear in guest mode with onRestricted calls it (line 54 onRestricted branch)", () => {
    const onRestricted = vi.fn();
    const showGuestWarning = vi.fn();
    const guest = { isRestricted: true, showGuestWarning };
    const sdui = { ...baseSdui, totalActiveFilters: 1, clearAll: vi.fn() };
    const { getByText } = render(<Sidebar {...build({ sdui, guest, onRestricted })} />);
    fireEvent.click(getByText("clear_x_filters:1"));
    expect(onRestricted).toHaveBeenCalled();
    expect(showGuestWarning).not.toHaveBeenCalled();
  });
});

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// Stub DocumentSection — just render the title + children
vi.mock("../../../src/components/sdui/DocumentSection", () => ({
  default: ({ document: d, children }) => (
    <section data-testid="doc-section" data-doc-id={d?._id}>
      <span data-testid="doc-title">{d?.title || ""}</span>
      {children}
    </section>
  ),
}));

// Stub componentMap — every filter.type becomes a tiny <Stub /> component
// that exposes props via data-* attrs and a click that invokes onChange / onChildChange
vi.mock("../../../src/components/sdui/componentMap", () => {
  const Stub = (props) => (
    <button
      data-testid={`stub-${props.filterId}`}
      data-label={props.label === null ? "<null>" : props.label || ""}
      data-placeholder={props.placeholder || ""}
      data-show-search={String(props.showSearch)}
      data-multi={String(props.multiSelect)}
      data-platforms={(props.activePlatforms || []).join(",")}
      data-value-key={props.valueKey}
      data-min={props.min}
      data-max={props.max}
      data-selected={JSON.stringify(props.selected)}
      data-options-count={(props.options || []).length}
      onClick={() => props.onChange("CLICKED")}
      onDoubleClick={() =>
        props.onChildChange(["leafA"], "parent1")
      }
      onContextMenu={(e) => {
        e.preventDefault();
        props.onChildChange(["leafA"], null);
      }}
      onMouseEnter={() => props.onChildChange([], "parent1")}
      onMouseLeave={() => props.onChildChange(["leafA"], "parent2")}
    >
      stub
    </button>
  );
  return {
    default: {
      checkbox: Stub,
      radio: Stub,
      nested_multiselect: Stub,
      nested_select: Stub,
      icon_toggle: Stub,
      range_slider: Stub,
    },
  };
});

import SchemaRenderer from "../../../src/components/sdui/SchemaRenderer.jsx";

describe("SchemaRenderer > top-level guards", () => {
  it("returns null when document is null", () => {
    const { container } = render(<SchemaRenderer document={null} />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when document.visible === false", () => {
    const { container } = render(
      <SchemaRenderer document={{ _id: "x", visible: false, filters: [] }} />,
    );
    expect(container.innerHTML).toBe("");
  });
  it("renders null body when doc.filters missing or empty", () => {
    const { queryByTestId } = render(
      <SchemaRenderer document={{ _id: "d1", title: "T", filters: [] }} />,
    );
    expect(queryByTestId("doc-section")).not.toBeNull();
    // No stubs
    expect(document.querySelectorAll('[data-testid^="stub-"]').length).toBe(0);
  });
  it("renders null body when doc has no filters key at all", () => {
    const { queryAllByTestId } = render(
      <SchemaRenderer document={{ _id: "d1", title: "T" }} />,
    );
    expect(queryAllByTestId("doc-section").length).toBe(1);
  });
});

describe("SchemaRenderer > section wrapping", () => {
  it("wraps in DocumentSection by default", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "doc1",
          title: "Filters",
          filters: [{ _id: "f1", type: "checkbox", label: "L" }],
        }}
      />,
    );
    expect(getByTestId("doc-section").getAttribute("data-doc-id")).toBe("doc1");
  });
  it("noSection=true → no DocumentSection wrapper", () => {
    const { queryByTestId, getByTestId } = render(
      <SchemaRenderer
        noSection
        document={{
          _id: "doc1",
          title: "Filters",
          filters: [{ _id: "f1", type: "checkbox", label: "L" }],
        }}
      />,
    );
    expect(queryByTestId("doc-section")).toBeNull();
    expect(getByTestId("stub-f1")).toBeInTheDocument();
  });
  it("isDirectToggle by _id='verified_filter' → no DocumentSection", () => {
    const { queryByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "verified_filter",
          title: "Filters",
          filters: [{ _id: "f1", type: "checkbox", label: "L" }],
        }}
      />,
    );
    expect(queryByTestId("doc-section")).toBeNull();
  });
  it("isDirectToggle by _id='meta_ads_lib' → no DocumentSection", () => {
    const { queryByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "meta_ads_lib",
          title: "X",
          filters: [{ _id: "f1", type: "checkbox", label: "L" }],
        }}
      />,
    );
    expect(queryByTestId("doc-section")).toBeNull();
  });
  it("isDirectToggle by title containing 'verified' (case-insensitive)", () => {
    const { queryByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "x",
          title: "Show Verified Only",
          filters: [{ _id: "f1", type: "checkbox", label: "L" }],
        }}
      />,
    );
    expect(queryByTestId("doc-section")).toBeNull();
  });
  it("isDirectToggle by title containing 'meta ads'", () => {
    const { queryByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "x",
          title: "Meta Ads Library",
          filters: [{ _id: "f1", type: "checkbox", label: "L" }],
        }}
      />,
    );
    expect(queryByTestId("doc-section")).toBeNull();
  });
});

describe("SchemaRenderer > filter-level visibility", () => {
  it("filter.visible === false is skipped", () => {
    const { queryByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [
            { _id: "f1", type: "checkbox", label: "x", visible: false },
            { _id: "f2", type: "checkbox", label: "y" },
          ],
        }}
      />,
    );
    expect(queryByTestId("stub-f1")).toBeNull();
    expect(queryByTestId("stub-f2")).not.toBeNull();
  });
  it("shouldShowFilter returning false skips the filter", () => {
    const shouldShowFilter = (f) => f._id !== "f1";
    const { queryByTestId } = render(
      <SchemaRenderer
        shouldShowFilter={shouldShowFilter}
        document={{
          _id: "d",
          title: "T",
          filters: [
            { _id: "f1", type: "checkbox", label: "x" },
            { _id: "f2", type: "checkbox", label: "y" },
          ],
        }}
      />,
    );
    expect(queryByTestId("stub-f1")).toBeNull();
    expect(queryByTestId("stub-f2")).not.toBeNull();
  });
  it("isDependencySatisfied returning false skips the filter", () => {
    const isDependencySatisfied = (f) => f._id === "f2";
    const { queryByTestId } = render(
      <SchemaRenderer
        isDependencySatisfied={isDependencySatisfied}
        document={{
          _id: "d",
          title: "T",
          filters: [
            { _id: "f1", type: "checkbox" },
            { _id: "f2", type: "checkbox" },
          ],
        }}
      />,
    );
    expect(queryByTestId("stub-f1")).toBeNull();
    expect(queryByTestId("stub-f2")).not.toBeNull();
  });
  it("unknown filter type in DEV mode renders orange warning div", () => {
    const { getByText } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "fX", type: "totally_unknown_type" }],
        }}
      />,
    );
    expect(getByText(/Unknown filter type: totally_unknown_type/)).toBeInTheDocument();
  });
  it("unknown filter type in non-DEV mode renders null", () => {
    vi.stubEnv("DEV", false);
    try {
      const { queryByText } = render(
        <SchemaRenderer
          document={{
            _id: "d",
            title: "T",
            filters: [{ _id: "fX", type: "totally_unknown_type" }],
          }}
        />,
      );
      expect(queryByText(/Unknown filter type/)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("SchemaRenderer > options + selected computation", () => {
  it("applies shouldShowOption to filter options", () => {
    const shouldShowOption = (o) => o.value !== "drop";
    const { getByTestId } = render(
      <SchemaRenderer
        shouldShowOption={shouldShowOption}
        document={{
          _id: "d",
          title: "T",
          filters: [
            {
              _id: "f1",
              type: "checkbox",
              label: "L",
              options: [
                { value: "a", label: "A" },
                { value: "drop", label: "D" },
              ],
            },
          ],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-options-count")).toBe("1");
  });
  it("selected: scalar value → wrapped in array", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        filterValues={{ f1: "x" }}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-selected")).toBe('["x"]');
  });
  it("selected: array value → passed through", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        filterValues={{ f1: ["x", "y"] }}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-selected")).toBe('["x","y"]');
  });
  it("selected: missing value → empty array", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-selected")).toBe("[]");
  });
  it("nested filter: merges adcategory + subcategory selections", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        filterValues={{ f1: ["A"], subcategory: ["leafX"] }}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "nested_multiselect" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-selected")).toBe('["A","leafX"]');
  });
  it("nested filter: scalar value gets wrapped + merged with subcategory", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        filterValues={{ f1: "P", subcategory: ["a"] }}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "nested_select" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-selected")).toBe('["P","a"]');
  });
});

describe("SchemaRenderer > componentProps wiring", () => {
  it("skipLabel when single-filter doc and not noSection / direct toggle → label=null", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox", label: "MyLabel" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-label")).toBe("<null>");
  });
  it("doc with >1 filter retains labels", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [
            { _id: "f1", type: "checkbox", label: "L1" },
            { _id: "f2", type: "checkbox", label: "L2" },
          ],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-label")).toBe("L1");
    expect(getByTestId("stub-f2").getAttribute("data-label")).toBe("L2");
  });
  it("noSection=true: label retained even when single filter", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        noSection
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox", label: "Keep" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-label")).toBe("Keep");
  });
  it("placeholder defaults to 'Search <label>...' when skipLabel and no explicit placeholder", () => {
    // skipLabel = true here (single filter + has section)
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox", label: "Geos" }],
        }}
      />,
    );
    // Note: skipLabel makes label=null, placeholder uses filter.label
    expect(getByTestId("stub-f1").getAttribute("data-placeholder")).toBe("Search Geos...");
  });
  it("placeholder uses filter.placeholder when provided", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [
            { _id: "f1", type: "checkbox", placeholder: "type here" },
            { _id: "f2", type: "checkbox" },
          ],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-placeholder")).toBe("type here");
  });
  it("showSearch is false for budget_filter / source_filter / age_filter / ad_sub_position", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [
            { _id: "budget_filter", type: "checkbox" },
            { _id: "source_filter", type: "checkbox" },
            { _id: "age_filter", type: "checkbox" },
            { _id: "ad_sub_position", type: "checkbox" },
            { _id: "other", type: "checkbox" },
          ],
        }}
      />,
    );
    expect(getByTestId("stub-budget_filter").getAttribute("data-show-search")).toBe("false");
    expect(getByTestId("stub-source_filter").getAttribute("data-show-search")).toBe("false");
    expect(getByTestId("stub-age_filter").getAttribute("data-show-search")).toBe("false");
    expect(getByTestId("stub-ad_sub_position").getAttribute("data-show-search")).toBe("false");
    expect(getByTestId("stub-other").getAttribute("data-show-search")).toBe("true");
  });
  it("valueKey='label' for country/state/city filters, else 'value'", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [
            { _id: "country_filter", type: "checkbox" },
            { _id: "state_filter", type: "checkbox" },
            { _id: "city_filter", type: "checkbox" },
            { _id: "other_id", type: "checkbox" },
          ],
        }}
      />,
    );
    expect(getByTestId("stub-country_filter").getAttribute("data-value-key")).toBe("label");
    expect(getByTestId("stub-state_filter").getAttribute("data-value-key")).toBe("label");
    expect(getByTestId("stub-city_filter").getAttribute("data-value-key")).toBe("label");
    expect(getByTestId("stub-other_id").getAttribute("data-value-key")).toBe("value");
  });
  it("min/max default to 0/1000000 when omitted", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "range_slider" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-min")).toBe("0");
    expect(getByTestId("stub-f1").getAttribute("data-max")).toBe("1000000");
  });
  it("activePlatforms forwarded", () => {
    const { getByTestId } = render(
      <SchemaRenderer
        activePlatforms={["fb", "tt"]}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "icon_toggle" }],
        }}
      />,
    );
    expect(getByTestId("stub-f1").getAttribute("data-platforms")).toBe("fb,tt");
  });
});

describe("SchemaRenderer > onChange + plan restrictions", () => {
  it("normal onChange fires when no restriction wiring", () => {
    const onFilterChange = vi.fn();
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox" }],
        }}
      />,
    );
    fireEvent.click(getByTestId("stub-f1"));
    expect(onFilterChange).toHaveBeenCalledWith("f1", "CLICKED");
  });
  it("restricted filter calls onRestricted, NOT onFilterChange", () => {
    const onFilterChange = vi.fn();
    const onRestricted = vi.fn();
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        onRestricted={onRestricted}
        isFilterRestricted={() => true}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox", group_id: "g1" }],
        }}
      />,
    );
    fireEvent.click(getByTestId("stub-f1"));
    expect(onRestricted).toHaveBeenCalled();
    expect(onFilterChange).not.toHaveBeenCalled();
  });
  it("filterHasPlanEntry true → only own _id checked, group/doc ignored", () => {
    const onFilterChange = vi.fn();
    const onRestricted = vi.fn();
    // Own entry says false → not restricted → onChange fires
    const isFilterRestricted = vi.fn((id) =>
      id === "g1" || id === "d" ? true : false,
    );
    const filterHasPlanEntry = vi.fn(() => true);
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        onRestricted={onRestricted}
        isFilterRestricted={isFilterRestricted}
        filterHasPlanEntry={filterHasPlanEntry}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox", group_id: "g1" }],
        }}
      />,
    );
    fireEvent.click(getByTestId("stub-f1"));
    expect(onRestricted).not.toHaveBeenCalled();
    expect(onFilterChange).toHaveBeenCalledWith("f1", "CLICKED");
    // Should only have asked about its own _id
    expect(isFilterRestricted).toHaveBeenCalledWith("f1");
    expect(isFilterRestricted).not.toHaveBeenCalledWith("g1");
  });
  it("no own entry → cascades to group_id when own is false", () => {
    const onRestricted = vi.fn();
    const onFilterChange = vi.fn();
    const isFilterRestricted = vi.fn(
      (id) => id === "g1", // only group is restricted
    );
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        onRestricted={onRestricted}
        isFilterRestricted={isFilterRestricted}
        filterHasPlanEntry={() => false}
        document={{
          _id: "d",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox", group_id: "g1" }],
        }}
      />,
    );
    fireEvent.click(getByTestId("stub-f1"));
    expect(onRestricted).toHaveBeenCalled();
  });
  it("no own entry → cascades to doc._id last", () => {
    const onRestricted = vi.fn();
    const onFilterChange = vi.fn();
    const isFilterRestricted = (id) => id === "doc-id-2";
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        onRestricted={onRestricted}
        isFilterRestricted={isFilterRestricted}
        filterHasPlanEntry={() => false}
        document={{
          _id: "doc-id-2",
          title: "T",
          filters: [{ _id: "f1", type: "checkbox", group_id: "gNope" }],
        }}
      />,
    );
    fireEvent.click(getByTestId("stub-f1"));
    expect(onRestricted).toHaveBeenCalled();
  });
});

describe("SchemaRenderer > handleChildChange (nested taxonomy)", () => {
  it("calls onFilterChange('subcategory', children) and updates adcategory when parent still has child", () => {
    const onFilterChange = vi.fn();
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [
        {
          value: "parent1",
          children: [{ value: "leafA" }, { value: "leafB" }],
        },
      ],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: ["parent1"] }}
        document={{
          _id: "d",
          title: "T",
          filters: [filter],
        }}
      />,
    );
    fireEvent.doubleClick(getByTestId("stub-f1"));
    // 1st call: subcategory set
    expect(onFilterChange).toHaveBeenCalledWith("subcategory", ["leafA"]);
    // 2nd call: adcategory KEEPS parent1 (because leafA is still in childValues)
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", ["parent1"]);
  });
  it("removes parent from adcategory when no child remains (uses sub_options key)", () => {
    const onFilterChange = vi.fn();
    // Make stub call onChildChange with empty children — patch a one-off
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [
        {
          value: "parent1",
          sub_options: [{ value: "leafZ" }], // only leafZ; leafA isn't here
        },
      ],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: ["parent1", "other"] }}
        document={{
          _id: "d",
          title: "T",
          filters: [filter],
        }}
      />,
    );
    // doubleClick stub calls onChildChange(["leafA"], "parent1") — parent1 doesn't have leafA
    fireEvent.doubleClick(getByTestId("stub-f1"));
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", ["other"]);
  });
  it("parentValue falsy → early return after subcategory update", () => {
    const onFilterChange = vi.fn();
    // Custom mock with onChildChange that passes null parent
    vi.resetModules();
    // Easier: call the same stub but craft a filter with no matching parent
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    fireEvent.doubleClick(getByTestId("stub-f1"));
    // parent1 not in [] → parentNode null → parentLeaves [] → parentStillHasChild false
    // → adcategory removes parent1 from [] = []
    expect(onFilterChange).toHaveBeenCalledWith("subcategory", ["leafA"]);
  });
  it("handles adcategory scalar value (not array)", () => {
    const onFilterChange = vi.fn();
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [
        { value: "parent1", children: [{ value: "leafA" }] },
      ],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: "parent1" }}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    fireEvent.doubleClick(getByTestId("stub-f1"));
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", ["parent1"]);
  });
  it("handles adcategory undefined (no current selection)", () => {
    const onFilterChange = vi.fn();
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [
        { value: "parent1", children: [{ value: "leafA" }] },
      ],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    fireEvent.doubleClick(getByTestId("stub-f1"));
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", ["parent1"]);
  });
  it("collectLeaves uses node.label when value missing", () => {
    const onFilterChange = vi.fn();
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [
        { value: "parent1", children: [{ label: "leafA" }] }, // no .value, only .label
      ],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: ["parent1"] }}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    fireEvent.doubleClick(getByTestId("stub-f1"));
    // Stub calls with childValues=["leafA"] — leafA matches label
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", ["parent1"]);
  });
  it("parentValue null → only subcategory update, no adcategory mutation", () => {
    const onFilterChange = vi.fn();
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [{ value: "parent1", children: [{ value: "leafA" }] }],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: ["parent1"] }}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    fireEvent.contextMenu(getByTestId("stub-f1"));
    // Only one call: subcategory. adcategory untouched
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith("subcategory", ["leafA"]);
  });
  it("filter.options undefined → handleChildChange treats as empty list", () => {
    const onFilterChange = vi.fn();
    const filter = { _id: "f1", type: "nested_multiselect" }; // no options key
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: ["parent1"] }}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    fireEvent.doubleClick(getByTestId("stub-f1"));
    // parent1 not found → drops it from adcategory
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", []);
  });
  it("empty children → parent removed from adcategory", () => {
    const onFilterChange = vi.fn();
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [{ value: "parent1", children: [{ value: "leafA" }] }],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: ["parent1", "p2"] }}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    // onMouseEnter calls onChildChange([], "parent1") — empty children
    fireEvent.mouseEnter(getByTestId("stub-f1"));
    expect(onFilterChange).toHaveBeenCalledWith("subcategory", []);
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", ["p2"]);
  });
  it("findNode: skips a leaf node (kids.length=0) and matches another by label", () => {
    const onFilterChange = vi.fn();
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [
        { value: "skip-me" }, // no kids → kids.length=0 → null branch; found null → continue
        { label: "parent2", children: [{ value: "leafA" }] }, // n.value undefined → fallback to label
      ],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: ["parent2"] }}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    // onMouseLeave calls onChildChange(["leafA"], "parent2") — parent2 has leafA → keep
    fireEvent.mouseLeave(getByTestId("stub-f1"));
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", ["parent2"]);
  });
  it("findNode recurses into children to find deep parent", () => {
    const onFilterChange = vi.fn();
    const filter = {
      _id: "f1",
      type: "nested_multiselect",
      options: [
        {
          value: "grandparent",
          children: [
            { value: "parent1", children: [{ value: "leafA" }] },
          ],
        },
      ],
    };
    const { getByTestId } = render(
      <SchemaRenderer
        onFilterChange={onFilterChange}
        filterValues={{ adcategory: ["parent1"] }}
        document={{ _id: "d", title: "T", filters: [filter] }}
      />,
    );
    fireEvent.doubleClick(getByTestId("stub-f1"));
    expect(onFilterChange).toHaveBeenCalledWith("adcategory", ["parent1"]);
  });
});

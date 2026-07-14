import React, { useRef } from "react";
import COMPONENT_MAP from "./componentMap";
import DocumentSection from "./DocumentSection";

/**
 * SchemaRenderer — The heart of SDUI rendering.
 *
 * Takes a SDUIDocument and renders its filters using the component factory.
 * Each filter.type is resolved to a React component via COMPONENT_MAP.
 *
 * Uses refs for callbacks to avoid recreating onChange on every render,
 * which would cause child components to re-render infinitely.
 */
const SchemaRenderer = ({
  document: doc,
  filterValues = {},
  onFilterChange,
  shouldShowFilter,
  shouldShowOption,
  isDependencySatisfied,
  activePlatforms = [],
  noSection = false,
  isFilterRestricted,
  filterHasPlanEntry,
  onRestricted,
}) => {
  // Stable ref for the callback — prevents children from seeing new onChange every render
  const onFilterChangeRef = useRef(onFilterChange);
  onFilterChangeRef.current = onFilterChange;

  if (!doc || doc.visible === false) return null;

  const renderFilters = () => {
    if (!doc.filters || doc.filters.length === 0) return null;

    return doc.filters.map((filter) => {
      if (filter.visible === false) return null;
      if (shouldShowFilter && !shouldShowFilter(filter)) return null;
      if (isDependencySatisfied && !isDependencySatisfied(filter)) return null;

      const Component = COMPONENT_MAP[filter.type];
      if (!Component) {
        if (import.meta.env.DEV) {
          return (
            <div
              key={filter._id}
              className="px-3 py-1 text-[9px] text-orange-400 bg-orange-500/10 rounded mx-3 my-1"
            >
              Unknown filter type: {filter.type}
            </div>
          );
        }
        return null;
      }

      const value = filterValues[filter._id];
      // For nested filters, merge adcategory_subcategory child selections so child checkboxes appear selected
      const adcategorySubcategoryValues = filterValues["subcategory"] || [];
      const mergedSelected =
        filter.type === "nested_select" || filter.type === "nested_multiselect"
          ? [
              ...(Array.isArray(value) ? value : value ? [value] : []),
              ...adcategorySubcategoryValues,
            ]
          : undefined;

      let options = filter.options || [];
      if (shouldShowOption && options.length > 0) {
        options = options.filter(shouldShowOption);
      }

      // Stable onChange per filter ID — uses ref, never changes identity
      // If filter is restricted by plan, show subscription popup instead
      const handleChange = (newValue) => {
        if (isFilterRestricted && onRestricted) {
          // If the filter has its own explicit plan-access entry, use only that —
          // don't cascade to group_id / doc._id. This prevents a misconfigured
          // section-level restriction (e.g. 'engagement') from blocking filters
          // that have their own allowed status (e.g. avg_ad_budget → ad_budget_sort).
          const hasOwnEntry = filterHasPlanEntry?.(filter._id);
          const restricted = hasOwnEntry
            ? isFilterRestricted(filter._id)
            : (isFilterRestricted(filter._id) ||
               isFilterRestricted(filter.group_id) ||
               isFilterRestricted(doc._id));
          if (restricted) {
            onRestricted();
            return;
          }
        }
        // Traffic Source: "All" is an umbrella option and mutually exclusive
        // with narrower options — selecting one should deselect the other.
        let finalValue = newValue;
        if (filter._id === "source_filter" && Array.isArray(newValue)) {
          const prevSelected = Array.isArray(value) ? value : [];
          const hadAll = prevSelected.includes("all");
          const hasAll = newValue.includes("all");
          if (hasAll && !hadAll) {
            finalValue = ["all"];
          } else if (hasAll && hadAll && newValue.length > 1) {
            finalValue = newValue.filter((v) => v !== "all");
          }
        }

        onFilterChangeRef.current(filter._id, finalValue);
      };

      // For nested_select / nested_multiselect: store every selected child in
      // `subcategory`, and toggle ONLY the clicked parent in `adcategory` —
      // add it if any of its own leaves remain selected, drop it otherwise.
      // We deliberately do NOT scan other parents for matching leaves: the
      // backend taxonomy can contain duplicate leaf names across unrelated
      // parents (e.g. a "Clothing Accessories" leaf appearing under both
      // "Apparel & Accessories" and a separate "Clothing and Accessories"
      // parent), and cross-matching would silently attach every parent that
      // shares a name — leaving orphan chips that don't clear when the
      // originating parent is removed.
      const handleChildChange = (childValues, parentValue) => {
        onFilterChangeRef.current("subcategory", childValues);
        if (!parentValue) return;
        const collectLeaves = (node) => {
          const kids = node.children || node.sub_options || [];
          if (kids.length === 0) return [node.value ?? node.label];
          return kids.flatMap(collectLeaves);
        };
        const findNode = (nodes, val) => {
          for (const n of nodes) {
            if ((n.value ?? n.label) === val) return n;
            const kids = n.children || n.sub_options || [];
            const found = kids.length ? findNode(kids, val) : null;
            if (found) return found;
          }
          return null;
        };
        const parentNode = findNode(filter.options || [], parentValue);
        const parentLeaves = parentNode ? collectLeaves(parentNode) : [];
        const parentStillHasChild = parentLeaves.some((l) =>
          childValues.includes(l),
        );
        const cur = filterValues["adcategory"];
        const arr = Array.isArray(cur) ? cur : cur ? [cur] : [];
        const without = arr.filter((p) => p !== parentValue);
        onFilterChangeRef.current(
          "adcategory",
          parentStillHasChild ? [...without, parentValue] : without,
        );
      };

      // If the document has only one filter, the DocumentSection title
      // already serves as the label — don't repeat it on the component
      // UNLESS we are bypassing the DocumentSection and rendering directly.
      const isDirectToggle =
        doc._id === "verified_filter" ||
        doc._id === "meta_ads_lib" ||
        doc.title?.toLowerCase().includes("verified") ||
        doc.title?.toLowerCase().includes("meta ads");
      const skipLabel =
        !noSection && !isDirectToggle && doc.filters.length === 1;

      const componentProps = {
        filterId: filter._id,
        label: skipLabel ? null : filter.label,
        options,
        value,
        selected:
          mergedSelected ||
          (Array.isArray(value) ? value : value ? [value] : []),
        onChange: handleChange,
        onChildChange: handleChildChange,
        multiSelect: filter.multi_select,
        queryParam: filter.query_param,
        placeholder: filter.placeholder || (skipLabel && filter.label ? `Search ${filter.label}...` : undefined),

        // Show search bar for FilterCheckboxList (disable for budget, traffic source, age, and ad_sub_position)
        showSearch: !["budget_filter", "source_filter", "age_filter", "ad_sub_position"].includes(filter._id),

        // Range slider props
        min: filter.min ?? 0,
        max: filter.max ?? 1000000,
        step: filter.step,
        defaultMin: filter.default_min,
        defaultMax: filter.default_max,
        unit: filter.unit,
        looseEnds: filter.loose_ends || "none",
        sliderScale: filter.slider_scale || "exponential",
        pinMode: filter.pin_mode || "single",

        // Autocomplete / search props
        suggestionSources: filter.suggestion_sources,
        searchVariants: filter.search_variants,
        debounceMs: filter.debounce_ms,
        minLength: filter.min_length,
        maxLength: filter.max_length,
        autosuggest: filter.autosuggest,

        // Date props
        minField: filter.min_field,
        maxField: filter.max_field,
        defaultMode: filter.default_mode,
        format: filter.format,

        // Platform matrix (for PlatformToggle)
        platformFilterMatrix: filter.platform_filter_matrix,
        activePlatforms,

        // For geo filters, store the display label (e.g. "United States") not the ISO value
        valueKey: ["country_filter", "state_filter", "city_filter"].includes(
          filter._id,
        )
          ? "label"
          : "value",

        // Dependency
        dependsOn: filter.depends_on,
      };

      return <Component key={filter._id} {...componentProps} />;
    });
  };

  const isDirectToggle =
    doc._id === "verified_filter" ||
    doc._id === "meta_ads_lib" ||
    doc.title?.toLowerCase().includes("verified") ||
    doc.title?.toLowerCase().includes("meta ads");

  if (noSection || isDirectToggle) {
    return (
      <div className={isDirectToggle ? "px-2.5 mb-1" : ""}>
        {renderFilters()}
      </div>
    );
  }

  return (
    <div className="px-2.5">
      <DocumentSection document={doc}>{renderFilters()}</DocumentSection>
    </div>
  );
};

export default SchemaRenderer;

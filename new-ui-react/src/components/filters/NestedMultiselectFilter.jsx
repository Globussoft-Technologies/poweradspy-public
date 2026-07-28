import { useState, useMemo } from "react";
import { Check, ChevronRight, Search, Minus } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

/**
 * NestedMultiselectFilter — Hierarchical tree with expandable children.
 * Accepts SDUI options with `children[]` (or legacy `sub_options[]`).
 */
const NestedMultiselectFilter = ({
  options = [],
  selected = [],
  label,
  onChange,
  onChildChange,
  maxItems,
  accented = false,
}) => {
  const { theme } = useTheme();
  const isLightTheme = theme === "light";
  const [expandedParents, setExpandedParents] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  // Nested AI filters need a distinct but theme-aware accent so the cluster
  // still feels grouped without overwhelming the popup in light mode.
  const accentPalette = isLightTheme
    ? {
        section: "mb-2.5 border-[#3762c1]/15 bg-[#3762c1]/5",
        label: "text-[#335296]",
        badge: "border-[#3759a3]/25 bg-[#3762c1]/8 text-[#335296]",
        input: "border-[#3762c1]/20 focus:border-[#3762c1]/55 focus:bg-[#3762c1]/5",
        hover: "hover:bg-[#3762c1]/5",
        chevron: "text-[#6b99ff] group-hover:text-[#335296]",
        checkedBox: "bg-[#335296] border-[#335296]",
        uncheckedBox: "border-[#93a4c8] group-hover:border-[#335296]",
        checkedText: "text-[#335296] font-medium",
        more: "text-[#335296] hover:text-[#6b99ff]",
        max: "text-[#d97706]",
        destructiveBtn: "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 hover:text-red-800",
      }
    : {
        section: "mb-2.5 border-[#f5c86a]/15 bg-[#f5c86a]/5",
        label: "text-[#f5d88d]",
        badge: "border-[#f5c86a]/20 bg-[#f5c86a]/8 text-[#f5d88d]/90",
        input: "border-[#f5c86a]/20 focus:border-[#f5c86a]/55 focus:bg-[#f5c86a]/5",
        hover: "hover:bg-[#f5c86a]/5",
        chevron: "text-[#f5c86a]/70 group-hover:text-[#ffd77f]",
        checkedBox: "bg-[#7f641f] border-[#f5c86a]/70",
        uncheckedBox: "border-[#f5c86a]/20 group-hover:border-[#f5c86a]/50",
        checkedText: "text-[#f5d88d] font-medium",
        more: "text-[#f5c86a] hover:text-[#ffd77f]",
        max: "text-[#f5c86a]",
        destructiveBtn: "border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-200",
      };

  // Sort parents alphabetically by label — the SDUI options come back in
  // backend-defined order (rank / insertion), which isn't useful for the
  // user when scanning a long category list. Case- and locale-aware so
  // accented labels collate sensibly.
  const sortedOptions = useMemo(() => {
    return [...options].sort((a, b) =>
      (a.label || "").localeCompare(b.label || "", undefined, {
        sensitivity: "base",
      }),
    );
  }, [options]);

  // Filter options by search term — show parent if it or any child matches
  const filteredOptions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return sortedOptions;
    return sortedOptions.reduce((acc, option) => {
      const childOptions = option.children || option.sub_options || [];
      const parentMatches = (option.label || "").toLowerCase().includes(q);
      const matchingChildren = childOptions.filter((c) =>
        (c.label || "").toLowerCase().includes(q)
      );
      if (parentMatches || matchingChildren.length > 0) {
        acc.push({ ...option, _searchChildren: matchingChildren.length > 0 ? matchingChildren : childOptions });
      }
      return acc;
    }, []);
  }, [sortedOptions, searchTerm]);

  // Count selected category groups instead of raw values so a parent plus its
  // auto-selected child still reads as a single user-facing selection.
  const selectedGroupCount = useMemo(() => {
    const selectedSet = new Set(Array.isArray(selected) ? selected : []);
    const nodeIsSelected = (node) => {
      const nodeValue = node.value ?? node.label;
      if (selectedSet.has(nodeValue)) return true;
      const childOptions = node.children || node.sub_options || [];
      return childOptions.some(nodeIsSelected);
    };
    return sortedOptions.reduce(
      (count, parent) => count + (nodeIsSelected(parent) ? 1 : 0),
      0,
    );
  }, [selected, sortedOptions]);

  // Auto-expand parents that have matching children during search
  const effectiveExpanded = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return expandedParents;
    const autoExpanded = new Set(expandedParents);
    filteredOptions.forEach((opt) => {
      const childOptions = opt.children || opt.sub_options || [];
      const hasMatchingChild = childOptions.some((c) =>
        (c.label || "").toLowerCase().includes(q)
      );
      if (hasMatchingChild) autoExpanded.add(opt._id ?? opt.value);
    });
    return autoExpanded;
  }, [searchTerm, filteredOptions, expandedParents]);

  const toggleParent = (parentId) => {
    const newExpanded = new Set(expandedParents);
    if (newExpanded.has(parentId)) newExpanded.delete(parentId);
    else newExpanded.add(parentId);
    setExpandedParents(newExpanded);
  };

  // Recursively collect every leaf value beneath a parent (nodes that have no
  // further children). Used by the "Select all" affordance.
  const collectLeafValues = (parent) => {
    const kids = parent.children || parent.sub_options || [];
    if (kids.length === 0) return [parent.value ?? parent.label];
    return kids.flatMap(collectLeafValues);
  };

  const toggle = (optValue, parentValue) => {
    if (maxItems && selected.length >= maxItems && !selected.includes(optValue))
      return;

    if (parentValue && onChildChange) {
      // This is a child item — only track child values, not parent categories
      const currentChildren = selected.filter((s) => s !== parentValue);
      const newChildren = currentChildren.includes(optValue)
        ? currentChildren.filter((s) => s !== optValue)
        : [...currentChildren, optValue];
      onChildChange(newChildren, parentValue);
    } else {
      const newSelected = selected.includes(optValue)
        ? selected.filter((s) => s !== optValue)
        : [...selected, optValue];
      onChange(newSelected);
    }
  };

  const clearAll = () => {
    onChange([]);
    onChildChange?.([], null);
  };

  // Toggle "Select all" for one parent — adds every leaf under it, or clears
  // them if already all selected. Selections from OTHER parents must survive
  // (categories are multi-select across parents), so we splice only this
  // parent's leaves in/out of the merged selection. Honours maxItems by
  // capping the bulk add against whatever capacity remains.
  const toggleSelectAll = (parent) => {
    if (!onChildChange) return;
    const parentValue = parent.value ?? parent.label;
    const leaves = collectLeafValues(parent);
    const allSelected = leaves.every((v) => selected.includes(v));
    // `selected` is the merged parent + child state supplied by SchemaRenderer.
    // Never feed the parent marker back into the child filter when bulk
    // selecting/deselecting, or it survives as an orphan numeric filter chip.
    const otherSelected = selected.filter(
      (v) => v !== parentValue && !leaves.includes(v),
    );
    if (allSelected) {
      onChildChange(otherSelected, parentValue);
    } else {
      const capacity = maxItems
        ? Math.max(0, maxItems - otherSelected.length)
        : leaves.length;
      const toAdd = leaves.slice(0, capacity);
      onChildChange([...otherSelected, ...toAdd], parentValue);
    }
  };

  const renderOption = (option, level = 0, parentValue = null) => {
    const optValue = option.value ?? option.label;
    const optId = option._id ?? optValue;
    const isSelected = selected.includes(optValue);
    // Use _searchChildren when searching so only matching children show
    const childOptions = option._searchChildren || option.children || option.sub_options || [];
    const hasChildren = childOptions.length > 0;
    const isExpanded = effectiveExpanded.has(optId);

    // Tri-state for the parent's "Select all": none / some / all leaves selected
    let allLeavesSelected = false;
    let someLeavesSelected = false;
    if (hasChildren) {
      const leaves = collectLeafValues(option);
      allLeavesSelected = leaves.length > 0 && leaves.every((v) => selected.includes(v));
      someLeavesSelected = !allLeavesSelected && leaves.some((v) => selected.includes(v));
    }

    // Every parent with at least one child gets a "Select all" checkbox —
    // visual consistency across the list matters more than the slight
    // redundancy of a bulk toggle for a single-child group.
    const showSelectAll = hasChildren;

    return (
      <div key={optId}>
        <div
          className={`w-full flex items-center gap-2.5 py-1 text-[12px] group rounded-md px-1 transition-colors ${accented ? accentPalette.hover : ""} ${level > 0 ? "ml-4" : ""}`}
        >
          <button
            onClick={() =>
              hasChildren ? toggleParent(optId) : toggle(optValue, parentValue)
            }
            className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
          >
            {hasChildren && (
              <ChevronRight
                size={10}
                className={`transition-transform shrink-0 ${accented ? accentPalette.chevron : "text-theme-text-muted group-hover:text-white"} ${isExpanded ? "rotate-90" : ""}`}
              />
            )}
            {!hasChildren && (
              <div
                className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${isSelected ? (accented ? accentPalette.checkedBox : "bg-[#335296] border-[#335296]") : (accented ? accentPalette.uncheckedBox : "border-white/30 group-hover:border-theme-text")}`}
              >
                {isSelected && (
                  <Check size={8} strokeWidth={3} className="text-white" />
                )}
              </div>
            )}
            <span
              className={`transition-colors flex-1 pr-1 truncate ${isSelected ? (accented ? accentPalette.checkedText : "text-[#7899e0] font-medium") : "text-theme-text-muted group-hover:text-theme-text"}`}
            >
              {option.label}
            </span>
          </button>

          {/* Tri-state "Select all" — only when 2+ children. Toggles every
              leaf under this parent without expanding the section. */}
          {showSelectAll && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSelectAll(option);
              }}
              title={
                allLeavesSelected
                  ? "Deselect all"
                  : someLeavesSelected
                    ? "Select remaining"
                    : "Select all"
              }
              className="shrink-0 p-0.5 -mr-0.5 rounded hover:bg-white/5 transition-colors"
            >
              <div
                className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${
                  allLeavesSelected || someLeavesSelected
                    ? accented
                      ? "bg-[#7f641f] border-[#f5c86a]/70"
                      : "bg-[#335296] border-[#335296]"
                    : accented
                      ? "border-[#f5c86a]/20 hover:border-[#f5c86a]/50"
                      : "border-white/30 hover:border-theme-text"
                }`}
              >
                {allLeavesSelected && (
                  <Check size={8} strokeWidth={3} className="text-white" />
                )}
                {someLeavesSelected && (
                  <Minus size={8} strokeWidth={3} className="text-white" />
                )}
              </div>
            </button>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div>
            {childOptions.map((child) =>
              renderOption(child, level + 1, optValue),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`px-3 py-2 rounded-xl border ${accented ? accentPalette.section : "border-transparent"}`}>
      {label && (
        <div className={`mb-1.5 text-[10px] font-bold uppercase tracking-widest ${accented ? accentPalette.label : "text-theme-text-secondary"}`}>
          {label}
        </div>
      )}
      {/* Search input */}
      {accented && selectedGroupCount > 0 && (
        <div className="mb-2 flex w-full items-center">
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${accentPalette.badge}`}>
              {selectedGroupCount} selected
            </span>
            <button
              type="button"
              onClick={clearAll}
              className={`rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors ${accentPalette.destructiveBtn}`}
            >
              Deselect all
            </button>
          </div>
        </div>
      )}
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted" />
        <input
          type="text"
          placeholder="Search categories..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={`w-full bg-theme-card border rounded-md pl-7 pr-3 py-1.5 text-[11px] text-theme-text placeholder:text-theme-text-muted focus:outline-none transition-colors ${accented ? accentPalette.input : "border-theme-border focus:border-[#3759a3]/50 focus:bg-theme-surface"}`}
        />
      </div>
      <div>
        <div className="space-y-1 max-h-[220px] overflow-y-auto scrollbar-hide pr-1">
          {filteredOptions.length > 0
            ? filteredOptions.map((option) => renderOption(option))
            : searchTerm.trim() && (
                <div className="text-[10px] text-theme-text-muted italic py-1">
                  No categories found.
                </div>
              )}
        </div>
        {maxItems && selected.length >= maxItems && (
          <div className={`text-[10px] mt-1 ${accented ? accentPalette.max : "text-orange-400"}`}>
            Maximum {maxItems} items selected
          </div>
        )}
      </div>
    </div>
  );
};

export default NestedMultiselectFilter;

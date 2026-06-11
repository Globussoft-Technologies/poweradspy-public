import { useState, useMemo } from "react";
import { Check, ChevronRight, Search, Minus } from "lucide-react";

/**
 * NestedMultiselectFilter — Hierarchical tree with expandable children.
 * Accepts SDUI options with `children[]` (or legacy `sub_options[]`).
 */
const NestedMultiselectFilter = ({
  options = [],
  selected = [],
  onChange,
  onChildChange,
  maxItems,
}) => {
  const [expandedParents, setExpandedParents] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState("");

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
    const otherSelected = selected.filter((v) => !leaves.includes(v));
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
          className={`w-full flex items-center gap-2.5 py-1 text-[12px] group ${level > 0 ? "ml-4" : ""}`}
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
                className={`text-theme-text-muted group-hover:text-white transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}
              />
            )}
            {!hasChildren && (
              <div
                className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "bg-[#335296] border-[#335296]" : "border-white/30 group-hover:border-theme-text"}`}
              >
                {isSelected && (
                  <Check size={8} strokeWidth={3} className="text-white" />
                )}
              </div>
            )}
            <span
              className={`transition-colors flex-1 pr-1 truncate ${isSelected ? "text-[#7899e0] font-medium" : "text-theme-text-muted group-hover:text-theme-text"}`}
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
                    ? "bg-[#335296] border-[#335296]"
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
    <div className="px-3 py-2">
      {/* Search input */}
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted" />
        <input
          type="text"
          placeholder="Search categories..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-theme-card border border-theme-border rounded-md pl-7 pr-3 py-1.5 text-[11px] text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-[#3759a3]/50 focus:bg-theme-surface transition-colors"
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
          <div className="text-[10px] text-orange-400 mt-1">
            Maximum {maxItems} items selected
          </div>
        )}
      </div>
    </div>
  );
};

export default NestedMultiselectFilter;

import { useState, useMemo } from "react";
import { Search, Check } from "lucide-react";

/**
 * ComboboxFilter — Searchable dropdown for language, country, etc.
 * Supports single and multi-select.
 */
const ComboboxFilter = ({
  label,
  options = [],
  selected = [],
  onChange,
  multiSelect = true,
  placeholder,
  valueKey = "value",
}) => {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((opt) => {
      const optLabel = (opt.label ?? opt).toString().toLowerCase();
      return optLabel.includes(q);
    });
  }, [options, search]);

  const getStoredValue = (opt) =>
    valueKey === "label" ? (opt.label ?? opt) : (opt.value ?? opt.label ?? opt);

  const toggle = (storedVal) => {
    if (multiSelect) {
      const newSelected = selected.includes(storedVal)
        ? selected.filter((s) => s !== storedVal)
        : [...selected, storedVal];
      onChange(newSelected);
    } else {
      onChange(selected.includes(storedVal) ? [] : [storedVal]);
    }
  };

  return (
    <div className="px-3 py-2">
      <div>
        <div className="relative mb-2">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted"
          />
          <input
            type="text"
            placeholder={placeholder || (label ? `Search ${label}...` : 'Search...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-theme-card border border-theme-border rounded-md pl-7 pr-3 py-1.5 text-[11px] text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-[#3759a3]/50 transition-colors"
          />
        </div>

        <div className="max-h-[160px] overflow-y-auto scrollbar-hide space-y-0.5">
          {filtered.length > 0 ? (
            filtered.map((opt) => {
              const value = getStoredValue(opt);
              const optLabel = opt.label ?? opt;
              const isActive = selected.includes(value);
              return (
                <button
                  key={opt.value ?? opt.label ?? opt}
                  onClick={() => toggle(value)}
                  className="w-full flex items-center gap-2.5 py-1 text-[11px] group"
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${isActive ? "bg-[#335296] border-[#335296]" : "border-theme-text-secondary group-hover:border-theme-text"}`}
                  >
                    {isActive && (
                      <Check size={8} strokeWidth={3} className="text-white" />
                    )}
                  </div>
                  <span
                    className={`transition-colors text-left ${isActive ? "text-[#7899e0] font-medium" : "text-theme-text-muted group-hover:text-theme-text"}`}
                  >
                    {optLabel}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="text-[10px] text-theme-text-muted italic py-1">
              No matches
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComboboxFilter;

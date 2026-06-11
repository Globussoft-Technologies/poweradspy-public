import { useState, useEffect } from "react";
import { Check, Search, Loader2 } from "lucide-react";
import { useDebounce } from "../../hooks/useDebounce";

const CategorySearchFilter = ({ label, options, selected, onChange }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [apiCategories, setApiCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Debounce search term by wait time
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    // Fetch suggestions when debounced term changes
    const fetchCategories = async () => {
      if (!debouncedSearchTerm.trim()) {
        setApiCategories([]);
        return;
      }

      setIsLoading(true);
      try {
        const pasBase = import.meta.env.VITE_PAS_API_BASE_URL || "";
        const response = await fetch(
          `${pasBase}/api/v1/common/catsearch`,
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: debouncedSearchTerm,
              top_k: 10,
            }),
          },
        );

        if (response.ok) {
          const data = await response.json();
          if (data && Array.isArray(data.matches)) {
            // Deduplicate based on major_category > sub_category
            const uniqueCats = new Set();
            data.matches.forEach((match) => {
              if (match && match.major_category && match.sub_category) {
                uniqueCats.add(
                  `${match.major_category} > ${match.sub_category}`,
                );
              }
            });
            setApiCategories(Array.from(uniqueCats));
          } else {
            setApiCategories([]);
          }
        }
      } catch (error) {
        console.error("Error fetching category suggestions:", error);
        setApiCategories([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCategories();
  }, [debouncedSearchTerm]);

  const toggle = (opt) =>
    onChange(
      selected.includes(opt)
        ? selected.filter((s) => s !== opt)
        : [...selected, opt],
    );

  // Choose what to display based on whether there's a search term
  const displayOptions = debouncedSearchTerm.trim()
    ? apiCategories
    : options.slice(0, 10);
  const hasSearch = debouncedSearchTerm.trim().length > 0;

  return (
    <div className="px-3 py-2">
      <div className="flex flex-col gap-2">
        {/* Search Bar */}
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted"
          />
          <input
            type="text"
            placeholder="Search categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-theme-card border border-theme-border rounded-md pl-7 pr-3 py-1.5 text-[11px] text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-[#3759a3]/50 focus:bg-theme-surface transition-colors"
          />
          {isLoading && (
            <Loader2
              size={12}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6b99ff] animate-spin"
            />
          )}
        </div>

        {/* Options List */}
        <div className="space-y-1 mt-1 max-h-[180px] overflow-y-auto scrollbar-hide pr-1">
          {displayOptions.length > 0 ? (
            displayOptions.map((opt) => {
              const on = selected.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggle(opt)}
                  className="w-full flex items-center gap-2.5 py-1 text-[11px] group"
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${on ? "bg-[#335296] border-[#335296]" : "border-theme-text-secondary group-hover:border-theme-text"}`}
                  >
                    {on && (
                      <Check size={8} strokeWidth={3} className="text-white" />
                    )}
                  </div>
                  <span
                    className={`transition-colors text-left flex-1 items-start ${on ? "text-[#7899e0] font-medium" : "text-theme-text-muted group-hover:text-theme-text"} truncate`}
                  >
                    {opt}
                  </span>
                </button>
              );
            })
          ) : hasSearch && !isLoading ? (
            <div className="text-[10px] text-theme-text-muted italic py-1 px-1">
              No matches found.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default CategorySearchFilter;

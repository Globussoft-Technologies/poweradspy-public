import React, { useState, useEffect, useRef } from "react";
import { Search, Loader2, Sparkles, ChevronDown, Play, X } from "lucide-react";
import { useDebounce } from "../../hooks/useDebounce";

/**
 * AutocompleteFilter — SDUI-driven search input with API-powered suggestions.
 *
 * Driven by `suggestion_sources[]` from the SDUI config.
 * Each source defines: endpoint, method, env_key, response_key, display_field,
 * min_chars_to_trigger, on_select_action.
 */
const AutocompleteFilter = ({
  label,
  placeholder,
  value,
  onChange,
  onSearch,
  onClear,
  suggestionSources = [],
  debounceMs = 300,
  minLength = 3,
  onSelectCategory,
  minimal = false,
}) => {
  const [searchQuery, setSearchQuery] = useState(value || "");
  const [wordSuggestions, setWordSuggestions] = useState([]);
  const [catSuggestions, setCatSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionRef = useRef(null);
  const suppressNextFetchRef = useRef(false);
  // Only show suggestions when the user actually typed — not on programmatic value sync (e.g. page load/refresh)
  const userTypedRef = useRef(false);

  const lastWord = searchQuery.trim().split(/\s+/).pop() || "";
  const debouncedLastWord = useDebounce(lastWord, debounceMs);

  // Sync external value changes — mark as NOT user-typed so suggestions don't fire
  useEffect(() => {
    if (value !== undefined && value !== searchQuery) {
      userTypedRef.current = false;
      setSearchQuery(value || "");
    }
  }, [value]);

  // Fetch suggestions from SDUI-configured sources
  useEffect(() => {
    if (debouncedLastWord.length < (minLength || 3)) {
      setWordSuggestions([]);
      setCatSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Don't fetch suggestions on programmatic value updates (page load / Redux sync)
    if (!userTypedRef.current) {
      return;
    }

    if (suppressNextFetchRef.current) {
      suppressNextFetchRef.current = false;
      setWordSuggestions([]);
      setCatSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const fetchAll = async () => {
      setIsLoading(true);
      try {
        const sortedSources = [...suggestionSources].sort(
          (a, b) => (a.rank ?? 0) - (b.rank ?? 0),
        );

        for (const source of sortedSources) {
          const baseUrl = source.env_key
            ? import.meta.env[source.env_key] || ""
            : "";
          if (!baseUrl && source.env_key) continue;

          try {
            let res;
            if (source.method === "GET") {
              // Build query params from query_param_config (with defaults) or fall back to query_params
              const paramConfigs = source.query_param_config || [];
              const rawParams =
                paramConfigs.length > 0
                  ? paramConfigs.reduce((acc, pc) => {
                      let val =
                        source.query_params &&
                        source.query_params[pc.name] !== undefined
                          ? source.query_params[pc.name]
                          : pc.default;
                      // Replace template variable "lastWord" with actual search term
                      if (val === "lastWord") val = debouncedLastWord;
                      if (val !== undefined && val !== null) acc[pc.name] = val;
                      return acc;
                    }, {})
                  : { ...(source.query_params || {}) };

              // Ensure query param is always present
              if (
                rawParams.query === "lastWord" ||
                rawParams.query === undefined
              ) {
                rawParams.query = debouncedLastWord;
              }

              const params = new URLSearchParams();
              Object.entries(rawParams).forEach(([k, v]) =>
                params.set(k, String(v)),
              );

              const endpoint = source.endpoint.replace(
                "{query}",
                encodeURIComponent(debouncedLastWord),
              );
              const finalUrl = `${baseUrl}${endpoint}?${params.toString()}`;
              res = await fetch(finalUrl);
            } else {
              const body = { ...(source.request_body || {}) };
              // Replace template variables in body
              if (body.query !== undefined)
                /* v8 ignore next -- the fetch is gated on debouncedLastWord (derived from searchQuery), so searchQuery is always truthy here; the `|| debouncedLastWord` fallback is defensive */
                body.query = searchQuery || debouncedLastWord;
              if (body.top_k === undefined) body.top_k = 5;
              res = await fetch(`${baseUrl}${source.endpoint}`, {
                method: "POST",
                headers: {
                  accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
              });
            }

            if (!res.ok) continue;
            const data = await res.json();

            // Extract results using response_key and display_field
            const items = data[source.response_key] || data;
            if (!Array.isArray(items)) continue;

            if (source.on_select_action === "setSelCategories") {
              // Category suggestions
              const uniqueCats = [];
              const seen = new Set();
              items.forEach((m) => {
                if (!m) return;
                const major = m.major_category || "Category";
                const sub = m.sub_category || "Subcategory";
                const key = `${major} > ${sub}`;
                if (!seen.has(key)) {
                  uniqueCats.push({ major, sub, display: key, word: sub });
                  seen.add(key);
                }
              });
              setCatSuggestions(uniqueCats);
            } else {
              // Word suggestions
              const words = items
                .map((item) => {
                  if (typeof item === "string") return item;
                  if (
                    item &&
                    source.display_field &&
                    typeof item[source.display_field] === "string"
                  )
                    return item[source.display_field];
                  if (item && typeof item.word === "string") return item.word;
                  return null;
                })
                .filter(Boolean);
              setWordSuggestions(words);
            }
          } catch {
            // Individual source failure is non-fatal
          }
        }

        setShowSuggestions(true);
      } catch {
        setWordSuggestions([]);
        setCatSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAll();
  }, [debouncedLastWord]);

  // Close on outside click
  useEffect(() => {
    const handle = (e) => {
      if (
        suggestionRef.current &&
        e.target instanceof Node &&
        !suggestionRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const handleSelectWord = (word) => {
    suppressNextFetchRef.current = true;
    const words = searchQuery.trim().split(/\s+/);
    /* v8 ignore next -- split() always yields at least one element, so words.length is always > 0; the guard is defensive */
    if (words.length > 0) words.pop();
    const prefix = words.length > 0 ? words.join(" ") + " " : "";
    const newQuery = prefix + word + " ";
    setSearchQuery(newQuery);
    onChange(newQuery.trim());
    setWordSuggestions([]);
    setCatSuggestions([]);
    setShowSuggestions(false);
    if (onSearch) onSearch(newQuery.trim());
  };

  const handleSelectCategory = (cat) => {
    suppressNextFetchRef.current = true;
    if (onSelectCategory) {
      // Pass the full split { major, sub, display } so the caller can decide
      // how to use each part — the searchbar should populate with `sub`
      // (e.g. "Casinos") while the major category goes into the adCategory
      // filter (e.g. ["Gambling"]). Sending only `display` ("Gambling > Casinos")
      // forced the backend to receive a non-existent category string.
      onSelectCategory(cat);
    }
    setWordSuggestions([]);
    setCatSuggestions([]);
    setShowSuggestions(false);
  };

  const handleInputChange = (e) => {
    userTypedRef.current = true;
    setSearchQuery(e.target.value);
    onChange(e.target.value);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      setShowSuggestions(false);
      if (onSearch) onSearch(searchQuery.trim());
    }
  };

  return (
    <div className="" ref={suggestionRef}>
      <div
        className={
          minimal
            ? "flex-1 flex items-center"
            : "flex items-center bg-theme-card border border-theme-border rounded-xl overflow-hidden focus-within:border-[#3759a3]/50 transition-all"
        }
      >
        <input
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() =>
            (wordSuggestions.length > 0 || catSuggestions.length > 0) &&
            setShowSuggestions(true)
          }
          onBlur={() => setTimeout(() => {
            setWordSuggestions([]);
            setCatSuggestions([]);
            setShowSuggestions(false);
          }, 150)}
          placeholder={placeholder || "Search..."}
          className="w-full bg-transparent px-3 py-1.5 2xl:py-2 outline-none text-xs 2xl:text-sm placeholder:text-white/60 text-gray-200"
        />
        <div className="flex items-center gap-1 pr-2">
          {isLoading && (
            <Loader2 size={14} className="animate-spin text-[#3759a3]" />
          )}
          {searchQuery.trim().length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                onChange("");
                if (onClear) onClear();
                setWordSuggestions([]);
                setCatSuggestions([]);
                setShowSuggestions(false);
              }}
              className="p-0.5 hover:text-red-400 transition-colors"
            >
              <X
                size={14}
                className="text-theme-text-muted hover:text-red-400"
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onChange(searchQuery.trim());
              setShowSuggestions(false);
              if (onSearch) onSearch(searchQuery.trim());
            }}
            className={`p-1.5 rounded-md transition-all duration-200 ${
              searchQuery.trim().length > 0
                ? "bg-[#335296] text-white shadow-md shadow-[#3759a3]/30 hover:bg-[#3f63b3] animate-pulse"
                : "text-theme-text-muted hover:text-[#6b99ff]"
            }`}
          >
            <Search
              size={16}
              className={searchQuery.trim().length > 0 ? "text-white" : "text-theme-text-muted hover:text-[#6b99ff]"}
            />
          </button>
        </div>
      </div>

      {showSuggestions &&
        (wordSuggestions.length > 0 || catSuggestions.length > 0) && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-theme-surface border border-theme-border rounded-xl shadow-2xl z-[100] py-2 2xl:py-3 overflow-hidden">
            {wordSuggestions.map((word, idx) => (
              <button
                key={`word-${idx}`}
                onClick={() => handleSelectWord(word)}
                className="w-full text-left px-4 py-1.5 text-[13px] text-gray-300 hover:bg-theme-text/[0.04] transition-colors flex items-center gap-3 group"
              >
                <Search
                  size={12}
                  className="text-theme-text-muted group-hover:text-[#6b99ff]"
                />
                <span>{word}</span>
              </button>
            ))}

            {wordSuggestions.length > 0 && catSuggestions.length > 0 && (
              <div className="my-1.5 flex items-center px-4 gap-3">
                <div className="h-[2px] flex-1 bg-gradient-to-r from-transparent via-[#333] to-transparent" />
                <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">
                  Categories
                </span>
                <div className="h-[2px] flex-1 bg-gradient-to-r from-transparent via-[#333] to-transparent" />
              </div>
            )}

            {catSuggestions.map((c, idx) => (
              <button
                key={`cat-${idx}`}
                onClick={() => handleSelectCategory(c)}
                className="w-full text-left px-4 py-2 2xl:text-[16px] text-xs hover:bg-[#33529630] transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 rounded bg-theme-border group-hover:bg-[#33529640] text-white/50 group-hover:text-[#6b99ff] transition-colors">
                      <Sparkles size={11} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-white/50 text-[10px] 2xl:text-[12px] group-hover:text-[#7994d5] transition-colors flex items-center gap-1">
                        {c.major}{" "}
                        <ChevronDown
                          className="-rotate-90 opacity-80 size-3 2xl:size-3.5"
                        />{" "}
                        {c.sub}
                      </span>
                    </div>
                  </div>
                  <Play
                    size={10}
                    fill="currentColor"
                    className="text-theme-text-muted group-hover:text-[#7994d5]"
                  />
                </div>
              </button>
            ))}
          </div>
        )}
    </div>
  );
};

export default AutocompleteFilter;

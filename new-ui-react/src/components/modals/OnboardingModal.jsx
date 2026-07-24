import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, Search, TrendingUp, Users, Clock, Loader2, ArrowRight, Sparkles, Globe2, Swords, ChevronDown, Check } from "lucide-react";
import { searchOnboardingCategory, saveOnboarding, fetchOnboardingPreview, fetchCompetitorSuggestions } from "../../services/api";
import { fetchSDUIConfig } from "../../services/sduiService";
import { findCountryOptions } from "../../utils/countryFilter";
import { dismissOnboardingForUserId } from "../../hooks/useAuth";

const MAX_COMPETITORS = 3;
const MAX_COUNTRIES = 3;
const CATEGORY_DEBOUNCE_MS = 350;

// Extract a flat, deduped list of {major_category, major_category_id,
// sub_category, sub_category_id} matches out of the AI category-search
// response, regardless of which of the DS team's shapes it comes back in ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â
// the service isn't ours to pin down, so normalize defensively instead of
// assuming one field set.
function normalizeCategoryList(json) {
  if (!json) return [];
  const list = json.results || json.data || json.matches || (Array.isArray(json) ? json : []);
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const majorName = item?.major_category || item?.category || item?.name || item?.label;
    if (!majorName || seen.has(majorName)) continue;
    seen.add(majorName);
    out.push({
      major_category: majorName,
      major_category_id: item?.major_category_id ?? item?.category_id ?? item?.id ?? null,
      sub_category: item?.sub_category || null,
      sub_category_id: item?.sub_category_id ?? null,
    });
  }
  return out;
}

function StepDots({ step }) {
  const idx = step === "results" ? 1 : 0; // loading counts toward step 2 visually
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1].map((i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === idx ? "w-5 bg-gradient-to-r from-[#6b99ff] to-[#3762c1]" : "w-1.5 bg-theme-border"
          }`}
        />
      ))}
    </div>
  );
}

function SearchableMultiSelect({ icon: Icon, label, placeholder, values, onChange, max, options, onSearch, loading: externalLoading, resetKey, helperText, minQueryLength = 0 }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loadedOptions, setLoadedOptions] = useState(options || []);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    setLoadedOptions(options || []);
  }, [options]);

  useEffect(() => {
    setQuery("");
    if (!onSearch) setLoadedOptions(options || []);
  }, [resetKey]);

  useEffect(() => {
    if (values.length >= max) {
      setQuery("");
      setOpen(false);
    }
  }, [values.length, max]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!onSearch) {
      const q = query.trim().toLowerCase();
      const next = (options || []).filter((o) => !q || o.toLowerCase().includes(q));
      setLoadedOptions(next);
      return;
    }
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < minQueryLength) {
      setLoadedOptions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await onSearch(query.trim());
        setLoadedOptions(result || []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, onSearch, open, options, minQueryLength]);

  const toggle = (o) => {
    if (values.includes(o)) { onChange(values.filter(x => x !== o)); return; }
    if (values.length >= max) return;
    onChange([...values, o]);
  };

  const removeValue = (v) => onChange(values.filter(x => x !== v));
  const isLoading = loading || externalLoading;
  const list = loadedOptions || [];
  const disabled = values.length >= max;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center justify-between mb-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-theme-text-secondary">
          {Icon && <Icon size={14} className="text-theme-text-muted" />}
          {label}
        </label>
        <span className="text-xs font-medium text-theme-text-muted tabular-nums">{values.length}/{max}</span>
      </div>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.map(v => (
            <span key={v} className="inline-flex items-center gap-1 bg-[#3762c1]/15 text-[#6b99ff] text-xs font-medium pl-2.5 pr-1.5 py-1 rounded-full">
              {v}
              <button
                type="button"
                onClick={() => removeValue(v)}
                className="p-0.5 rounded-full hover:bg-white/15 hover:text-white transition-colors"
                aria-label={`Remove ${v}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={disabled ? `Max ${max} Selected` : placeholder}
          className="w-full bg-theme-bg border border-theme-border rounded-lg pl-8 pr-9 py-2.5 text-sm text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-[#3762c1]/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted"
          tabIndex={-1}
        >
          <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {helperText && <p className="text-[11px] text-theme-text-muted mt-1.5">{helperText}</p>}

      {open && !disabled && (
        <div className="absolute z-10 mt-1.5 w-full bg-theme-surface border border-theme-border rounded-lg shadow-xl max-h-52 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-theme-text-muted px-3 py-3">
              <Loader2 size={13} className="animate-spin" /> Loading...
            </div>
          ) : onSearch && query.trim().length < minQueryLength ? (
            <p className="text-xs text-theme-text-muted px-3 py-3">Type at least {minQueryLength} letters.</p>
          ) : list.length === 0 ? (
            <p className="text-xs text-theme-text-muted px-3 py-3">Nothing available right now.</p>
          ) : (
            list.map((o) => {
              const selected = values.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className="w-full flex items-center justify-between text-left px-3 py-2 text-sm text-theme-text hover:bg-[#3762c1]/10 transition-colors"
                >
                  {o}
                  {selected && <Check size={14} className="text-[#6b99ff] shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ResultSection({ icon: Icon, title, items, renderItem, emptyLabel }) {
  return (
    <div className="bg-theme-bg border border-theme-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[#3762c1]/15">
          <Icon size={13} className="text-[#6b99ff]" />
        </div>
        <h3 className="text-sm font-semibold text-theme-text">{title}</h3>
        {items.length > 0 && (
          <span className="text-[11px] text-theme-text-muted tabular-nums">{items.length}</span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <Icon size={18} className="text-theme-text-muted/50" />
          <p className="text-xs text-theme-text-muted">{emptyLabel}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto custom-scrollbar">
          {items.map(renderItem)}
        </div>
      )}
    </div>
  );
}

// Type-to-search category picker, backed directly by the AI category-search
// API (it's a semantic search endpoint ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â it has no "list everything" mode, it
// needs a real query to answer). Debounced as the user types; results are
// still selected with a single click.
function CategorySearch({ selected, onSelect }) {
  const [query, setQuery] = useState(selected?.major_category || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleInput = (e) => {
    const value = e.target.value;
    setQuery(value);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const json = await searchOnboardingCategory(value.trim(), 8);
        setResults(normalizeCategoryList(json));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, CATEGORY_DEBOUNCE_MS);
  };

  const pick = (match) => {
    onSelect(match);
    setQuery(match.major_category);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center justify-between mb-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-theme-text-secondary">
          <Sparkles size={14} className="text-theme-text-muted" />
          What's your niche?
        </label>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => setOpen(true)}
          placeholder="e.g. Fashion, Apps, Gaming..."
          className="w-full bg-theme-bg border border-theme-border rounded-lg pl-8 pr-3 py-2.5 text-sm text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-[#3762c1]/40 transition-all"
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full bg-theme-surface border border-theme-border rounded-lg shadow-xl max-h-48 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-theme-text-muted px-3 py-3">
              <Loader2 size={13} className="animate-spin" /> Searching...
            </div>
          ) : !results.length ? (
            <p className="text-xs text-theme-text-muted px-3 py-3">No matching categories found.</p>
          ) : (
            results.map((r) => {
              const isSelected = selected?.major_category === r.major_category;
              return (
                <button
                  key={r.major_category}
                  type="button"
                  onClick={() => pick(r)}
                  className="w-full flex items-center justify-between text-left px-3 py-2 text-sm text-theme-text hover:bg-[#3762c1]/10 transition-colors"
                >
                  {r.major_category}
                  {isSelected && <Check size={14} className="text-[#6b99ff] shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const OnboardingModal = ({ isOpen, onClose, onExplore, onSkip }) => {
  const [step, setStep] = useState("form"); // 'form' | 'loading' | 'results'
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [countries, setCountries] = useState([]);
  const [countryOptions, setCountryOptions] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState({ trending: [], topAdvertisers: [], longestRunning: [] });

  // Countries: real, DB-backed list ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â the SAME source the Ads Library
  // sidebar's Country filter uses (MongoDB sdui_config ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ GET /api/sdui/config).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchSDUIConfig()
      .then((config) => {
        if (cancelled) return;
        const countryOpts = findCountryOptions(config) || [];
        setCountryOptions(countryOpts.map(o => o.label).filter(Boolean));
      })
      .catch(() => {
        if (cancelled) return;
        setCountryOptions([]);
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  const searchCompetitors = async (query) => {
    const results = await fetchCompetitorSuggestions(query, {
      majorCategoryName: selectedCategory?.major_category,
      countries,
    });
    return (results || []).filter(r => !competitors.includes(r));
  };


  const canSubmit = !!selectedCategory && countries.length > 0 && competitors.length > 0 && !submitting;

  const handleSkip = useCallback(() => {
    try {
      const raw = localStorage.getItem('authUser');
      const authUser = raw ? JSON.parse(raw) : null;
      dismissOnboardingForUserId(authUser?.user_id || authUser?.id);
    } catch {}
    onSkip?.();
    onClose?.();
  }, [onClose, onSkip]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      if (!selectedCategory) setError("Pick a category from the suggestions.");
      else if (countries.length === 0) setError("Pick at least one country.");
      else if (competitors.length === 0) setError("Pick at least one competitor.");
      return;
    }
    setError("");
    setSubmitting(true);
    setStep("loading");
    try {
      await saveOnboarding({
        major_category_id: selectedCategory.major_category_id,
        major_category_name: selectedCategory.major_category,
        sub_category_id: selectedCategory.sub_category_id,
        sub_category_name: selectedCategory.sub_category,
        competitors,
        countries,
      });
      try {
        const raw = localStorage.getItem('authUser');
        const authUser = raw ? JSON.parse(raw) : null;
        if (authUser) {
          localStorage.setItem('authUser', JSON.stringify({ ...authUser, needsOnboarding: false }));
        }
      } catch {}
      const results = await fetchOnboardingPreview({
        major_category_id: selectedCategory.major_category_id,
        major_category_name: selectedCategory.major_category,
        sub_category_id: selectedCategory.sub_category_id,
        countries,
        competitors,
      });
      setPreview(results);
      setStep("results");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, selectedCategory, competitors, countries]);

  // Every hook above must run on every render regardless of isOpen ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â bailing
  // out before them (as this used to do) makes the component call fewer
  // hooks on the render where isOpen flips to false (e.g. clicking Skip),
  // which is a Rules-of-Hooks violation: React throws "Rendered fewer hooks
  // than expected" and, with no error boundary in the tree, that crashes the
  // whole app to a blank screen. The bail-out itself is safe here ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â it only
  // has to happen before the JSX below is built.
  if (!isOpen) return null;

  return (
    <div className="onboarding-overlay fixed inset-0 z-[999999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="onboarding-card w-full max-w-md bg-theme-surface border border-theme-border rounded-xl shadow-[0_16px_40px_-12px_rgba(55,98,193,0.3)] flex flex-col overflow-hidden max-h-[70vh]">
        {/* Accent top bar */}
        <div className="h-[3px] bg-gradient-to-r from-[#6b99ff] via-[#3762c1] to-[#6b99ff]" />

        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-theme-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#3762c1]/12 border border-[#3762c1]/20 shrink-0">
              <Sparkles size={14} className="text-[#6b99ff]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-theme-text leading-tight truncate">
                {step === "results" ? "Your niche, at a glance" : "Set up your Ads Library"}
              </h2>
              <p className="text-[11px] text-theme-text-muted mt-0.5">
                {step === "results" ? "Ready to explore" : "Takes less than a minute"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <StepDots step={step} />
            <button
              type="button"
              onClick={handleSkip}
              className="p-1 text-theme-text-muted hover:text-theme-text hover:bg-white/10 rounded-full transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-4 custom-scrollbar">
          {step === "form" && (
            <div className="flex flex-col gap-3">
              <div>
                <CategorySearch
                  selected={selectedCategory}
                  onSelect={setSelectedCategory}
                />
              </div>

              <div>
                <SearchableMultiSelect
                  icon={Globe2}
                  label="Countries"
                  placeholder="Search countries..."
                  options={countryOptions}
                  loading={countryOptions === null}
                  values={countries}
                  onChange={setCountries}
                  max={MAX_COUNTRIES}
                  helperText="Pick up to 3 countries."
                />
              </div>

              <div>
                <SearchableMultiSelect
                  icon={Swords}
                  label="Competitors"
                  placeholder={selectedCategory ? `Search ${selectedCategory.major_category} competitors...` : "Pick a niche first..."}
                  onSearch={selectedCategory ? searchCompetitors : null}
                  resetKey={`${selectedCategory?.major_category_id || ''}|${countries.join(',')}`}
                  values={competitors}
                  onChange={setCompetitors}
                  max={MAX_COMPETITORS}
                  minQueryLength={selectedCategory ? 0 : 2}
                  helperText={selectedCategory ? `Suggestions are tailored to ${selectedCategory.major_category}.` : "Pick a niche first, then type a competitor name."}
                />
              </div>

              {error && (
                <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2.5">
                  {error}
                </p>
              )}

              <div className="flex justify-end items-center gap-2.5 pt-2 border-t border-theme-border/70 -mx-4 px-4 pt-4">
                <button
                  type="button"
                  onClick={handleSkip}
                  className="px-3 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text transition-colors whitespace-nowrap"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-1.5 bg-gradient-to-r from-[#3762c1] to-[#335296] hover:from-[#4374e0] hover:to-[#3e64b8] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full text-sm px-4 py-2.5 font-semibold shadow-lg shadow-blue-900/25 transition-all active:scale-95 whitespace-nowrap"
                >
                  Show trending ads <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {step === "loading" && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-[#3762c1]/20 blur-xl animate-pulse" />
                <Loader2 size={30} className="relative animate-spin text-[#6b99ff]" />
              </div>
              <p className="text-sm text-theme-text-secondary">Finding the best ads in your niche...</p>
            </div>
          )}

          {step === "results" && (
            <div className="flex flex-col gap-4">
              <ResultSection
                icon={TrendingUp}
                title="Trending Ads"
                items={preview.trending}
                emptyLabel="No trending ads found yet for this niche."
                renderItem={(ad) => (
                  <div key={ad.ad_id || ad.id} className="flex items-center gap-3 bg-theme-surface border border-theme-border rounded-lg p-2 hover:border-[#3762c1]/30 hover:shadow-sm hover:-translate-y-px transition-all">
                    {ad.image_video_url && (
                      <img src={ad.image_video_url} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-theme-text truncate">{ad.ad_title || ad.post_owner || "Untitled ad"}</p>
                      <p className="text-[11px] text-theme-text-muted truncate">{ad.post_owner}</p>
                    </div>
                  </div>
                )}
              />

              <ResultSection
                icon={Users}
                title="Top Advertisers"
                items={preview.topAdvertisers}
                emptyLabel="No advertiser data found yet for this niche."
                renderItem={(adv) => (
                  <div key={adv.advertiser} className="flex items-center justify-between bg-theme-surface border border-theme-border rounded-lg px-3 py-2 hover:border-[#3762c1]/30 hover:shadow-sm hover:-translate-y-px transition-all">
                    <span className="text-xs font-medium text-theme-text truncate">{adv.advertiser}</span>
                    <span className="text-[11px] text-theme-text-muted shrink-0 tabular-nums">{adv.ads} ads</span>
                  </div>
                )}
              />

              <ResultSection
                icon={Clock}
                title="Longest-Running Creatives"
                items={preview.longestRunning}
                emptyLabel="No long-running ads found yet for this niche."
                renderItem={(ad) => (
                  <div key={ad.ad_id || ad.id} className="flex items-center gap-3 bg-theme-surface border border-theme-border rounded-lg p-2 hover:border-[#3762c1]/30 hover:shadow-sm hover:-translate-y-px transition-all">
                    {ad.image_video_url && (
                      <img src={ad.image_video_url} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-theme-text truncate">{ad.ad_title || ad.post_owner || "Untitled ad"}</p>
                      <p className="text-[11px] text-theme-text-muted truncate">{ad.post_owner}</p>
                    </div>
                    {ad.days_running != null && (
                      <span className="text-[11px] text-[#6b99ff] font-medium shrink-0 tabular-nums">{ad.days_running}d</span>
                    )}
                  </div>
                )}
              />

              <div className="flex justify-end items-center gap-2.5 pt-1 border-t border-theme-border -mx-4 px-4 pt-4">
                <button
                  type="button"
                  onClick={() => setStep("form")}
                  className="px-3 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text transition-colors whitespace-nowrap"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExplore?.(selectedCategory?.major_category, countries);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 bg-gradient-to-r from-[#3762c1] to-[#335296] hover:from-[#4374e0] hover:to-[#3e64b8] text-white rounded-full text-sm px-4 py-2.5 font-semibold shadow-lg shadow-blue-900/25 transition-all active:scale-95 whitespace-nowrap"
                >
                  Explore Library <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;

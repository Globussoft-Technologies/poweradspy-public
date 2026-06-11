import React, { useState, useRef, useEffect, useMemo } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css"; // Base styles

const OPTIONS = [
  { id: "ad_seen", label: "Ad Seen Date" },
  { id: "post_date", label: "Post Date" },
  { id: "domain_reg", label: "Domain Registration Date" },
];

const QUICK_FILTERS = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7", label: "Last Seven Days" },
  { id: "last_30", label: "Last Thirty Days" },
  // { id: "this_month", label: "This Month" },
  // { id: "last_month", label: "Last Month" },
  { id: "custom", label: "Custom Range" },
];

const CustomSelect = ({ value, options, onChange, label, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const optionsRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll active option into view when opened
  useEffect(() => {
    if (isOpen && optionsRef.current) {
      const activeItem = optionsRef.current.querySelector('[data-active="true"]');
      if (activeItem) {
        activeItem.scrollIntoView({ block: "center" });
      }
    }
  }, [isOpen]);

  return (
    <div
      className={`relative custom-select-root ${className}`}
      ref={containerRef}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-2 min-w-[80px] hover:bg-[#292b31] focus:bg-[#292b31] rounded-md transition-colors text-[13px] font-bold text-white transition-opacity duration-200"
      >
        <span>{label}</span>
        <ChevronDown
          size={13}
          className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          ref={optionsRef}
          className="absolute top-full left-0 mt-1 z-[100] min-w-[120px] max-h-[200px] overflow-y-auto bg-[#222325] border border-[#363840] rounded-lg shadow-2xl custom-scrollbar py-1"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              data-active={String(opt.value) === String(value)}
              onClick={() => {
                if (opt.disabled) return;
                onChange?.({ target: { value: opt.value } });
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${
                opt.disabled
                  ? "opacity-30 cursor-not-allowed"
                  : String(opt.value) === String(value)
                    ? "bg-[#335296] text-white font-bold"
                    : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CustomDropdown = (props) => {
  const { value, options, onChange, "aria-label": ariaLabel } = props;
  const activeOption = options?.find((opt) => String(opt.value) === String(value));
  
  return (
    <CustomSelect
      value={value}
      options={options}
      onChange={onChange}
      label={activeOption?.label}
      aria-label={ariaLabel}
    />
  );
};

const DATE_FILTER_KEYS = ["seen_btn_sort", "post_date_btn_sort", "domain_date_btn_sort"];

// Maps the date type tab id → plan_access_config _id (matches SDUI_TO_PLAN_ACCESS in useAuth.jsx)
const DATE_TYPE_TO_PLAN_ACCESS_ID = {
  ad_seen:    'last_seen',
  post_date:  'post_date',
  domain_reg: 'domain_registration',
};

const AdDateDropdown = ({ onDateChange, filterValues, isTikTok = false, guest, disableTooltips = false, isFilterRestricted, onRestricted }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef(null);

  const handleMouseEnter = () => {
    if (disableTooltips) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setTipPos({ x: rect.left + rect.width / 2, y: rect.top - 6 });
    }
    setShowTip(true);
  };
  const [activeDateType, setActiveDateType] = useState("ad_seen");
  const [dates, setDates] = useState({
    ad_seen: undefined,
    post_date: undefined,
    domain_reg: undefined,
  });
  const [activeQuickFilter, setActiveQuickFilter] = useState("all");
  const [month, setMonth] = useState(new Date());

  const FILTER_KEY_TO_DATE_TYPE = {
    seen_btn_sort: "ad_seen",
    post_date_btn_sort: "post_date",
    domain_date_btn_sort: "domain_reg",
  };

  // Sync calendar state from filterValues when dropdown opens
  useEffect(() => {
    if (!isOpen) return;
    const restored = { ad_seen: undefined, post_date: undefined, domain_reg: undefined };
    let hasAny = false;
    for (const [filterKey, dateType] of Object.entries(FILTER_KEY_TO_DATE_TYPE)) {
      const val = filterValues?.[filterKey];
      if (Array.isArray(val) && val.length === 2) {
        // stored as UTC timestamps in App.jsx. 
        // We must interpret them as UTC to get the correct day regardless of local timezone.
        const dateFrom = new Date(Number(val[1]) * 1000);
        const dateTo = new Date(Number(val[0]) * 1000);
        
        restored[dateType] = {
          from: new Date(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth(), dateFrom.getUTCDate()),
          to: new Date(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), dateTo.getUTCDate()),
        };
        hasAny = true;
      }
    }
    setDates(restored);

    // Detect which quick filter matches the active date type
    const activeRange = restored[activeDateType];
    if (!activeRange) {
      setActiveQuickFilter("all");
    } else {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const toDateOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const activeFrom = toDateOnly(activeRange.from);
      const activeTo = toDateOnly(activeRange.to);
      const todayOnly = toDateOnly(now);
      
      const diffDays = (d1, d2) => Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
      const startDiff = diffDays(todayOnly, activeFrom);
      const endDiff = diffDays(todayOnly, activeTo);

      if (startDiff === 0 && endDiff === 0) {
        setActiveQuickFilter("today");
      } else if (startDiff === 1 && endDiff === 1) {
        setActiveQuickFilter("yesterday");
      } else if (startDiff === 6 && endDiff === 0) {
        setActiveQuickFilter("last_7");
      } else if (startDiff === 29 && endDiff === 0) {
        setActiveQuickFilter("last_30");
      } else {
        setActiveQuickFilter("custom");
      }
    }

    const activeVal = filterValues?.[Object.keys(FILTER_KEY_TO_DATE_TYPE).find(k => FILTER_KEY_TO_DATE_TYPE[k] === activeDateType)];
    if (Array.isArray(activeVal) && activeVal.length === 2) {
      setMonth(new Date(Number(activeVal[1]) * 1000));
    }
  }, [isOpen, activeDateType]);

  // Reset local calendar state when all date filters are cleared externally
  useEffect(() => {
    const allCleared = DATE_FILTER_KEYS.every(
      (k) => !filterValues?.[k] || (Array.isArray(filterValues[k]) && filterValues[k].length === 0)
    );
    if (allCleared) {
      setDates({ ad_seen: undefined, post_date: undefined, domain_reg: undefined });
      setActiveQuickFilter("all");
      setMonth(new Date());
    }
  }, [filterValues]);

  // Returns true if the given date type is restricted for the current plan
  const isDateTypeRestricted = (dateTypeId) => {
    if (!isFilterRestricted) return false;
    return isFilterRestricted(DATE_TYPE_TO_PLAN_ACCESS_ID[dateTypeId] || dateTypeId);
  };

  const dropdownRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDateChange = (range) => {
    if (guest?.showGuestWarning("Please login to change date range")) return;
    if (isDateTypeRestricted(activeDateType)) { onRestricted?.(); return; }
    setActiveQuickFilter("custom");
    setDates((prev) => ({
      ...prev,
      [activeDateType]: range,
    }));

    if (onDateChange && range?.from && range?.to) {
      onDateChange(activeDateType, [range.from, range.to]);
    } else if (onDateChange && !range) {
      onDateChange(activeDateType, null);
    }
  };

  const handleQuickFilterClick = (filterId) => {
    if (guest?.showGuestWarning("Please login to change date filters")) return;
    if (filterId !== 'all' && isDateTypeRestricted(activeDateType)) { onRestricted?.(); return; }
    setActiveQuickFilter(filterId);
    let range = undefined;
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
    );

    switch (filterId) {
      case "all":
        range = undefined;
        break;
      case "today":
        range = { from: startOfToday, to: now };
        break;
      case "yesterday": {
        const yesterdayStart = new Date(startOfToday);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        const yesterdayEnd = new Date(yesterdayStart);
        yesterdayEnd.setHours(23, 59, 59);
        range = { from: yesterdayStart, to: yesterdayEnd };
        break;
      }
      case "last_7": {
        const start = new Date(startOfToday);
        start.setDate(start.getDate() - 6);
        range = { from: start, to: now };
        break;
      }
      case "last_30": {
        const start = new Date(startOfToday);
        start.setDate(start.getDate() - 29);
        range = { from: start, to: now };
        break;
      }
      case "this_month": {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        range = { from: start, to: now };
        break;
      }
      case "last_month": {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        end.setHours(23, 59, 59);
        range = { from: start, to: end };
        break;
      }
      default:
        return;
    }

    setDates((prev) => ({
      ...prev,
      [activeDateType]: range,
    }));

    if (range) {
      setMonth(range.from);
    } else {
      setMonth(new Date());
    }

    if (onDateChange) {
      if (range && range.from && range.to) {
        onDateChange(activeDateType, [range.from, range.to]);
        if (filterId !== "custom") setIsOpen(false);
      } else {
        onDateChange(activeDateType, null);
        setIsOpen(false);
      }
    }
  };

  const formatDateRange = (range) => {
    if (!range || (!range.from && !range.to)) return "Select dates";
    const f = (d) => {
      if (!d) return "";
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const year = d.getFullYear();
      return `${month}/${day}/${year}`;
    };
    if (range.from && !range.to) return f(range.from);
    return `${f(range.from)} - ${f(range.to)}`;
  };

  const hasSelectedDates = useMemo(() => {
    return DATE_FILTER_KEYS.some(k => {
      const val = filterValues?.[k];
      return Array.isArray(val) && val.length === 2;
    });
  }, [filterValues]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Calendar Button */}
      <button
        ref={btnRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTip(false)}
        onClick={() => {
          setIsOpen(!isOpen);
          setShowTip(false);
        }}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${isOpen || hasSelectedDates
            ? "bg-[#335296] text-white border-[#3759a3]"
            : "bg-theme-card text-white/60 border-theme-border hover:text-theme-text-secondary hover:border-theme-text-muted"
          }`}
      >
        <Calendar size={14} />
      </button>

      {showTip && (
        <div
          className="fixed z-[9999] px-3 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap pointer-events-none"
          style={{
            left: tipPos.x,
            top: tipPos.y,
            transform: "translate(-50%, -100%)",
            backgroundColor: "var(--color-surface)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          Filter by Date
        </div>
      )}

      {/* Dropdown Content */}
      {isOpen && (
        <div className="absolute top-full sm:right-0 mt-2 scale-75 2xl:scale-100 origin-top-left sm:origin-top-right min-w-[300px] sm:min-w-[480px] bg-theme-bg border border-theme-border rounded-xl shadow-2xl z-50 flex flex-col">
          {/* Tabs for Date Types */}
          <div className="p-3 border-b border-[#363840]/70 bg-theme-surface">
            <div className={`flex gap-2 ${isTikTok ? "justify-center" : ""}`}>
              {OPTIONS.filter((opt) => !isTikTok || opt.id === "ad_seen").map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    if (guest?.showGuestWarning("Please login to change date type")) return;
                    if (isDateTypeRestricted(opt.id)) { onRestricted?.(); setIsOpen(false); return; }
                    setActiveDateType(opt.id);
                  }}
                  className={`${isTikTok ? "px-6" : "flex-1"} py-1.5 px-2 text-[10px] whitespace-nowrap sm:text-[11px] font-semibold rounded-md transition-colors border ${
                    activeDateType === opt.id
                      ? "bg-[#335296] border-[#5a5c66]/40 text-white"
                      : "bg-[#222325] border-transparent text-white/70 hover:text-white"
                  }`}
                >
                  {opt.label === "Domain Registration Date"
                    ? "Domain Reg. Date"
                    : opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Main Area */}
          <div className="flex bg-theme-surface custom-rdp-wrapper">
            {/* QUICK FILTER SIDEBAR */}
            <div className="lg:w-[150px] border-r border-[#363840]/70 py-3 hidden sm:flex flex-col pt-4">
              <h2 className="text-white/70 px-5 py-2.5 text-[13px] 2xl:text-[14px] font-medium transition-all mb-0.5">Quick Filters</h2>
              {QUICK_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => handleQuickFilterClick(filter.id)}
                  className={`w-full text-left px-5 py-2.5 text-xs 2xl:text-[13px] font-medium transition-all ${
                    activeQuickFilter === filter.id
                      ? "bg-[#335296]/20 text-[#6b99ff] border-r-2 border-[#6b99ff] font-bold"
                      : "text-white/60 hover:text-white hover:bg-white/[0.02]"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* CALENDAR */}
            <div className="p-4 flex-1">
              <style>{`
                .custom-rdp-wrapper {
                  --rdp-cell-size: 38px;
                  --rdp-accent-color: #4b4d53;
                  --rdp-background-color: transparent;
                }
                .rdp-root {
                  margin: 0;
                  --rdp-day_button-border-radius: 4px;
                }
                
                .rdp-selected .rdp-day_button {
                  background-color: transparent !important;
                  border: none !important;
                  outline: none !important;
                  color: #ffffff !important;
                  box-shadow: none !important;
                }
  
                .rdp-range_start, .rdp-range_end {
                  background: #3c3e47 !important;
                  border: none !important;
                  outline: none !important;
                  color: #ffffff !important;
                  box-shadow: none !important;
                }
                
                /* Header / Nav Layout */
                .rdp-month_caption, .rdp-year_caption {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 14px;
                  gap: 10px;
                }
                .rdp-dropdowns {
                  display: flex;
                  align-items: center;
                  gap: 8px;
                }
                .rdp-dropdown {
                  background-color: transparent;
                  color: #ffffff;
                  font-size: 12px;
                  font-weight: 600;
                  border: none;
                  cursor: pointer;
                  outline: none;
                  appearance: none;
                }
                .rdp-dropdown:focus, .rdp-dropdown:focus-visible {
                  outline: none !important;
                  box-shadow: none !important;
                }
                .rdp-caption_label {
                  padding: 10px;
                  min-width: 85px;
                  border-radius: 6px;
                  justify-content: space-between;
                }
                .rdp-dropdown:hover ~ .rdp-caption_label {
                  background-color: #292b31;
                }
                .rdp-dropdown:focus-visible ~ .rdp-caption_label,
                .rdp-dropdown:focus ~ .rdp-caption_label {
                  background-color: #292b31;
                  outline: none !important;
                  box-shadow: none !important;
                }
                .rdp-dropdown option {
                  background-color: #292b31;
                  color: #ffffff;
                  font-size: 12px;
                }
                .rdp-dropdown_root {
                  position: relative;
                  display: inline-flex;
                  align-items: center;
                }
                .rdp-dropdown_root svg {
                  width: 14px;
                  height: 14px;
                  margin-left: 4px;
                  fill: #ffffff;
                  opacity: 0.7;
                }
  
                /* Nav buttons (Prev/Next) */
                .rdp-nav {
                  display: flex;
                  justify-content: space-between;
                  position: absolute;
                  left: 0;
                  right: 0;
                  top: 0;
                  pointer-events: none;
                  z-index: 10;
                }
                .rdp-nav svg {
                  width: 14px;
                  height: 14px;
                  fill: #ffffff;
                  opacity: 0.8;
                }
                .rdp-nav button {
                  pointer-events: auto;
                  background-color: #3f414a;
                  border-radius: 6px;
                  width: 28px;
                  height: 28px;
                  display: inline-flex;
                  align-items: center;
                  justify-content: center;
                  border: none;
                  cursor: pointer;
                  transition: background-color 0.2s;
                }
                .rdp-nav button:hover:not([disabled]) {
                  background-color: #4b4d53;
                }
                .rdp-nav button[disabled], .rdp-nav button[aria-disabled="true"] {
                  opacity: 0.3;
                  cursor: not-allowed;
                }
  
                /* Days Header */
                .rdp-head_cell {
                  color: #8b93a0;
                  font-weight: 500;
                  font-size: 11px;
                  padding-bottom: 8px;
                  padding-top: 8px; 
                  text-transform: capitalize;
                }
  
                /* Base Day Button */
                .rdp-day_button {
                  font-size: 12px;
                  background-color: transparent;
                  color: #d1d5db;
                  border: none;
                  font-weight: 500;
                  width: 32px;
                  height: 32px;
                  margin: 0 auto;
                  outline: none;
                }
                .rdp-day_button:hover:not([disabled]) {
                  background-color: rgba(255,255,255,0.08);
                  border-radius: 8px;
                }
                .rdp-day_button:focus, .rdp-day_button:focus-visible {
                  outline: none !important;
                  box-shadow: none !important;
                }
                .rdp-day_button[disabled] {
                  color: #4b4d53;
                  pointer-events: none;
                }
                .rdp-outside {
                  opacity: 0.4;
                }
                
                /* Explicitly override React Day Picker default selected styles if present */
                .rdp-day_selected, .rdp-day_selected:focus-visible, .rdp-day_selected:hover {
                   background-color: transparent !important;
                   border: none !important;
                   outline: none !important;
                   color: #ffffff !important;
                   box-shadow: none !important;
                }
  
                /* Range Highlighting */
                .rdp-month_grid {
                  border-collapse: separate !important;
                  border-spacing: 0 6px !important;
                }
                
                .rdp-day.rdp-disabled {
                  cursor: not-allowed !important;
                }
                .rdp-day.rdp-disabled .rdp-day_button {
                  color: #fff !important;
                  opacity: 0.6 !important;
                }
  
                .rdp-day {
                  padding: 0;
                  margin: 0;
                  height: 28px; 
                }
                
                .rdp-range_middle {
                   background-color: #242529; 
                   border-radius: 0;
                }
                
                .rdp-day:first-child.rdp-range_middle {
                   border-top-left-radius: 25px;
                   border-bottom-left-radius: 25px;
                }
                .rdp-day:last-child.rdp-range_middle {
                   border-top-right-radius: 25px;
                   border-bottom-right-radius: 25px;
                }
  
                .rdp-range_middle .rdp-day_button {
                   color: #ffffff;
                   font-weight: 600;
                   background: transparent;
                   border-radius: 0;
                }
  
                /* Start and End Cells */
                .rdp-range_start {
                   background-color: #335296;
                   border-top-left-radius: 25px;
                   border-bottom-left-radius: 25px;
                }
                .rdp-range_end {
                   background-color: #335296;
                   border-top-right-radius: 25px;
                   border-bottom-right-radius: 25px;
                }
  
                .rdp-range_start .rdp-day_button,
                .rdp-range_end .rdp-day_button {
                   background-color: transparent !important;
                   color: #ffffff;
                   font-weight: 700;
                }
  
                .rdp-range_start .rdp-day_button,
                .rdp-range_end .rdp-day_button {
                   text-decoration: underline;
                   text-decoration-thickness: 2px;
                   text-underline-offset: 4px;
                   text-decoration-color: #ffffff;
                }
  
                .rdp-range_start.rdp-range_end {
                   border-radius: 30px;
                }

                /* Custom Select Styles */
                .custom-scrollbar::-webkit-scrollbar {
                  width: 5px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                  background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                  background: #363840;
                  border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                  background: #4b4d53;
                }

                .custom-select-root {
                  display: inline-flex;
                }
              `}</style>

              <div className="relative">
                <DayPicker
                  mode="range"
                  selected={dates[activeDateType]}
                  onSelect={handleDateChange}
                  month={month}
                  onMonthChange={setMonth}
                  showOutsideDays={true}
                  captionLayout="dropdown"
                  startMonth={new Date(1986, 0)}
                  endMonth={new Date()}
                  disabled={{ after: new Date() }}
                  components={{
                    Dropdown: CustomDropdown,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Footer — selected range display + close */}
          <div className="px-5 py-3 bg-theme-surface border-t border-[#363840]/70 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] text-white/60 uppercase whitespace-nowrap tracking-widest font-bold">
                Selected Range
              </span>
              <span className="text-[11px] whitespace-nowrap text-[#6b99ff] font-semibold tabular-nums">
                {formatDateRange(dates[activeDateType])}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (guest?.showGuestWarning("Please login to change date filters")) return;
                  setActiveQuickFilter("all");
                  setDates((prev) => ({ ...prev, [activeDateType]: undefined }));
                  setMonth(new Date());
                  onDateChange?.(activeDateType, null);
                }}
                disabled={!dates[activeDateType]}
                className={`px-5 py-1.5 text-[12px] font-bold border border-[#363840]/80 hover:border-white/20 rounded-lg hover:text-white ${dates[activeDateType] ? "text-white bg-[#335296] border-[#5a5c66]/40 hover:opacity-80" : "text-white/70"} transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#363840]/80 disabled:hover:text-white/70`}
              >
                Clear Filter
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="px-5 py-1.5 text-[12px] font-bold text-white/70 border border-[#363840]/80 hover:border-white/20 rounded-lg hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdDateDropdown;

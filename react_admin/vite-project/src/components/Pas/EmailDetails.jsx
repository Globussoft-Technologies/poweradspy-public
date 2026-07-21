import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { CiSearch } from "react-icons/ci";
import { FiRefreshCw, FiX, FiCalendar, FiSend, FiRotateCw, FiDownload, FiDatabase } from "react-icons/fi";
import * as XLSX from "xlsx";
import { DateRange } from "react-date-range";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import Loader from "./Loader";
import MemberOverview from "./MemberOverview";
import SuppressionPanel from "./SuppressionPanel";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "../ui/table";

/**
 * Email Analytics (PRD Feature 2) — delivery audit for the two report mails
 * (competitorUpdate + dataReport). Summary tiles + rates, mail-type tabs,
 * 30-day heatmap, failure-reason breakdown, filterable/paginated log with a
 * per-send detail drawer (event timeline). Reads admin_panel_backend
 * /email-analytics. See EMAIL_ANALYTICS_MANIFEST.md.
 */

const BASE = import.meta.env.VITE_ADMIN_PANEL_API || "http://localhost:4000/admin-panel";
const API = `${BASE}/email-analytics`;
// Manual-send endpoints live in compeitetor_analysis (not admin_panel_backend),
// because they touch competitor + request state in that DB. Both the resend
// button and the composer hit MANUAL_SEND_API. Uses the same VITE_COMPETITORS_API
// env var that CompetitorDetails.jsx already uses — single source of truth.
const MANUAL_SEND_API = (import.meta.env.VITE_COMPETITORS_API || "http://localhost:6002/api/").replace(/\/+$/, "");

const MAIL_TYPES = [
  { key: "", label: "All mails" },
  { key: "competitorUpdate", label: "Competitor Update" },
  { key: "dataReport", label: "Data Report" },
  { key: "keywordNotification", label: "Keyword Alerts" },
];

const STATUS_META = {
  sent:         { label: "Sent",         cls: "bg-blue-100 text-blue-700" },
  delivered:    { label: "Delivered",    cls: "bg-green-100 text-green-700" },
  opened:       { label: "Opened",       cls: "bg-teal-100 text-teal-700" },
  bounced:      { label: "Bounced",      cls: "bg-red-100 text-red-700" },
  spam:         { label: "Spam",         cls: "bg-orange-100 text-orange-700" },
  unsubscribed: { label: "Unsubscribed", cls: "bg-purple-100 text-purple-700" },
  failed:       { label: "Failed",       cls: "bg-rose-100 text-rose-700" },
  skipped:      { label: "Skipped",      cls: "bg-gray-100 text-gray-600" },
  queued:       { label: "Processing",   cls: "bg-amber-100 text-amber-700" },
};

const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");
const fmtDate = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
// Split formatters for the table — date in one column, time in the next.
const fmtDateOnly = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtTimeOnly = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");

function StatusPill({ status }) {
  const m = STATUS_META[status] || { label: status || "—", cls: "bg-gray-100 text-gray-600" };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

const NET_META = {
  facebook:  { label: "FB", cls: "bg-blue-100 text-blue-700" },
  instagram: { label: "IG", cls: "bg-pink-100 text-pink-700" },
  google:    { label: "G",  cls: "bg-green-100 text-green-700" },
};
function NetworkChip({ net }) {
  const m = NET_META[net] || { label: net, cls: "bg-gray-100 text-gray-600" };
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.cls}`} title={net}>{m.label}</span>;
}

function Tile({ title, value, sub, accent, onClick, active }) {
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      title={clickable ? `Show ${title} in the send log below` : undefined}
      className={`p-4 rounded-xl shadow-sm border bg-white flex flex-col justify-between min-h-[92px] ${active ? "border-[#1540a4] ring-2 ring-[#1540a4]/30" : "border-gray-100"} ${clickable ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
    >
      <p className="text-gray-500 text-[13px] font-medium">{title}</p>
      <h2 className={`text-[26px] font-bold leading-tight ${accent || "text-[#1540a4]"}`}>{value}</h2>
      {sub != null && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// Build a local-time YYYY-MM-DD string from a Date (avoids UTC shift).
function localYmd(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function fmtBtnDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}
// IST-tagged ISO string. The backend parses these unambiguously regardless
// of server timezone — so "today 00:00" really means 00:00 IST, not 00:00
// UTC (which would land us at 05:30 IST and silently include yesterday's
// late-evening records).
function toIstIso(d) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${localYmd(d)}T${hh}:${mm}:${ss}+05:30`;
}
// Start / end of today as Date objects.
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function endOfToday()   { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }

// Persisted date-range filter. Survives page reloads so the operator
// doesn't have to re-pick the same window every time. Cleared range or
// corrupt storage both fall back to "no filter" → all-time data.
const RANGE_STORAGE_KEY = "emailDetails.range";
function loadStoredRange() {
  try {
    const raw = localStorage.getItem(RANGE_STORAGE_KEY);
    if (!raw) return { s: null, e: null };
    const obj = JSON.parse(raw);
    const s = obj?.s ? new Date(obj.s) : null;
    const e = obj?.e ? new Date(obj.e) : null;
    return {
      s: s && !isNaN(s.getTime()) ? s : null,
      e: e && !isNaN(e.getTime()) ? e : null,
    };
  } catch { return { s: null, e: null }; }
}

/**
 * Single-button date-range filter for the send log. 252 px card opens
 * upward (so it can't push the page scrollbar), Today/Yesterday/7d/30d
 * preset grid on top, react-date-range calendar in the middle, From/To
 * 12-hour time pickers below, Clear/Cancel/Apply at the bottom.
 *
 * Apply commits and fires onApply with the [startDate, endDate] pair
 * (Date objects stamped with the chosen times). Body scroll is locked
 * while the popover is open.
 */
const ALLOWED_MINUTES = [0, 15, 30, 45, 59];
function snapMin(m) {
  let best = ALLOWED_MINUTES[0], diff = 60;
  for (const x of ALLOWED_MINUTES) {
    const d = Math.abs(m - x);
    if (d < diff) { diff = d; best = x; }
  }
  return best;
}
function to24(h, m, mer) {
  // 12 AM → 0, 1-11 AM → 1-11, 12 PM → 12, 1-11 PM → 13-23.
  const H = (h % 12) + (mer === "PM" ? 12 : 0);
  return [H, m];
}
function to12(date, defaultMer) {
  if (!date) return { h: defaultMer === "AM" ? 12 : 11, m: defaultMer === "AM" ? 0 : 59, mer: defaultMer };
  const H = date.getHours(), M = date.getMinutes();
  const mer = H >= 12 ? "PM" : "AM";
  let h = H % 12; if (h === 0) h = 12;
  return { h, m: snapMin(M), mer };
}

// Scoped overrides — fit react-date-range into a 280 px card, force the
// range-highlight visuals (default theme uses `background: currentColor`
// which we explicitly override so the brand color paints reliably), and
// match the brand palette. Only apply inside `.rdr-compact`, so they
// never leak.
const COMPACT_CAL_CSS = `
.rdr-compact .rdrDateDisplayWrapper { display: none; }
.rdr-compact .rdrCalendarWrapper { font-size: 11px; background: transparent; width: 100%; }
.rdr-compact .rdrMonthAndYearWrapper { padding: 4px 8px; height: 36px; }
.rdr-compact .rdrMonthPicker, .rdr-compact .rdrYearPicker { margin: 0 3px; }
.rdr-compact .rdrMonthPicker select,
.rdr-compact .rdrYearPicker select { font-size: 11px; padding: 4px 18px 4px 6px; background-position: right 4px center; color: #334155; font-weight: 500; }
.rdr-compact .rdrNextPrevButton { width: 24px; height: 24px; margin: 0 4px; padding: 0; background: #f1f5f9; border-radius: 6px; }
.rdr-compact .rdrPprevButton i { border-color: transparent #475569 transparent transparent; }
.rdr-compact .rdrNextButton i  { border-color: transparent transparent transparent #475569; }
.rdr-compact .rdrMonth { width: 100%; padding: 0 8px 8px; }
.rdr-compact .rdrWeekDays { padding: 0; }
.rdr-compact .rdrWeekDay { font-size: 10px; line-height: 20px; font-weight: 500; color: #94a3b8; }
.rdr-compact .rdrDay { height: 28px; line-height: 28px; position: relative; }
.rdr-compact .rdrDayNumber { top: 2px; bottom: 2px; position: absolute; left: 0; right: 0; display: flex; align-items: center; justify-content: center; z-index: 2; }
.rdr-compact .rdrDayNumber span { font-size: 11px; font-weight: 500; color: #334155; position: relative; z-index: 2; }
.rdr-compact .rdrDayPassive .rdrDayNumber span { color: #cbd5e1 !important; opacity: 1; }
.rdr-compact .rdrDayDisabled { background: transparent; }
.rdr-compact .rdrDayDisabled .rdrDayNumber span { opacity: 0.25; }
/* Range fill — explicit position + background to override default theme. */
.rdr-compact .rdrInRange,
.rdr-compact .rdrStartEdge,
.rdr-compact .rdrEndEdge {
  position: absolute !important;
  top: 3px !important;
  bottom: 3px !important;
  left: 0 !important;
  right: 0 !important;
  display: block !important;
  pointer-events: none;
  z-index: 1;
}
.rdr-compact .rdrInRange { background: rgba(21, 64, 164, 0.12) !important; background-color: rgba(21, 64, 164, 0.12) !important; }
.rdr-compact .rdrStartEdge,
.rdr-compact .rdrEndEdge { background: #1540a4 !important; background-color: #1540a4 !important; }
.rdr-compact .rdrStartEdge { left: 2px !important; border-radius: 50% 0 0 50% !important; }
.rdr-compact .rdrEndEdge   { right: 2px !important; border-radius: 0 50% 50% 0 !important; }
.rdr-compact .rdrStartEdge.rdrEndEdge { left: 2px !important; right: 2px !important; border-radius: 50% !important; }
.rdr-compact .rdrStartEdge ~ .rdrDayNumber span,
.rdr-compact .rdrEndEdge   ~ .rdrDayNumber span { color: #ffffff !important; font-weight: 600 !important; }
.rdr-compact .rdrDayToday .rdrDayNumber span:after { background: #1540a4 !important; }
`;

// 12-hour time widget: [hour ▾] : [min ▾] [AM | PM]
function TimeWidget({ value, onChange }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 1,
        height: 26,
        padding: "0 4px",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 5,
        overflow: "visible",
      }}
    >
      <select
        value={value.h}
        onChange={(e) => onChange({ ...value, h: Number(e.target.value) })}
        className="bg-transparent border-0 focus:outline-none tabular-nums"
        style={{ fontSize: 11, color: "#334155", padding: 0, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", backgroundImage: "none" }}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span style={{ color: "#94a3b8", fontSize: 11 }}>:</span>
      <select
        value={value.m}
        onChange={(e) => onChange({ ...value, m: Number(e.target.value) })}
        className="bg-transparent border-0 focus:outline-none tabular-nums"
        style={{ fontSize: 11, color: "#334155", padding: 0, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", backgroundImage: "none" }}
      >
        {ALLOWED_MINUTES.map((m) => (
          <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange({ ...value, mer: value.mer === "AM" ? "PM" : "AM" })}
        style={{
          marginLeft: "auto",
          padding: "1px 5px",
          fontSize: 10,
          fontWeight: 600,
          borderRadius: 4,
          border: "none",
          flexShrink: 0,
          backgroundColor: value.mer === "PM" ? "#1540a4" : "#dbeafe",
          color: value.mer === "PM" ? "#ffffff" : "#1540a4",
        }}
      >
        {value.mer}
      </button>
    </div>
  );
}

function EmailDateRange({ initialStart, initialEnd, onApply, onClear, onOpenChange }) {
  // initialStart/initialEnd may be null when the parent's filter is cleared.
  // Fall back to today purely for the calendar's visual range — the button's
  // label is driven by hasApplied, so a falsy parent range still shows "—— ——".
  const initial = useMemo(() => {
    const s = initialStart || startOfToday();
    const e = initialEnd   || endOfToday();
    return [{ startDate: s, endDate: e, key: "selection" }];
  }, [initialStart, initialEnd]);

  const [open, setOpen] = useState(false);
  const [committed, setCommitted] = useState(initial);
  const [temp, setTemp] = useState(initial);
  const [hasApplied, setHasApplied] = useState(!!(initialStart && initialEnd));
  // Controlled "visible month" so preset clicks navigate the calendar to
  // the month of endDate instead of stranding the user on whatever month
  // was previously open.
  const [shownDate, setShownDate] = useState(initial[0].endDate);
  // 12-hour time pickers. Defaults: 12:00 AM → 11:59 PM.
  const [startT, setStartT] = useState(() => to12(initialStart, "AM"));
  const [endT,   setEndT]   = useState(() => to12(initialEnd,   "PM"));
  const ref = useRef(null);          // the wrapper around the trigger button
  const triggerRef = useRef(null);   // the trigger button itself (for rect)
  const popoverRef = useRef(null);   // the portalled popover (for click-outside)
  // Viewport-fixed coordinates for the portalled popover. Computed
  // synchronously after the trigger mounts/repositions so the popover
  // never paints at (0,0) before snapping into place.
  const [coords, setCoords] = useState(null);

  // Notify parent so auto-refresh can pause while the popover is up.
  useEffect(() => { if (onOpenChange) onOpenChange(open); }, [open, onOpenChange]);

  // Compute viewport-fixed coords for the popover whenever it opens (and
  // re-compute on scroll/resize so it stays glued to the trigger).
  useLayoutEffect(() => {
    if (!open) { setCoords(null); return undefined; }
    const update = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      // Open upward by anchoring the popover's bottom to the trigger's top.
      // `right` anchors the popover's right edge to the trigger's right edge
      // so it never overflows the viewport on that side.
      setCoords({
        bottom: window.innerHeight - r.top + 8,
        right: window.innerWidth - r.right,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true); // capture so nested scrollers fire too
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Body scroll lock — prevents the page from jumping when the popover
  // opens upward and overlaps the viewport bottom.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Keep the picker mirrored to the parent's range so the two controls stay in
  // sync both ways. Clearing it (outer/calendar Clear nulls rangeStart/End)
  // flips the label to "—— ——"; a range set elsewhere (a calendar click)
  // adopts that window so the button shows it too. Skipped while the popover is
  // open so an in-progress edit is never yanked out from under the user.
  useEffect(() => {
    if (!initialStart || !initialEnd) { setHasApplied(false); return; }
    if (open) return;
    const next = [{ startDate: initialStart, endDate: initialEnd, key: "selection" }];
    setCommitted(next);
    setTemp(next);
    setStartT(to12(initialStart, "AM"));
    setEndT(to12(initialEnd, "PM"));
    setShownDate(initialEnd);
    setHasApplied(true);
  }, [initialStart, initialEnd, open]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      // Popover is portalled into document.body, so it isn't a descendant
      // of `ref` anymore — check both the trigger wrapper and the popover.
      const insideTrigger = ref.current && ref.current.contains(e.target);
      const insidePopover = popoverRef.current && popoverRef.current.contains(e.target);
      if (insideTrigger || insidePopover) return;
      setOpen(false);
      setTemp(committed);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [committed]);

  const setRangeDays = (offsetStart, offsetEnd = offsetStart) => {
    const s = new Date(); s.setDate(s.getDate() + offsetStart);
    const e = new Date(); e.setDate(e.getDate() + offsetEnd);
    setTemp([{ startDate: s, endDate: e, key: "selection" }]);
    setStartT({ h: 12, m: 0, mer: "AM" });
    setEndT({   h: 11, m: 59, mer: "PM" });
    setShownDate(e); // jump the visible month to the preset's end
  };

  const handleApply = () => {
    const [sH, sM] = to24(startT.h, startT.m, startT.mer);
    const [eH, eM] = to24(endT.h,   endT.m,   endT.mer);
    const s = new Date(temp[0].startDate); s.setHours(sH, sM, 0, 0);
    const e = new Date(temp[0].endDate);   e.setHours(eH, eM, 59, 999);
    const stamped = [{ startDate: s, endDate: e, key: "selection" }];
    setCommitted(stamped);
    setTemp(stamped);
    setHasApplied(true);
    onApply(s, e);
    setOpen(false);
  };
  const handleCancel = () => {
    setTemp(committed);
    setStartT(to12(committed[0]?.startDate, "AM"));
    setEndT(to12(committed[0]?.endDate,     "PM"));
    setShownDate(committed[0]?.endDate || new Date());
    setOpen(false);
  };
  const handleClear = () => {
    setHasApplied(false);
    setStartT({ h: 12, m: 0, mer: "AM" });
    setEndT({   h: 11, m: 59, mer: "PM" });
    onClear();
    setOpen(false);
  };

  const c = committed[0];
  const label = hasApplied
    ? `${fmtBtnDate(c.startDate)} - ${fmtBtnDate(c.endDate)}`
    : "—— ——";

  // Detect which preset matches the current temp range so we can highlight
  // its button. Compares local YYYY-MM-DD so timezone drift can't miss a match.
  const activePreset = (() => {
    const t = temp[0];
    if (!t?.startDate || !t?.endDate) return null;
    const s = localYmd(t.startDate);
    const e = localYmd(t.endDate);
    const ymd = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return localYmd(d); };
    if (s === ymd(0)   && e === ymd(0))   return "today";
    if (s === ymd(-1)  && e === ymd(-1))  return "yesterday";
    if (s === ymd(-6)  && e === ymd(0))   return "7d";
    if (s === ymd(-29) && e === ymd(0))   return "30d";
    return null;
  })();

  const presetBtn = (key, text, onClick) => {
    const active = activePreset === key;
    return (
      <button
        key={key}
        onClick={onClick}
        style={{
          height: 28,
          fontSize: 11,
          fontWeight: 500,
          borderRadius: 6,
          backgroundColor: active ? "#1540a4" : "#ffffff",
          color: active ? "#ffffff" : "#475569",
          border: `1px solid ${active ? "#1540a4" : "#e2e8f0"}`,
          width: "100%",
        }}
      >
        {text}
      </button>
    );
  };

  return (
    <div className="relative inline-block" ref={ref}>
      <style>{COMPACT_CAL_CSS}</style>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-10 px-3 text-sm font-medium border border-gray-200 rounded-lg shadow-sm bg-white text-gray-800 hover:bg-gray-50"
      >
        <FiCalendar className="w-4 h-4 text-gray-600" />
        <span className="text-xs">{label}</span>
      </button>
      {open && coords && createPortal(
        <div
          ref={popoverRef}
          className="rdr-compact"
          style={{
            position: "fixed",
            bottom: coords.bottom,
            right: coords.right,
            zIndex: 9999,
            width: 280,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
            overflow: "hidden",
          }}
        >
          {/* Preset 2×2 grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 10, borderBottom: "1px solid #f1f5f9" }}>
            {presetBtn("today",     "Today",     () => setRangeDays(0))}
            {presetBtn("yesterday", "Yesterday", () => setRangeDays(-1))}
            {presetBtn("7d",        "7 days",    () => setRangeDays(-6, 0))}
            {presetBtn("30d",       "30 days",   () => setRangeDays(-29, 0))}
          </div>

          {/* Calendar */}
          <DateRange
            ranges={temp}
            shownDate={shownDate}
            onChange={(r) => { setTemp([r.selection]); setShownDate(r.selection.endDate); }}
            onShownDateChange={setShownDate}
            moveRangeOnFirstSelection={false}
            rangeColors={["#1540a4"]}
            minDate={new Date("2020-01-01")}
            maxDate={new Date()}
            showDateDisplay={false}
            showMonthAndYearPickers={true}
          />

          {/* From / To time row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 10px",
              background: "#fafafa",
              borderTop: "1px solid #f1f5f9",
              overflow: "visible",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b", flexShrink: 0 }}>From</span>
            <TimeWidget value={startT} onChange={setStartT} />
            <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b", flexShrink: 0 }}>To</span>
            <TimeWidget value={endT} onChange={setEndT} />
          </div>

          {/* Footer: right-aligned Clear / Cancel / Apply */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 6,
              padding: "8px 10px",
              borderTop: "1px solid #f1f5f9",
            }}
          >
            <button
              onClick={handleClear}
              style={{ height: 28, fontSize: 11, padding: "0 12px", borderRadius: 6, background: "#ffffff", color: "#64748b", border: "1px solid #e2e8f0" }}
            >
              Clear
            </button>
            <button
              onClick={handleCancel}
              style={{ height: 28, fontSize: 11, padding: "0 12px", borderRadius: 6, background: "#ffffff", color: "#64748b", border: "1px solid #e2e8f0" }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              style={{ height: 28, fontSize: 11, padding: "0 14px", borderRadius: 6, background: "#1540a4", color: "#ffffff", fontWeight: 700, border: "none" }}
            >
              Apply
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Daily-volume delivery calendar ──────────────────────────────────────────
// Classify a day's delivery health. A "failure" is anything that did NOT
// successfully deliver: bounced, failed, skipped (not sent) and spam.
//   0 fails → all delivered · 1-2 → partial failure · 3+ → multiple failures.
function dayStatus(d) {
  if (!d || (d.total || 0) === 0) return "empty";
  const fails = (d.bounced || 0) + (d.failed || 0) + (d.skipped || 0) + (d.spam || 0);
  if (fails === 0) return "delivered";
  if (fails <= 2) return "partial";
  return "multiple";
}
const DAY_STYLE = {
  delivered: { background: "#e7f8f0", borderColor: "#a7e3c8", color: "#15803d" },
  partial:   { background: "#fff5e0", borderColor: "#f5cb7a", color: "#b45309" },
  multiple:  { background: "#fdeaea", borderColor: "#f2b3b3", color: "#b91c1c" },
  empty:     { background: "#f6f7f9", borderColor: "#edeff2", color: "#aeb4bf" },
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Renders the daily-volume window as a Mon–Sun calendar grid, each day cell
// coloured by its delivery health. Driven purely by the existing `calendar`
// state — no extra data fetching.
//
// Click-to-filter: a first click anchors a single-day selection; a second
// click completes a range (order-independent); a further click starts over.
// `onSelectRange(start, end)` receives Date objects stamped to the day's
// 00:00 → 23:59:59.999 bounds, which the parent funnels into the SAME
// rangeStart/rangeEnd that the date-picker uses — so the whole page (tiles,
// reasons, send log) reflects the selection and the picker stays in sync.
// Future days carry no sends and are non-interactive (parity with the picker).
function DeliveryCalendar({ calendar, selStart, selEnd, onSelectRange }) {
  // Pending range anchor (first click). Reset whenever the parent clears the
  // selection so a stale anchor can't silently extend a fresh pick.
  const [anchor, setAnchor] = useState(null);
  useEffect(() => { if (!selStart || !selEnd) setAnchor(null); }, [selStart, selEnd]);

  const todayYmd = localYmd(new Date());

  const weeks = useMemo(() => {
    const byDate = new Map(calendar.map((d) => [d.date, d]));
    // Show a single month — the one running today (e.g. June). Every date in
    // the month is rendered: days with sends are coloured, the rest (including
    // upcoming dates) show as neutral cells.
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    // Snap the grid to whole Mon–Sun weeks.
    const gridStart = new Date(start); gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
    const gridEnd = new Date(end);     gridEnd.setDate(gridEnd.getDate() + (6 - ((gridEnd.getDay() + 6) % 7)));
    const out = [];
    const cur = new Date(gridStart);
    while (cur <= gridEnd) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const ymd = localYmd(cur);
        week.push({ ymd, day: cur.getDate(), date: new Date(cur), inRange: cur >= start && cur <= end, data: byDate.get(ymd) || null });
        cur.setDate(cur.getDate() + 1);
      }
      out.push(week);
    }
    return out;
  }, [calendar]);

  if (!calendar.length) {
    return <p className="text-gray-400 text-sm py-6 text-center">No sends in this window yet.</p>;
  }

  const selS = selStart ? localYmd(selStart) : null;
  const selE = selEnd ? localYmd(selEnd) : null;

  const handleDayClick = (cell) => {
    if (cell.ymd > todayYmd) return; // can't filter to a future day
    const commit = (a, b) => {
      const [lo, hi] = a.ymd <= b.ymd ? [a, b] : [b, a];
      const s = new Date(lo.date); s.setHours(0, 0, 0, 0);
      const e = new Date(hi.date); e.setHours(23, 59, 59, 999);
      onSelectRange(s, e);
    };
    if (!anchor) {
      setAnchor(cell);
      commit(cell, cell); // single day until the next click
    } else {
      commit(anchor, cell);
      setAnchor(null);
    }
  };

  const legendItem = (key, label) => (
    <span className="flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded" style={{ background: DAY_STYLE[key].background, border: `1px solid ${DAY_STYLE[key].borderColor}` }} />
      {label}
    </span>
  );

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[11px] font-medium text-gray-400">{w}</div>
        ))}
      </div>
      <div className="space-y-1.5">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1.5">
            {week.map((cell) => {
              if (!cell.inRange) return <div key={cell.ymd} className="h-11 rounded-lg" />;
              const isFuture = cell.ymd > todayYmd;
              const inSel = selS && selE && cell.ymd >= selS && cell.ymd <= selE;
              const isEdge = cell.ymd === selS || cell.ymd === selE;
              const selStyle = isEdge
                ? { boxShadow: "inset 0 0 0 2px #1540a4" }
                : inSel
                ? { boxShadow: "inset 0 0 0 1px rgba(21,64,164,0.45)" }
                : null;
              return (
                <div
                  key={cell.ymd}
                  onClick={isFuture ? undefined : () => handleDayClick(cell)}
                  title={`${cell.ymd}\nTotal ${cell.data?.total || 0} · delivered ${cell.data?.delivered || 0} · bounced ${cell.data?.bounced || 0} · failed ${cell.data?.failed || 0} · skipped ${cell.data?.skipped || 0} · spam ${cell.data?.spam || 0}${isFuture ? "" : "\n\nClick to filter the page by this day · click again for a range"}`}
                  className={`h-11 rounded-lg border flex items-center justify-center text-[13px] font-semibold transition-shadow ${isFuture ? "cursor-default" : "cursor-pointer hover:brightness-95"}`}
                  style={{ ...DAY_STYLE[dayStatus(cell.data)], ...selStyle }}
                >
                  {cell.day}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-[11px] text-gray-500">
        <span className="text-gray-400">Legend:</span>
        {legendItem("delivered", "All delivered")}
        {legendItem("partial", "Partial failure")}
        {legendItem("multiple", "Multiple failures")}
      </div>
    </div>
  );
}

const EmailDetails = () => {
  const [mailType, setMailType] = useState("");
  const [days, setDays] = useState(30);
  // Auto-refresh interval in ms. 0 = off. User can change via the dropdown
  // in the header; the value is persisted to localStorage so it survives
  // reloads.
  const [refreshMs, setRefreshMs] = useState(() => {
    const stored = Number(localStorage.getItem("emailDetails.refreshMs"));
    return Number.isFinite(stored) && stored >= 0 ? stored : 60000;
  });
  useEffect(() => { localStorage.setItem("emailDetails.refreshMs", String(refreshMs)); }, [refreshMs]);

  // Date range filter — restored from localStorage so the operator's last
  // window survives a refresh. First-time visitors see no filter (both
  // null → button shows "—— ——" → API returns all-time data). The picker
  // commits Date objects via onApply with whatever start/end time the user
  // chose, and the sync effect below tags them with the IST offset before
  // sending to the API.
  const [rangeStart, setRangeStart] = useState(() => loadStoredRange().s);
  const [rangeEnd, setRangeEnd]     = useState(() => loadStoredRange().e);

  // Persist range to localStorage whenever it changes. Cleared range
  // (either side null) removes the key so a fresh page-load shows the
  // empty state instead of stale data.
  useEffect(() => {
    try {
      if (rangeStart && rangeEnd) {
        localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify({
          s: rangeStart.toISOString(),
          e: rangeEnd.toISOString(),
        }));
      } else {
        localStorage.removeItem(RANGE_STORAGE_KEY);
      }
    } catch { /* storage full / disabled — picker still works in-memory */ }
  }, [rangeStart, rangeEnd]);

  // Calendar-open flag — used to suspend the auto-refresh tick while the
  // user is interacting with the date picker, so the panel never re-renders
  // mid-selection and never closes the popover.
  const [calendarOpen, setCalendarOpen] = useState(false);

  const [summary, setSummary] = useState(null);
  const [calendar, setCalendar] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [runInfo, setRunInfo] = useState(null); // daily-send progress (total/processed/processing)

  // log table
  const [rows, setRows] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [statusFilter, setStatusFilter] = useState("");
  // Click filter — "" = all, "yes" = only rows with click_count > 0,
  // "no" = only rows with no clicks. Sent as `hasClicks` query param.
  const [clicksFilter, setClicksFilter] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(""); // datetime-local range filter
  const [dateTo, setDateTo] = useState("");
  const [logLoading, setLogLoading] = useState(false);

  // detail drawer
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false); // mail-preview toggle

  // Per-row resend in-flight set (send_ids being processed). Used to disable
  // the button during the request and to show the spinner.
  const [resendingIds, setResendingIds] = useState(() => new Set());

  // Meta-data modal (§13 admin overview) — opens an embedded MemberOverview
  // so the admin can inspect "kis user ka kya member, kis brand pe assigned,
  // last mail status kya" without leaving EmailDetails.
  const [metaOpen, setMetaOpen] = useState(false);

  // Composer modal (§10) state — single email + mail type radio + Send.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerEmail, setComposerEmail] = useState("");
  const [composerType, setComposerType] = useState("competitorUpdate");
  const [composerSending, setComposerSending] = useState(false);

  // The two §8 endpoints. Both take { email } and return the standard
  // { statusCode, body: { status, data, ... } } envelope from utils/response.js.
  // Live in compeitetor_analysis (MANUAL_SEND_API), NOT admin_panel_backend —
  // shared by the resend button and the composer modal so there is exactly
  // one send path.
  //
  // The backend's Response helpers embed `statusCode` in the response body
  // but send HTTP 200 (codebase convention). 404s are sent with `.status(404)`
  // so axios throws on those; for everything else we inspect the body and
  // synthesise an error so the call-sites can use a single try/catch.
  const sendByType = useCallback(async (mailType, email) => {
    const path = mailType === "dataReport" ? "send-data-report"
      : mailType === "keywordNotification" ? "send-keyword-notify"
      : "send-competitor";
    const res = await axios.post(`${MANUAL_SEND_API}/email-analytics/${path}`, { email });
    const env = res.data || {};
    const innerStatus = env.statusCode || env.body?.statusCode || 200;
    const innerBodyStatus = env.body?.status;
    if (innerStatus >= 400 || innerBodyStatus === "failed") {
      const err = new Error(env.body?.error || env.body?.message || "Send failed");
      err.response = { status: innerStatus, data: env };
      throw err;
    }
    return env.body || env;
  }, []);

  const resendRow = useCallback(async (row) => {
    if (!row?.send_id || !row?.to) return;
    // Keyword-alert digests are built from live per-user rows that are deleted
    // once mailed — there's no single-recipient resend for them.
    if (row.mail_type === "keywordNotification") {
      toast.error("Keyword alerts can't be resent individually — they're sent by the scheduled run.");
      return;
    }
    setResendingIds((prev) => { const n = new Set(prev); n.add(row.send_id); return n; });
    // Optimistic: flip the row's status pill to "queued" while the request is
    // in flight. The next auto-refresh tick will replace it with the real
    // final status.
    setRows((prev) => prev.map((r) => r.send_id === row.send_id ? { ...r, status: "queued" } : r));
    try {
      await sendByType(row.mail_type, row.to);
      toast.success(`Mail resent to ${row.to}`);
    } catch (e) {
      const reason = e?.response?.data?.body?.error || e?.response?.data?.error || e?.message || "Resend failed";
      toast.error(`Resend failed: ${reason}`);
      // Revert to the original status — best-effort, the row already had the
      // failed status when we rendered the button.
      setRows((prev) => prev.map((r) => r.send_id === row.send_id ? { ...r, status: row.status } : r));
    } finally {
      setResendingIds((prev) => { const n = new Set(prev); n.delete(row.send_id); return n; });
    }
  }, [sendByType]);

  const handleComposerSend = useCallback(async () => {
    const email = composerEmail.trim();
    if (!email) { toast.error("Enter an email"); return; }
    setComposerSending(true);
    try {
      await sendByType(composerType, email);
      toast.success(`Mail sent to ${email}`);
      setComposerEmail("");
      setComposerOpen(false);
    } catch (e) {
      const status = e?.response?.status;
      const reason = e?.response?.data?.body?.error || e?.response?.data?.error || e?.message || "Send failed";
      if (composerType === "competitorUpdate" && status === 404) {
        toast.error(`${email} doesn't exist in our system — cannot send competitor mail`);
      } else if (composerType === "keywordNotification" && status === 404) {
        toast.error(`${email} has no keyword notifications in the DB — nothing to send`);
      } else {
        toast.error(`Send failed: ${reason}`);
      }
    } finally {
      setComposerSending(false);
    }
  }, [composerEmail, composerType, sendByType]);

  const RESEND_STATUSES = useMemo(() => new Set(["failed", "skipped", "spam"]), []);

  // Excel export — one-click. Pulls EVERY row regardless of the current
  // date filter (the button doesn't ask, doesn't open a dialog — just
  // downloads). Other filters (status / search / mail-type) still apply
  // since they're set in the UI before the operator clicks Export, and
  // dropping them would surprise the user who's looking at a filtered view.
  const [exporting, setExporting] = useState(false);

  const runExport = useCallback(async ({ startDate, endDate } = {}) => {
    if (exporting) return;
    setExporting(true);
    try {
      // Page through the existing /log endpoint with the chosen window. Pulls
      // in chunks of 1000 so a huge result set never blows up the request,
      // and a partial result is still useful if the server hiccups midway.
      const CHUNK = 1000;
      const HARD_CAP = 100000;
      const all = [];
      let p = 1;
      while (all.length < HARD_CAP) {
        const params = new URLSearchParams({
          page: p, limit: CHUNK,
          mail_type: mailType, status: statusFilter, search: search.trim(),
        });
        if (startDate) params.append("startDate", startDate);
        if (endDate)   params.append("endDate",   endDate);
        const res = await axios.get(`${API}/log?${params}`);
        const data = res.data?.body?.data || [];
        all.push(...data);
        const total = res.data?.body?.totalRecords || 0;
        if (data.length < CHUNK || all.length >= total) break;
        p += 1;
      }
      if (!all.length) {
        toast.info("Nothing to export for the chosen window");
        return;
      }
      const rowsForSheet = all.map((r) => {
        const ts = r.sent_at || r.createdAt;
        return {
          "Send ID":        r.send_id || "",
          "Date":           ts ? new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
          "Time":           ts ? new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "",
          "To":             r.to || "",
          "Type":           r.mail_type === "dataReport" ? "Data Report" : r.mail_type === "keywordNotification" ? "Keyword Alert" : "Competitor",
          "Status":         (STATUS_META[r.status]?.label) || r.status || "",
          "Failure reason": r.failure_reason || "",
          "Message ID":     r.sendgrid_message_id || "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(rowsForSheet);
      // Column widths so the file is readable on open.
      ws["!cols"] = [
        { wch: 36 }, // Send ID
        { wch: 13 }, // Date
        { wch: 10 }, // Time
        { wch: 32 }, // To
        { wch: 14 }, // Type
        { wch: 14 }, // Status
        { wch: 40 }, // Failure reason
        { wch: 30 }, // Message ID
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Send log");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const rangeSlug = startDate && endDate
        ? `${String(startDate).slice(0,10)}_to_${String(endDate).slice(0,10)}`
        : "all-time";
      const slug = [mailType || "all", statusFilter || "any-status", rangeSlug].join("__");
      XLSX.writeFile(wb, `send-log__${slug}__${stamp}.xlsx`);
      toast.success(`Exported ${all.length} row${all.length === 1 ? "" : "s"}`);
    } catch (e) {
      const reason = e?.response?.data?.body?.message || e?.message || "Export failed";
      toast.error(`Export failed: ${reason}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, mailType, statusFilter, search]);

  const fetchOverview = useCallback(async (fresh = false) => {
    setOverviewLoading(true);
    try {
      // fresh=true bypasses the backend cache (user-initiated loads want live data).
      const qs = `?mail_type=${mailType}&days=${days}${fresh ? "&fresh=true" : ""}`;
      // When a date range is selected (calendar click or the date picker), the
      // summary tiles + failure reasons reflect THAT window. `+` in the
      // IST-tagged string must be encoded or the server reads it as a space.
      const rangeQs = (dateFrom || dateTo)
        ? `${dateFrom ? `&startDate=${encodeURIComponent(dateFrom)}` : ""}${dateTo ? `&endDate=${encodeURIComponent(dateTo)}` : ""}`
        : "";
      // The calendar grid itself stays on the days window — it's the stable
      // surface the user clicks to build the selection, so we never narrow it.
      const [s, c, b] = await Promise.all([
        axios.get(`${API}/summary${qs}${rangeQs}`),
        axios.get(`${API}/calendar${qs}`),
        axios.get(`${API}/breakdown${qs}${rangeQs}`),
      ]);
      setSummary(s.data?.body || null);
      setCalendar(c.data?.body?.daysData || []);
      setReasons(b.data?.body?.reasons || []);
    } catch (e) {
      toast.error("Failed to load email analytics");
    } finally {
      setOverviewLoading(false);
    }
  }, [mailType, days, dateFrom, dateTo]);

  const fetchRunStatus = useCallback(async () => {
    try {
      const mt = mailType || "dataReport";
      const res = await axios.get(`${API}/run-status?mail_type=${mt}`);
      setRunInfo(res.data?.body || null);
    } catch { /* non-critical */ }
  }, [mailType]);

  const fetchLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const params = new URLSearchParams({ page, limit, mail_type: mailType, status: statusFilter, search: search.trim() });
      if (dateFrom) params.append("startDate", dateFrom);
      if (dateTo) params.append("endDate", dateTo);
      // hasClicks=true → only rows with at least one click. hasClicks=false →
      // only rows with no clicks. Backend should filter on click_count.
      if (clicksFilter === "yes") params.append("hasClicks", "true");
      if (clicksFilter === "no")  params.append("hasClicks", "false");
      const res = await axios.get(`${API}/log?${params}`);
      let rows = res.data?.body?.data || [];
      // Defensive client-side filter — if backend hasn't been updated to
      // honour hasClicks yet, we still narrow the result so the UI matches
      // what the user picked. Once the backend filters server-side this is
      // a no-op (all rows already match).
      if (clicksFilter === "yes") rows = rows.filter((r) => Number(r.click_count || 0) > 0);
      if (clicksFilter === "no")  rows = rows.filter((r) => !Number(r.click_count || 0));
      setRows(rows);
      setTotalRecords(res.data?.body?.totalRecords || 0);
    } catch (e) {
      setRows([]);
      setTotalRecords(0);
    } finally {
      setLogLoading(false);
    }
  }, [page, limit, mailType, statusFilter, clicksFilter, search, dateFrom, dateTo]);

  // User-initiated loads (mount + tab/filter/days change) read LIVE (bypass cache).
  useEffect(() => { fetchOverview(true); }, [fetchOverview]);
  useEffect(() => { fetchLog(); }, [fetchLog]);
  useEffect(() => { fetchRunStatus(); }, [fetchRunStatus]);
  useEffect(() => { setPage(1); }, [mailType, statusFilter, clicksFilter, search, days, dateFrom, dateTo]);

  // Auto-refresh: poll silently at the user's chosen interval. 0 disables
  // it entirely (manual button only). Background polls use the cheap 5s
  // cache; the log table and run-status are uncached so progress shows
  // immediately. The tick is suspended while the date picker is open so a
  // mid-selection re-render can never close the popover or wipe the user's
  // in-progress selection. When the popover closes, the interval restarts
  // from zero and resumes ticking.
  useEffect(() => {
    if (!refreshMs || calendarOpen) return undefined;
    const id = setInterval(() => { fetchOverview(false); fetchLog(); fetchRunStatus(); }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, calendarOpen, fetchOverview, fetchLog, fetchRunStatus]);

  // rangeStart/rangeEnd → dateFrom/dateTo. Strings are IST-tagged so the
  // backend's date parsing can't drift them into the previous/next UTC day.
  // Null on either side means "no filter on that bound".
  useEffect(() => {
    if (rangeStart && rangeEnd) {
      setDateFrom(toIstIso(rangeStart));
      setDateTo(toIstIso(rangeEnd));
    } else {
      setDateFrom("");
      setDateTo("");
    }
  }, [rangeStart, rangeEnd]);

  const openDetail = async (row) => {
    setSelected(row);
    setDetail(null);
    setShowPreview(false);
    setDetailLoading(true);
    try {
      const res = await axios.get(`${API}/log/${row.send_id}`);
      setDetail(res.data?.body || null);
    } catch {
      toast.error("Failed to load send detail");
    } finally {
      setDetailLoading(false);
    }
  };

  // Active summary block = the chosen mail type, or `total` when "All".
  const activeSummary = useMemo(() => {
    if (!summary) return null;
    if (mailType && summary.byType?.[mailType]) return summary.byType[mailType];
    return summary.total;
  }, [summary, mailType]);

  const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

  // Tile → Send-log filter. Status tiles set statusFilter; the Clicks tile sets
  // the click filter. Each clears the other so the log shows exactly that slice,
  // then scrolls down to the Send log. The log toolbar's "Clear" button
  // (already present) resets these.
  const logRef = useRef(null);
  const scrollToLog = () => { try { logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* noop */ } };
  const filterByStatus = (s) => { setStatusFilter(s); setClicksFilter(""); scrollToLog(); };
  const filterByClicks = () => { setClicksFilter("yes"); setStatusFilter(""); scrollToLog(); };

  return (
    <div className="bg-[#f7f8fb] rounded-[10px] w-full h-[calc(100%-120px)] overflow-auto">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h3 className="text-[#1f296a] font-bold text-[22px]">Email Analytics</h3>
          <p className="text-gray-400 text-[12px]">Delivery audit for competitor update & data report mails</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex bg-white rounded-lg border border-gray-200 overflow-hidden shrink-0 h-10">
            {MAIL_TYPES.map((t) => {
              const active = mailType === t.key;
              return (
                <button
                  key={t.key || "all"}
                  onClick={() => setMailType(t.key)}
                  style={active ? { backgroundColor: "#1540a4", color: "#ffffff" } : undefined}
                  className={`px-3.5 h-full text-[13px] font-medium whitespace-nowrap transition-colors ${active ? "" : "text-gray-600 hover:bg-gray-50"}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-10 px-3 text-[13px] border border-gray-200 rounded-lg bg-white text-gray-700 shrink-0"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={() => setMetaOpen(true)}
            className="flex items-center gap-1.5 h-10 px-3 text-[13px] font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            title="Members + brand-assignment meta data"
          >
            <FiDatabase className="w-3.5 h-3.5" />
            Meta data
          </button>
          <button
            onClick={() => runExport()}
            disabled={exporting}
            className="flex items-center gap-1.5 h-10 px-3 text-[13px] font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            title="Download every send-log entry as Excel"
          >
            <FiDownload className={`w-3.5 h-3.5 ${exporting ? "animate-pulse" : ""}`} />
            {exporting ? "Exporting…" : "Export"}
          </button>
          <button
            onClick={() => { setComposerEmail(""); setComposerType("competitorUpdate"); setComposerOpen(true); }}
            className="flex items-center gap-1.5 h-10 px-3 text-[13px] font-medium rounded-lg hover:opacity-90 whitespace-nowrap shrink-0"
            style={{ backgroundColor: "#1540a4", color: "#ffffff", border: "1px solid #1540a4" }}
            title="Compose & send a one-off mail"
          >
            <FiSend className="w-3.5 h-3.5" />
            Send custom mail
          </button>
        <button onClick={() => { fetchOverview(true); fetchLog(); fetchRunStatus(); }} className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50" title="Refresh now">
            <FiRefreshCw className={`w-4 h-4 text-gray-600 ${overviewLoading || logLoading ? "animate-spin" : ""}`} />
          </button>
          <select
            value={refreshMs}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            title="Auto-refresh interval"
            className="h-10 px-2 text-[12px] border border-gray-200 rounded-lg bg-white text-gray-700 shrink-0"
          >
            <option value={0}>Auto: Off</option>
            <option value={15000}>Auto: 15s</option>
            <option value={30000}>Auto: 30s</option>
            <option value={60000}>Auto: 1m</option>
            <option value={120000}>Auto: 2m</option>
            <option value={300000}>Auto: 5m</option>
            <option value={900000}>Auto: 15m</option>
          </select>
        </div>
      </div>

      {/* Daily-send progress (total / processed / processing) */}
      {runInfo && (runInfo.total > 0 || runInfo.status === "running") && (
        <div className="px-6 mb-3">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[#1f296a] font-semibold text-[15px]">
                Daily report send
                <span className={`ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold ${runInfo.status === "running" ? "bg-amber-100 text-amber-700" : runInfo.status === "completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {runInfo.status === "running" ? "Processing…" : runInfo.status === "completed" ? "Completed" : "Idle"}
                </span>
              </p>
              <span className="text-[12px] text-gray-400">{runInfo.date}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div><p className="text-[11px] text-gray-400">Total to send</p><p className="text-[20px] font-bold text-[#1540a4]">{fmtNum(runInfo.total)}</p></div>
              <div><p className="text-[11px] text-gray-400">Processed</p><p className="text-[20px] font-bold text-green-600">{fmtNum(runInfo.processed)}</p></div>
              <div><p className="text-[11px] text-gray-400">Processing</p><p className="text-[20px] font-bold text-amber-600">{fmtNum(runInfo.processing)}</p></div>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#1540a4] rounded-full transition-all" style={{ width: `${runInfo.percent || 0}%` }} />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">{runInfo.percent || 0}% · {fmtNum(runInfo.processed)} / {fmtNum(runInfo.total)} processed</p>
          </div>
        </div>
      )}

      {/* Summary tiles */}
      <div className="px-6 grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-10">
        <Tile title="Accepted" value={overviewLoading ? "…" : fmtNum(activeSummary?.accepted)} sub="handed to SendGrid" />
        <Tile title="Delivered" value={overviewLoading ? "…" : fmtNum(activeSummary?.delivered)} accent="text-green-600" onClick={() => filterByStatus("delivered")} active={statusFilter === "delivered"} />
        <Tile title="Opened" value={overviewLoading ? "…" : fmtNum(activeSummary?.opened)} accent="text-teal-600" onClick={() => filterByStatus("opened")} active={statusFilter === "opened"} />
        <Tile title="Clicks" value={overviewLoading ? "…" : fmtNum(activeSummary?.clicks)} sub={`${fmtNum(activeSummary?.clicked)} emails`} accent="text-blue-600" onClick={filterByClicks} active={clicksFilter === "yes"} />
        <Tile title="Bounced" value={overviewLoading ? "…" : fmtNum(activeSummary?.bounced)} accent="text-red-600" onClick={() => filterByStatus("bounced")} active={statusFilter === "bounced"} />
        <Tile title="Spam" value={overviewLoading ? "…" : fmtNum(activeSummary?.spam)} accent="text-orange-600" onClick={() => filterByStatus("spam")} active={statusFilter === "spam"} />
        <Tile title="Unsubscribed" value={overviewLoading ? "…" : fmtNum(activeSummary?.unsubscribed)} accent="text-purple-600" onClick={() => filterByStatus("unsubscribed")} active={statusFilter === "unsubscribed"} />
        <Tile title="Failed" value={overviewLoading ? "…" : fmtNum(activeSummary?.failed)} accent="text-rose-600" onClick={() => filterByStatus("failed")} active={statusFilter === "failed"} />
        <Tile title="Skipped" value={overviewLoading ? "…" : fmtNum(activeSummary?.skipped)} accent="text-gray-500" onClick={() => filterByStatus("skipped")} active={statusFilter === "skipped"} />
        <Tile title="Delivery rate" value={overviewLoading ? "…" : `${activeSummary?.deliveryRate ?? 0}%`} sub={`bounce ${activeSummary?.bounceRate ?? 0}%`} accent="text-[#1540a4]" />
      </div>

      {/* Heatmap + reasons */}
      <div className="px-6 mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <p className="text-[#1f296a] font-semibold text-[15px]">
              Delivery Calender — {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })} (All Users)
            </p>
            {(rangeStart && rangeEnd) && (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-medium text-[#1540a4] bg-[#eef2fb] px-2 py-1 rounded-md whitespace-nowrap">
                  {fmtBtnDate(rangeStart)}{fmtBtnDate(rangeStart) !== fmtBtnDate(rangeEnd) ? ` – ${fmtBtnDate(rangeEnd)}` : ""}
                </span>
                <button
                  onClick={() => { setRangeStart(null); setRangeEnd(null); }}
                  className="flex items-center gap-1 text-[11px] font-medium text-gray-500 border border-gray-200 rounded-md px-2 py-1 hover:bg-gray-50"
                  title="Clear the date selection and reset the page"
                >
                  <FiX className="w-3 h-3" /> Clear
                </button>
              </div>
            )}
          </div>
          <DeliveryCalendar
            calendar={calendar}
            selStart={rangeStart}
            selEnd={rangeEnd}
            onSelectRange={(s, e) => { setRangeStart(s); setRangeEnd(e); }}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 overflow-y-auto">
          <p className="text-[#1f296a] font-semibold text-[15px] mb-3">Why it didn't deliver</p>
          {reasons.length === 0 ? (
            <p className="text-gray-400 text-sm py-6 text-center">No failures / bounces 🎉</p>
          ) : (
            <div className="space-y-2 max-h-[180px] overflow-auto pr-1">
              {reasons.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusPill status={r.status} />
                    <span className="text-[12px] text-gray-600 truncate" title={r.reason}>{r.reason}</span>
                  </div>
                  <span className="text-[13px] font-bold text-gray-800 flex-shrink-0">{fmtNum(r.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Suppression / Excluded — live SendGrid suppression lists (count + list
          + reason + daily excluded). Self-contained; reads compeitetor_analysis
          /data-report/contacts via MANUAL_SEND_API. */}
      <SuppressionPanel apiBase={MANUAL_SEND_API} selStart={rangeStart} selEnd={rangeEnd} />

      {/* Log table */}
      <div ref={logRef} className="px-6 mt-5 pb-8">
        <div className="bg-white rounded-xl border border-gray-100">
          <div className="flex flex-wrap gap-2 items-center justify-between p-4 border-b border-gray-100">
            <p className="text-[#1f296a] font-semibold text-[15px]">Send log</p>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <CiSearch className="h-5 w-5 text-gray-400 absolute left-2.5 top-2.5" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by email…"
                  className="pl-9 pr-3 h-10 w-[240px] text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1540a4]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 px-3 text-sm border border-gray-200 rounded-lg bg-white text-gray-700"
              >
                <option value="">All statuses</option>
                {Object.keys(STATUS_META).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
              <select
                value={clicksFilter}
                onChange={(e) => setClicksFilter(e.target.value)}
                title="Filter by click engagement"
                className="h-10 px-3 text-sm border border-gray-200 rounded-lg bg-white text-gray-700"
              >
                <option value="">All clicks</option>
                <option value="yes">Clicked</option>
                <option value="no">Not clicked</option>
              </select>
              <EmailDateRange
                initialStart={rangeStart}
                initialEnd={rangeEnd}
                onApply={(s, e) => { setRangeStart(s); setRangeEnd(e); }}
                onClear={() => { setRangeStart(null); setRangeEnd(null); }}
                onOpenChange={setCalendarOpen}
              />
              {(rangeStart || rangeEnd || statusFilter || clicksFilter || search) && (
                <button
                  onClick={() => { setRangeStart(null); setRangeEnd(null); setStatusFilter(""); setClicksFilter(""); setSearch(""); }}
                  className="h-10 px-3 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <Table className="min-w-[1240px] table-fixed">
            <colgroup>
              <col className="w-[140px]" />{/* Date */}
              <col className="w-[110px]" />{/* Time */}
              <col className="w-[230px]" />{/* To */}
              <col className="w-[140px]" />{/* Type */}
              <col className="w-[150px]" />{/* Status */}
              <col className="w-[100px]" />{/* Clicks */}
              <col className="w-[240px]" />{/* Reason */}
              <col className="w-[190px]" />{/* Message ID */}
              <col className="w-[120px]" />{/* Action */}
            </colgroup>
            <TableHeader>
              <TableRow className="bg-gray-50/80 hover:bg-gray-50/80 text-[12px] uppercase tracking-wider">
                <TableHead className="px-6 whitespace-nowrap">Date</TableHead>
                <TableHead className="px-6 whitespace-nowrap">Time</TableHead>
                <TableHead className="px-6 whitespace-nowrap">To</TableHead>
                <TableHead className="px-6 whitespace-nowrap">Type</TableHead>
                <TableHead className="px-6 whitespace-nowrap">Status</TableHead>
                <TableHead className="px-6 whitespace-nowrap text-center">Clicks</TableHead>
                <TableHead className="px-6 whitespace-nowrap">Reason</TableHead>
                <TableHead className="px-6 whitespace-nowrap">Message ID</TableHead>
                <TableHead className="px-6 whitespace-nowrap text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logLoading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9}><Loader /></TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="px-6 py-10 text-center text-gray-400">No email records</TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const ts = r.sent_at || r.createdAt;
                  const canResend = RESEND_STATUSES.has(r.status);
                  const busy = resendingIds.has(r.send_id);
                  return (
                    <TableRow
                      key={r.send_id}
                      onClick={() => openDetail(r)}
                      className="cursor-pointer text-gray-700"
                    >
                      <TableCell className="px-6 whitespace-nowrap">
                        <span className="font-medium text-gray-800">{fmtDateOnly(ts)}</span>
                      </TableCell>
                      <TableCell className="px-6 whitespace-nowrap text-gray-500 tabular-nums">{fmtTimeOnly(ts)}</TableCell>
                      <TableCell className="px-6 truncate" title={r.to}>{r.to}</TableCell>
                      <TableCell className="px-6 whitespace-nowrap">
                        <span className="px-2 py-1 rounded-md text-[11px] font-semibold bg-[#eef2fb] text-[#1540a4]">
                          {r.mail_type === "dataReport" ? "Data Report" : r.mail_type === "keywordNotification" ? "Keyword Alert" : "Competitor"}
                        </span>
                      </TableCell>
                      <TableCell className="px-6"><StatusPill status={r.status} /></TableCell>
                      <TableCell className="px-6 text-center tabular-nums">
                        {Number(r.click_count || 0) > 0 ? (
                          <span
                            title={
                              (r.clicked_at ? `First: ${fmtDate(r.clicked_at)}` : "") +
                              (r.last_clicked_at && r.last_clicked_at !== r.clicked_at ? `\nLast: ${fmtDate(r.last_clicked_at)}` : "")
                            }
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-[#1540a4] border border-blue-100"
                          >
                            {fmtNum(r.click_count)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-6 truncate text-gray-500" title={r.failure_reason || ""}>{r.failure_reason || "—"}</TableCell>
                      <TableCell className="px-6 truncate text-gray-400 tabular-nums" title={r.sendgrid_message_id || ""}>{r.sendgrid_message_id || "—"}</TableCell>
                      <TableCell className="px-6 text-center" onClick={(e) => e.stopPropagation()}>
                        {canResend ? (
                          <button
                            onClick={() => resendRow(r)}
                            disabled={busy}
                            title={`Resend to ${r.to}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-50 disabled:cursor-wait"
                            style={{ backgroundColor: "#1540a4", color: "#ffffff", borderColor: "#1540a4" }}
                          >
                            <FiRotateCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
                            {busy ? "Sending…" : "Resend"}
                          </button>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between p-4 text-[13px] text-gray-500">
            <span>{fmtNum(totalRecords)} records</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <span>Page {page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        </div>
      </div>

      {/* Meta-data drawer — full-viewport overlay rendering the MemberOverview
          component inline so the admin sees the members/brand/status meta
          without leaving EmailDetails. Click backdrop or X to close. */}
      {metaOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setMetaOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-[95vw] h-[92vh] max-w-[1400px] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <div style={{ backgroundColor: "#eef2fb", color: "#1540a4", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FiDatabase className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[#1f296a] font-bold text-[15px]">Meta data</p>
                  <p className="text-gray-400 text-[11px]">Members + brand assignments + per-member-brand last status</p>
                </div>
              </div>
              <button
                onClick={() => setMetaOpen(false)}
                className="text-gray-500 hover:text-gray-800"
                title="Close"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <MemberOverview />
            </div>
          </div>
        </div>
      )}

      {/* Custom-mail composer (§10). Centered modal, single email + mail-type
          radio + Send. Sends through the same §8 endpoints as the resend
          button. competitorUpdate is mongo-validated server-side; dataReport
          accepts any address. */}
      {composerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !composerSending && setComposerOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-[440px] max-w-[92vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div style={{ backgroundColor: "#eef2fb", color: "#1540a4", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FiSend className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[#1f296a] font-bold text-[15px]">Send custom mail</p>
                  <p className="text-gray-400 text-[11px]">One-off send · admin-triggered</p>
                </div>
              </div>
              <button
                onClick={() => !composerSending && setComposerOpen(false)}
                className="text-gray-500 hover:text-gray-800 disabled:opacity-50"
                disabled={composerSending}
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Recipient email</label>
                <input
                  type="email"
                  value={composerEmail}
                  onChange={(e) => setComposerEmail(e.target.value)}
                  placeholder="user@example.com"
                  autoFocus
                  disabled={composerSending}
                  onKeyDown={(e) => { if (e.key === "Enter") handleComposerSend(); }}
                  className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1540a4] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Mail type</label>
                <div className="flex gap-2">
                  {[
                    { key: "competitorUpdate",    label: "Competitor",   hint: "Validated against user_details" },
                    { key: "dataReport",          label: "Data Report",  hint: "No validation — any email" },
                    { key: "keywordNotification", label: "Keyword Alert", hint: "Email must have rows in keyword_ad_notifications; testing send — rows are NOT deleted" },
                  ].map((t) => {
                    const active = composerType === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setComposerType(t.key)}
                        disabled={composerSending}
                        title={t.hint}
                        style={active ? { backgroundColor: "#1540a4", color: "#ffffff", borderColor: "#1540a4" } : undefined}
                        className={`flex-1 h-10 text-[13px] font-medium rounded-lg border transition-colors disabled:opacity-50 ${active ? "" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  {composerType === "competitorUpdate"
                    ? "Competitor mails are built from the user's own monitored brands. If this email isn't in our DB, the server returns 404 and no mail is sent."
                    : composerType === "keywordNotification"
                    ? "Sends the keyword-alert digest. The email must already have rows in keyword_ad_notifications (else 404). Testing path — the rows are NOT deleted, so you can re-send."
                    : "Data Report has no DB check — any email is accepted."}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
              <button
                onClick={() => setComposerOpen(false)}
                disabled={composerSending}
                className="h-9 px-4 text-[13px] font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleComposerSend}
                disabled={composerSending || !composerEmail.trim()}
                className="h-9 px-4 text-[13px] font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                style={{ backgroundColor: "#1540a4", color: "#ffffff", border: "1px solid #1540a4" }}
              >
                {composerSending ? <FiRotateCw className="w-3.5 h-3.5 animate-spin" /> : <FiSend className="w-3.5 h-3.5" />}
                {composerSending ? "Sending…" : "Send mail"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <div className="w-[460px] max-w-full h-full bg-white shadow-2xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
              <div>
                <p className="text-[#1f296a] font-bold text-[16px]">Send detail</p>
                <p className="text-gray-400 text-[12px] break-all">{selected.send_id}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-800"><FiX className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div><p className="text-gray-400 text-[11px]">To</p><p className="text-gray-800 break-all">{selected.to}</p></div>
                <div><p className="text-gray-400 text-[11px]">Type</p><p className="text-gray-800">{selected.mail_type}</p></div>
                <div><p className="text-gray-400 text-[11px]">Status</p><StatusPill status={selected.status} /></div>
                <div><p className="text-gray-400 text-[11px]">Sent at</p><p className="text-gray-800">{fmtDate(selected.sent_at || selected.createdAt)}</p></div>
                {/* Click history — populated by the SendGrid `click` webhook.
                    Shows the count, first/last timestamps, and every distinct
                    URL the recipient has clicked. */}
                {(selected.click_count > 0 || selected.clicked_at) && (
                  <div className="col-span-2">
                    <p className="text-gray-400 text-[11px] mb-1">Clicks</p>
                    <div className="bg-blue-50/40 border border-blue-100 rounded-lg p-2.5 space-y-1.5">
                      <div className="flex items-center gap-3 text-[12px] text-gray-700">
                        <span><b className="text-[#1540a4]">{fmtNum(selected.click_count || 0)}</b> total</span>
                        {selected.clicked_at && (
                          <span className="text-gray-500">· first: <b className="text-gray-700">{fmtDate(selected.clicked_at)}</b></span>
                        )}
                        {selected.last_clicked_at && selected.last_clicked_at !== selected.clicked_at && (
                          <span className="text-gray-500">· last: <b className="text-gray-700">{fmtDate(selected.last_clicked_at)}</b></span>
                        )}
                      </div>
                      {Array.isArray(selected.clicked_urls) && selected.clicked_urls.length > 0 && (
                        <div className="pt-1.5 border-t border-blue-100/70">
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Links clicked</p>
                          <div className="space-y-0.5">
                            {selected.clicked_urls.map((u, i) => (
                              <a
                                key={i}
                                href={u}
                                target="_blank"
                                rel="noreferrer"
                                className="block text-[11px] text-[#1540a4] hover:underline truncate"
                                title={u}
                              >
                                {u}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {selected.failure_reason && (
                  <div className="col-span-2"><p className="text-gray-400 text-[11px]">Failure reason</p><p className="text-rose-600">{selected.failure_reason}</p></div>
                )}
                {selected.sendgrid_message_id && (
                  <div className="col-span-2"><p className="text-gray-400 text-[11px]">SendGrid message id</p><p className="text-gray-600 break-all">{selected.sendgrid_message_id}</p></div>
                )}
                {selected.meta && Object.keys(selected.meta).length > 0 && (
                  <div className="col-span-2">
                    <p className="text-gray-400 text-[11px] mb-1">Snapshot</p>
                    {selected.mail_type === "dataReport" ? (
                      <p className="text-gray-700">Today: <b>{fmtNum(selected.meta.todayTotal)}</b> new · All-time: <b>{fmtNum(selected.meta.allTime)}</b></p>
                    ) : selected.mail_type === "keywordNotification" ? (
                      <p className="text-gray-700"><b>{fmtNum(selected.meta.top ?? selected.meta.terms)}</b> tracked term{(selected.meta.top ?? selected.meta.terms) === 1 ? "" : "s"} with new ads</p>
                    ) : (
                      <div>
                        <p className="text-gray-600 mb-2">
                          {fmtNum(selected.meta.brands)} brands · {fmtNum(selected.meta.competitors)} competitors
                          {selected.meta.dateLabel ? ` · ${selected.meta.dateLabel}` : ""}
                        </p>
                        {Array.isArray(selected.meta.cc) && selected.meta.cc.length > 0 && (
                          <p className="text-[12px] mb-2">
                            <span className="text-gray-400">CC'd to: </span>
                            <span className="text-[#1540a4] font-medium">{selected.meta.cc.join(", ")}</span>
                          </p>
                        )}
                        <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
                          {(selected.meta.brandsDetail || []).map((b, i) => (
                            <div key={i} className="border border-gray-100 rounded-lg p-2.5">
                              <p className="font-semibold text-gray-800 text-[13px]">
                                {b.name || "—"}
                                {b.domain ? <span className="text-gray-400 font-normal"> · {b.domain}</span> : null}
                              </p>
                              {Array.isArray(b.cc) && b.cc.length > 0 && (
                                <p className="text-[11px] mt-0.5">
                                  <span className="text-gray-400">CC: </span>
                                  <span className="text-[#1540a4]">{b.cc.join(", ")}</span>
                                  <span className={["sent", "delivered", "opened", "bounced", "spam", "unsubscribed"].includes(selected.status) ? "text-green-600 font-medium" : "text-rose-600 font-medium"}>
                                    {" "}· {["sent", "delivered", "opened", "bounced", "spam", "unsubscribed"].includes(selected.status) ? "sent ✓" : "not sent"}
                                  </span>
                                </p>
                              )}
                              <div className="mt-1.5 space-y-1">
                                {(b.competitors || []).map((c, j) => (
                                  <div key={j} className="flex items-center justify-between gap-2">
                                    <span className="text-gray-600 text-[12px] truncate" title={c.name}>{c.name}</span>
                                    <span className="flex gap-1 shrink-0">
                                      {(c.networks || []).length
                                        ? c.networks.map((n) => <NetworkChip key={n} net={n} />)
                                        : <span className="text-gray-300 text-[10px]">—</span>}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          {(!selected.meta.brandsDetail || selected.meta.brandsDetail.length === 0) && (
                            <p className="text-gray-400 text-[12px]">No competitor snapshot</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[#1f296a] font-semibold text-[14px] mb-2">Event timeline</p>
                {detailLoading ? (
                  <p className="text-gray-400 text-sm">Loading…</p>
                ) : !detail || detail.events?.length === 0 ? (
                  <p className="text-gray-400 text-sm">No SendGrid events yet (webhook not wired or pending).</p>
                ) : (
                  <ol className="relative border-l border-gray-200 ml-2">
                    {detail.events.map((ev) => (
                      <li key={ev.event_id} className="mb-4 ml-4">
                        <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-[#1540a4]" />
                        <p className="text-[13px] font-semibold text-gray-800 capitalize">{ev.event_type}</p>
                        <p className="text-[11px] text-gray-400">{fmtDate(ev.event_ts)}</p>
                        {ev.reason && <p className="text-[12px] text-rose-600">{ev.reason}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Email preview — the EXACT mail this user received (stored in
                  meta.previewHtml at send time). Rendered in a sandboxed iframe
                  so the mail's own CSS can't leak into the admin panel. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[#1f296a] font-semibold text-[14px]">Email preview</p>
                  {detail?.log?.meta?.previewHtml && (
                    <button
                      onClick={() => setShowPreview((v) => !v)}
                      className="text-[12px] font-medium text-[#1540a4] hover:underline"
                    >
                      {showPreview ? "Hide" : "Show mail"}
                    </button>
                  )}
                </div>
                {detailLoading ? (
                  <p className="text-gray-400 text-sm">Loading…</p>
                ) : !detail?.log?.meta?.previewHtml ? (
                  <p className="text-gray-400 text-sm">No preview stored for this send (older row, or a skipped/queued send).</p>
                ) : showPreview ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                    <iframe
                      title="mail-preview"
                      sandbox=""
                      srcDoc={detail.log.meta.previewHtml}
                      className="w-full"
                      style={{ height: "70vh", border: "0" }}
                    />
                  </div>
                ) : (
                  <p className="text-gray-400 text-[12px]">Click “Show mail” to view the exact email sent to {selected.to}.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
};

export default EmailDetails;

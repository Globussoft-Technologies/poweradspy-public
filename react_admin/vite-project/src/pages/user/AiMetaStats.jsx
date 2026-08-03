import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FaRegCalendarAlt } from "react-icons/fa";
import { GoTriangleDown, GoTriangleUp } from "react-icons/go";
import { FiRefreshCw, FiCpu } from "react-icons/fi";
import HelmetExport from "react-helmet";

import RangeDatePicker from "./RangeDatePicker";
import AiMetaStatsTable, { formatTimestamp } from "./AiMetaStatsTable";
import { fetchAiMetaStats } from "../../store/actions/powerAdsPyActionsApi";

/* ------------------------------------------------------------------ */
/* AI-Meta — daily processing statistics per platform.                 */
/*                                                                     */
/* Counts are rows in each network's <net>_ad_ai_meta table bucketed   */
/* by updated_at. Those tables hold no status/error column, so there   */
/* is no failure figure to show — only ads written and when.           */
/* ------------------------------------------------------------------ */

// Picker floor; the ceiling is today, since nothing can be processed in the future.
const MIN_DATE = new Date(2020, 0, 1);
const DATE_RANGE_STORAGE_KEY = "aiMetaStatsDateRange";

// Local Y-M-D (not toISOString) — the API buckets by the DB's own dates, so shifting the range
// into UTC could ask for the wrong day for anyone east/west of the server.
const toApiDate = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

// Defaults to today — the range runs to end-of-day, so "today" means today up to now.
const defaultRange = () => ({ startDate: new Date(), endDate: new Date() });

const loadSavedRange = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(DATE_RANGE_STORAGE_KEY));
    if (!saved?.from || !saved?.to) return defaultRange();

    // Parse at local midnight. Parsing YYYY-MM-DD directly uses UTC and can
    // shift the selected day in time zones behind UTC.
    const parseLocalDate = (value) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) return null;
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return toApiDate(date) === value ? date : null;
    };

    const startDate = parseLocalDate(saved.from);
    const endDate = parseLocalDate(saved.to);
    if (!startDate || !endDate || startDate > endDate || startDate < MIN_DATE || endDate > new Date()) {
      return defaultRange();
    }
    return { startDate, endDate };
  } catch {
    return defaultRange();
  }
};

const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");

const KpiTile = ({ label, value, accent = "#1f296a", sub }) => (
  <div className="flex flex-col justify-between rounded-[14px] border border-[#e6e9f5] bg-white px-5 py-4 shadow-sm min-w-[170px] flex-1">
    <span className="text-[13px] font-medium text-[#7a83a8] uppercase tracking-wide">{label}</span>
    <span className="text-[28px] font-[700] leading-tight" style={{ color: accent }}>
      {value}
    </span>
    {sub ? <span className="text-[12px] text-[#9aa2c0]">{sub}</span> : null}
  </div>
);

const AiMetaStats = () => {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.poweradspy?.aiMetaStats);
  const loading = useSelector((s) => s.poweradspy?.loadingAiMetaStats);
  const error = useSelector((s) => s.poweradspy?.aiMetaStatsError);

  const [selectedDates, setSelectedDates] = useState(loadSavedRange);
  const [draftDates, setDraftDates] = useState(selectedDates);
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef(null);

  const range = useMemo(
    () => ({ from: toApiDate(selectedDates.startDate), to: toApiDate(selectedDates.endDate) }),
    [selectedDates]
  );

  const maxDate = useMemo(() => new Date(), []);

  const load = useCallback(() => {
    dispatch(fetchAiMetaStats({ range }))
      .unwrap()
      .catch(() => {});
  }, [dispatch, range]);

  useEffect(() => {
    load();
  }, [load]);

  // Close the picker when clicking anywhere outside it.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const toggleDatePicker = () =>
    setIsOpen((prev) => {
      if (!prev) setDraftDates(selectedDates); // start the draft from the applied range
      return !prev;
    });

  const handleDateChange = useCallback((ranges) => {
    setDraftDates({
      startDate: ranges.selection.startDate,
      endDate: ranges.selection.endDate,
    });
  }, []);

  const handleApply = useCallback(() => {
    setSelectedDates(draftDates); // committing triggers the refetch via `range`
    localStorage.setItem(
      DATE_RANGE_STORAGE_KEY,
      JSON.stringify({ from: toApiDate(draftDates.startDate), to: toApiDate(draftDates.endDate) })
    );
    setIsOpen(false);
  }, [draftDates]);

  const handleCancel = useCallback(() => setIsOpen(false), []);

  const summary = stats?.summary;
  const networks = stats?.networks || [];
  const failedNetworks = networks.filter((n) => n.error);

  return (
    <>
      <HelmetExport>
        <title>AI-Meta Stats | PowerAdspy Admin Panel</title>
      </HelmetExport>

      <div className="w-full relative">
        <div className="flex justify-between items-start flex-wrap gap-3 mb-[6px]">
          <div>
            <span className="font-[700] text-[30px] text-[#264688] flex items-center gap-2">
              <FiCpu /> AI-Meta Processing Stats
            </span>
            <p className="text-[13px] text-[#7a83a8] mt-[4px]">
              Daily count of ads enriched with AI-Meta, per platform
              {stats?.generated_at
                ? ` · updated ${new Date(stats.generated_at).toLocaleTimeString()}`
                : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="flex items-center gap-1.5 border border-[#e0e0e0] rounded-xl shadow-md px-4 py-2 text-[14px] text-[#264688] hover:bg-[#f1f3ff]"
            >
              <FiRefreshCw className={loading ? "animate-spin" : ""} /> Refresh
            </button>

            <div className="relative inline-block" ref={pickerRef}>
              <div
                className="relative inline-flex items-center px-4 py-2 rounded-xl shadow-md border border-[#e0e0e0] cursor-pointer"
                onClick={toggleDatePicker}
                data-testid="date-toggle"
              >
                <FaRegCalendarAlt className="text-gray-600 mr-2" />
                <span className="text-[#264688]">
                  {range.from === range.to ? range.from : `${range.from} ~ ${range.to}`}
                </span>
                {isOpen ? (
                  <GoTriangleUp className="text-gray-600 ml-2 text-[16px]" />
                ) : (
                  <GoTriangleDown className="text-gray-600 ml-2 text-[16px]" />
                )}
              </div>

              {isOpen && (
                <RangeDatePicker
                  isOpen={isOpen}
                  selectedDates={draftDates}
                  onDateChange={handleDateChange}
                  onApply={handleApply}
                  onCancel={handleCancel}
                  minDate={MIN_DATE}
                  maxDate={maxDate}
                />
              )}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-[16px] rounded-[12px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#b91c1c]">
            Could not load statistics: {String(error)}
          </div>
        ) : null}

        {failedNetworks.length > 0 ? (
          <div className="mt-[16px] rounded-[12px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[14px] text-[#92400e]">
            {failedNetworks.length} platform
            {failedNetworks.length > 1 ? "s are" : " is"} unavailable:{" "}
            {failedNetworks.map((n) => n.label).join(", ")}.
          </div>
        ) : null}

        <div className="flex gap-4 flex-wrap mt-[20px]">
          <KpiTile
            label="Updated"
            value={fmtNum(summary?.updated)}
            accent="#16a34a"
            sub="Ads enriched in range"
          />
          <KpiTile
            label="Platforms"
            value={`${summary?.networks_ok ?? 0}/${
              (summary?.networks_ok ?? 0) + (summary?.networks_failed ?? 0)
            }`}
            sub="Reporting successfully"
          />
        </div>

        <AiMetaStatsTable networks={networks} loading={loading && !stats} />

        <p className="text-[12px] text-[#9aa2c0] mt-[14px] mb-[24px]">
          Counts are rows in each platform&apos;s AI-Meta table, bucketed by the row&apos;s latest
          write, so an ad re-processed later counts only on the later day. These tables record
          successful enrichment only — they hold no status or error column, so no failure count
          is available
          {stats?.generated_at
            ? ` · snapshot ${formatTimestamp(stats.generated_at.replace("T", " ").slice(0, 19))} UTC`
            : ""}
          .
        </p>
      </div>
    </>
  );
};

export default AiMetaStats;

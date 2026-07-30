import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FaRegCalendarAlt } from "react-icons/fa";
import { GoTriangleDown, GoTriangleUp } from "react-icons/go";
import { FiRefreshCw, FiGlobe } from "react-icons/fi";
import HelmetExport from "react-helmet";

import RangeDatePicker from "./RangeDatePicker";
import DomainRegistrationStatsTable, { formatTimestamp } from "./DomainRegistrationStatsTable";
import { fetchDomainRegistrationStats } from "../../store/actions/powerAdsPyActionsApi";

/* ------------------------------------------------------------------ */
/* Domain Registration Date — daily processing statistics per platform. */
/*                                                                     */
/* Counts come from each network's domains table `status` column, the  */
/* outcome flag of the registration-date crawler loop:                 */
/*   status 1 = date written  → Updated                                */
/*   status 2 = unresolvable  → Failed                                 */
/*   status 0 = still queued  → Pending (backlog, not yet processed)   */
/* ------------------------------------------------------------------ */

const DEFAULT_DAYS = 7;
// Picker bounds. Left unset, react-date-range offers today-100y .. today+20y — the 1926-2046
// year dropdown. The floor is 2020 (nothing in the domains tables predates it; the oldest rows
// are late 2022) and the ceiling is today, since no domain can be processed in the future.
const MIN_DATE = new Date(2020, 0, 1);

// Local Y-M-D (not toISOString) — the API buckets by the DB's own dates, so shifting the
// range into UTC could ask for the wrong day for anyone east/west of the server.
const toApiDate = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const defaultRange = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (DEFAULT_DAYS - 1));
  return { startDate: start, endDate: end };
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

const DomainRegistrationStats = () => {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.poweradspy?.domainRegistrationStats);
  const loading = useSelector((s) => s.poweradspy?.loadingDomainRegistrationStats);
  const error = useSelector((s) => s.poweradspy?.domainRegistrationStatsError);

  const [selectedDates, setSelectedDates] = useState(defaultRange);
  const [draftDates, setDraftDates] = useState(selectedDates);
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef(null);

  const range = useMemo(
    () => ({ from: toApiDate(selectedDates.startDate), to: toApiDate(selectedDates.endDate) }),
    [selectedDates]
  );

  const maxDate = useMemo(() => new Date(), []);

  const load = useCallback(() => {
    dispatch(fetchDomainRegistrationStats({ range }))
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
    setIsOpen(false);
  }, [draftDates]);

  const handleCancel = useCallback(() => setIsOpen(false), []);

  const summary = stats?.summary;
  const networks = stats?.networks || [];
  const failedNetworks = networks.filter((n) => n.error);

  return (
    <>
      <HelmetExport>
        <title>Domain Registration Stats | PowerAdspy Admin Panel</title>
      </HelmetExport>

      <div className="w-full relative">
        <div className="flex justify-between items-start flex-wrap gap-3 mb-[6px]">
          <div>
            <span className="font-[700] text-[30px] text-[#264688] flex items-center gap-2">
              <FiGlobe /> Domain Registration Date Stats
            </span>
            <p className="text-[13px] text-[#7a83a8] mt-[4px]">
              Daily processing counts for the domain registration date crawler across all
              supported platforms
              {stats?.generated_at ? ` · updated ${new Date(stats.generated_at).toLocaleTimeString()}` : ""}
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
            {failedNetworks.map((n) => n.label).join(", ")}. The remaining platforms are shown
            below.
          </div>
        ) : null}

        <div className="flex gap-4 flex-wrap mt-[20px]">
          <KpiTile label="Processed" value={fmtNum(summary?.processed)} sub="Domains attempted in range" />
          <KpiTile
            label="Updated"
            value={fmtNum(summary?.updated)}
            accent="#16a34a"
            sub="Registration date written"
          />
          <KpiTile
            label="Failed"
            value={fmtNum(summary?.failed)}
            accent="#dc2626"
            sub="No date obtainable"
          />
          <KpiTile
            label="Pending"
            value={fmtNum(summary?.pending)}
            accent="#d97706"
            sub="Still queued (all time)"
          />
          <KpiTile
            label="Platforms"
            value={`${summary?.networks_ok ?? 0}/${
              (summary?.networks_ok ?? 0) + (summary?.networks_failed ?? 0)
            }`}
            sub="Reporting successfully"
          />
        </div>

        <DomainRegistrationStatsTable networks={networks} loading={loading && !stats} />

        <p className="text-[12px] text-[#9aa2c0] mt-[14px] mb-[24px]">
          Counts are read from each platform&apos;s domains table: Updated = registration date
          written (status 1), Failed = attempted but unresolvable (status 2), Pending = still
          queued (status 0). Days are bucketed by the row&apos;s latest processing timestamp, so a
          domain re-processed later counts only on the later day
          {stats?.generated_at ? ` · snapshot ${formatTimestamp(
            stats.generated_at.replace("T", " ").slice(0, 19)
          )} UTC` : ""}
          .
        </p>
      </div>
    </>
  );
};

export default DomainRegistrationStats;

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { FiRefreshCw, FiX } from "react-icons/fi";

/**
 * Suppression / Excluded panel (NEW) — rendered inside the Email Analytics
 * dashboard (EmailDetails.jsx). Shows the LIVE SendGrid suppression lists
 * (unsubscribes / bounces / blocks / spam reports / invalid emails) which are
 * the real reason recipients get excluded from a send.
 *
 * Data source: GET {apiBase}/data-report/contacts?emails=true
 *   → { suppressions: { <kind>: { count, emails:[{email,created,reason?,status?}] } },
 *       daily: [{ date, count, emails:[{email,type,reason,created}] }] }
 *
 * - Each suppression card is clickable → modal listing that list's emails
 *   with the REASON it's suppressed + the date it was added.
 * - "Daily excluded" groups every suppression entry by the date it was added.
 * - When the parent passes a date range (selStart/selEnd — from the calendar /
 *   date-picker), the cards + daily list are filtered to suppressions ADDED in
 *   that window, so the panel matches the rest of the dashboard.
 */

const KINDS = [
  { key: "unsubscribes",   label: "Unsubscribed", accent: "text-purple-600", dot: "bg-purple-500" },
  { key: "bounces",        label: "Bounced",      accent: "text-red-600",    dot: "bg-red-500" },
  { key: "blocks",         label: "Blocked",      accent: "text-amber-600",  dot: "bg-amber-500" },
  { key: "spam_reports",   label: "Spam reports", accent: "text-orange-600", dot: "bg-orange-500" },
  { key: "invalid_emails", label: "Invalid",      accent: "text-rose-600",   dot: "bg-rose-500" },
];

const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");

// SendGrid `created` is a Unix epoch in seconds → ms.
function toMs(created) {
  if (created == null) return NaN;
  const ms = Number(created) < 1e12 ? Number(created) * 1000 : Number(created);
  return Number.isFinite(ms) ? ms : NaN;
}
function fmtCreated(created) {
  const ms = toMs(created);
  if (!Number.isFinite(ms)) return created == null ? "—" : String(created);
  return new Date(ms).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
// Local YYYY-MM-DD (matches the backend's IST day keys closely enough for
// day-level range filtering on the client).
function ymd(d) {
  if (!d) return null;
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export default function SuppressionPanel({ apiBase, selStart, selEnd }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // modal = { title, subtitle, withType, rows:[{email,reason,created,type?}] } | null
  const [modal, setModal] = useState(null);

  const fetchData = useCallback(async (fresh = false) => {
    setLoading(true);
    setError("");
    try {
      const url = `${apiBase}/data-report/contacts?emails=true${fresh ? "&fresh=true" : ""}`;
      const res = await axios.get(url);
      setData(res.data || null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Failed to load suppression data");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { fetchData(false); }, [fetchData]);

  const suppressions = data?.suppressions || {};
  const daily = data?.daily || [];

  // Date-range filter (from the parent calendar / date-picker). When set, only
  // suppressions ADDED within [selStart, selEnd] are counted / listed.
  const rangeActive = !!(selStart && selEnd);
  const inRange = useCallback((created) => {
    if (!rangeActive) return true;
    const ms = toMs(created);
    if (!Number.isFinite(ms)) return false;
    return ms >= selStart.getTime() && ms <= selEnd.getTime();
  }, [rangeActive, selStart, selEnd]);

  // Count per kind, honouring the range filter.
  const kindCount = useCallback((kind) => {
    const emails = suppressions[kind]?.emails || [];
    if (!rangeActive) return Number(suppressions[kind]?.count) || 0;
    return emails.filter((e) => inRange(e.created)).length;
  }, [suppressions, rangeActive, inRange]);

  const filteredDaily = useMemo(() => {
    if (!rangeActive) return daily;
    const s = ymd(selStart), e = ymd(selEnd);
    return daily.filter((d) => d.date >= s && d.date <= e);
  }, [daily, rangeActive, selStart, selEnd]);

  const totalSuppressed = useMemo(
    () => KINDS.reduce((s, k) => s + kindCount(k.key), 0),
    [kindCount]
  );

  const openKind = (kind) => {
    const meta = KINDS.find((k) => k.key === kind);
    const rows = (suppressions[kind]?.emails || [])
      .filter((r) => inRange(r.created))
      .map((r) => ({ email: r.email, reason: r.reason || null, created: r.created ?? null }));
    setModal({
      title: `${meta?.label || kind} — ${fmtNum(rows.length)} email${rows.length === 1 ? "" : "s"}`,
      subtitle: rangeActive ? "Live SendGrid suppression list · filtered to selected dates" : "Live SendGrid suppression list",
      withType: false,
      rows,
    });
  };

  const openDay = (day) => {
    setModal({
      title: `Excluded on ${day.date} — ${fmtNum(day.count)} email${day.count === 1 ? "" : "s"}`,
      subtitle: "Emails added to a SendGrid suppression list this day",
      withType: true,
      rows: (day.emails || []).map((r) => ({ email: r.email, reason: r.reason || null, created: r.created ?? null, type: r.type })),
    });
  };

  return (
    <div className="px-6 mt-4">
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <p className="text-[#1f296a] font-semibold text-[15px]">Suppression &amp; Excluded — live from SendGrid</p>
            <p className="text-gray-400 text-[12px]">
              Why recipients are excluded from sends (unsubscribed / bounced / blocked / spam / invalid). Click any card or day for the email list + reason.
              {rangeActive ? " · filtered to selected dates" : ""}{data?.cached ? " · cached" : ""}
            </p>
          </div>
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            className="h-9 px-3 inline-flex items-center gap-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            title="Refresh from SendGrid (bypass cache)"
          >
            <FiRefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error ? (
          <div className="py-6 text-center text-sm text-rose-600">
            {error} <button onClick={() => fetchData(true)} className="underline ml-1">Retry</button>
          </div>
        ) : (
          <>
            {/* Suppression cards */}
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 mb-4">
              {KINDS.map((k) => {
                const count = kindCount(k.key);
                return (
                  <button
                    key={k.key}
                    onClick={() => count > 0 && openKind(k.key)}
                    disabled={!count}
                    className="p-3 rounded-xl border border-gray-100 bg-white min-h-[80px] flex flex-col justify-between text-left transition-shadow enabled:hover:shadow-md enabled:cursor-pointer disabled:opacity-60"
                    title={count > 0 ? `View ${k.label} emails` : `No ${k.label} emails`}
                  >
                    <p className="text-gray-500 text-[12px] font-medium flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${k.dot}`} />{k.label}
                    </p>
                    <h3 className={`text-[22px] font-bold leading-tight ${k.accent}`}>{loading && !data ? "…" : fmtNum(count)}</h3>
                  </button>
                );
              })}
            </div>

            {/* Daily excluded */}
            <div>
              <p className="text-[#1f296a] font-semibold text-[13px] mb-2">
                Daily excluded emails {totalSuppressed ? `· ${fmtNum(totalSuppressed)} total suppressed` : ""}
              </p>
              {loading && !data ? (
                <p className="text-gray-400 text-sm py-4 text-center">Loading…</p>
              ) : filteredDaily.length === 0 ? (
                <p className="text-gray-400 text-sm py-4 text-center">{rangeActive ? "No emails suppressed in the selected dates" : "No suppressed emails 🎉"}</p>
              ) : (
                <div className="max-h-[240px] overflow-auto border border-gray-100 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-gray-500 text-[12px]">
                        <th className="text-left font-medium px-3 py-2">Date (IST)</th>
                        <th className="text-right font-medium px-3 py-2">Excluded count</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDaily.map((d) => (
                        <tr key={d.date} className="border-t border-gray-100 hover:bg-blue-50/40 cursor-pointer" onClick={() => openDay(d)}>
                          <td className="px-3 py-2 text-gray-700">{d.date}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800">{fmtNum(d.count)}</td>
                          <td className="px-3 py-2 text-right text-[12px] text-[#1540a4] font-medium">View list →</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Email-list modal */}
      {modal && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100">
              <div>
                <p className="text-[#1f296a] font-semibold text-[15px]">{modal.title}</p>
                {modal.subtitle && <p className="text-gray-400 text-[12px]">{modal.subtitle}</p>}
              </div>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-700 p-1" title="Close">
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-auto p-2">
              {modal.rows.length === 0 ? (
                <p className="text-gray-400 text-sm py-8 text-center">No emails</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-gray-500 text-[12px]">
                      <th className="text-left font-medium px-3 py-2">Email</th>
                      {modal.withType && <th className="text-left font-medium px-3 py-2">Type</th>}
                      <th className="text-left font-medium px-3 py-2">Reason</th>
                      <th className="text-left font-medium px-3 py-2">Added (IST)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modal.rows.map((r, i) => (
                      <tr key={`${r.email}-${i}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-800 break-all">{r.email}</td>
                        {modal.withType && <td className="px-3 py-2 text-gray-600">{r.type || "—"}</td>}
                        <td className="px-3 py-2 text-gray-600">{r.reason || "—"}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtCreated(r.created)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { CiSearch } from "react-icons/ci";
import { FiRefreshCw, FiChevronDown, FiChevronRight, FiUserCheck, FiUserX, FiAlertTriangle, FiCheckCircle } from "react-icons/fi";
import Loader from "./Loader";

/**
 * MemberOverview — admin meta view for the Member-Brand direct send flow
 * (manifest §13). Lists every PowerAdSpy owner who saved members, expands
 * each member's brand assignments, shows the last status + reason for each
 * member-brand pair so the admin can answer "kis user ka kya member, kis
 * brand pe assigned, last mail kya hua".
 *
 * Read-only. Backend: GET /api/members/admin-overview (compeitetor_analysis).
 */

const API = (import.meta.env.VITE_COMPETITORS_API || "http://localhost:6002/api/").replace(/\/+$/, "");

const STATUS_PILL = {
  sent:         { label: "Sent",         cls: "bg-blue-100 text-blue-700" },
  delivered:    { label: "Delivered",    cls: "bg-green-100 text-green-700" },
  opened:       { label: "Opened",       cls: "bg-teal-100 text-teal-700" },
  bounced:      { label: "Bounced",      cls: "bg-red-100 text-red-700" },
  spam:         { label: "Spam",         cls: "bg-orange-100 text-orange-700" },
  failed:       { label: "Failed",       cls: "bg-rose-100 text-rose-700" },
  skipped:      { label: "Skipped",      cls: "bg-gray-100 text-gray-600" },
  unsubscribed: { label: "Unsubscribed", cls: "bg-purple-100 text-purple-700" },
  queued:       { label: "Queued",       cls: "bg-amber-100 text-amber-700" },
};

const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");
const fmtDate = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—");

function StatusPill({ status }) {
  if (!status) return <span className="text-gray-300 text-[11px]">—</span>;
  const m = STATUS_PILL[status] || { label: status, cls: "bg-gray-100 text-gray-600" };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${m.cls}`}>{m.label}</span>;
}

const MemberOverview = () => {
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [owners, setOwners] = useState([]);
  const [summary, setSummary] = useState({ owners: 0, members: 0, assignments: 0 });
  const [expandedOwners, setExpandedOwners] = useState(() => new Set());
  const [expandedMembers, setExpandedMembers] = useState(() => new Set());

  // Debounce search input → 350ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const qs = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : "";
      const res = await axios.get(`${API}/members/admin-overview${qs}`);
      const body = res.data?.body || res.data || {};
      setOwners(Array.isArray(body.data?.owners) ? body.data.owners : (body.owners || []));
      setSummary(body.data?.summary || body.summary || { owners: 0, members: 0, assignments: 0 });
    } catch (e) {
      toast.error(`Failed to load members overview: ${e?.response?.data?.body?.message || e?.message || ""}`);
      setOwners([]);
      setSummary({ owners: 0, members: 0, assignments: 0 });
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  // Auto-expand all matching owners when a search is active so the user
  // doesn't have to manually expand each one to see the hits.
  useEffect(() => {
    if (!debouncedSearch) return;
    setExpandedOwners(new Set(owners.map((o) => o.user_id)));
  }, [debouncedSearch, owners]);

  const toggleOwner = (id) => {
    setExpandedOwners((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleMember = (id) => {
    setExpandedMembers((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  // Tile summary — quick scan.
  const tile = (label, value, accent) => (
    <div className="p-4 rounded-xl shadow-sm border border-gray-100 bg-white flex flex-col justify-between min-h-[80px]">
      <p className="text-gray-500 text-[13px] font-medium">{label}</p>
      <h2 className={`text-[24px] font-bold leading-tight ${accent || "text-[#1540a4]"}`}>{value}</h2>
    </div>
  );

  return (
    <div className="bg-[#f7f8fb] rounded-[10px] w-full h-[calc(100%-120px)] overflow-auto">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h3 className="text-[#1f296a] font-bold text-[22px]">Members overview</h3>
          <p className="text-gray-400 text-[12px]">Who added which member, to which brand, and what the last mail did.</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <CiSearch className="h-5 w-5 text-gray-400 absolute left-2.5 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search owner / member email or name…"
              className="pl-9 pr-3 h-10 w-[280px] text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1540a4]"
            />
          </div>
          <button
            onClick={fetchOverview}
            disabled={loading}
            className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title="Refresh now"
          >
            <FiRefreshCw className={`w-4 h-4 text-gray-600 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="px-6 grid grid-cols-3 gap-3 mb-4">
        {tile("Owners with members", fmtNum(summary.owners))}
        {tile("Total members", fmtNum(summary.members), "text-green-600")}
        {tile("Brand assignments", fmtNum(summary.assignments), "text-amber-600")}
      </div>

      {/* Owners list */}
      <div className="px-6 pb-8">
        <div className="bg-white rounded-xl border border-gray-100">
          {loading ? (
            <div className="p-6"><Loader /></div>
          ) : owners.length === 0 ? (
            <p className="px-6 py-10 text-center text-gray-400 text-sm">No members saved yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {owners.map((o) => {
                const isOpen = expandedOwners.has(o.user_id);
                return (
                  <div key={o.user_id} className="px-5 py-4">
                    <button
                      onClick={() => toggleOwner(o.user_id)}
                      className="flex items-center justify-between w-full text-left"
                    >
                      <div className="flex items-center gap-3">
                        {isOpen ? <FiChevronDown className="w-4 h-4 text-gray-500" /> : <FiChevronRight className="w-4 h-4 text-gray-500" />}
                        <div>
                          <p className="text-[#1f296a] font-semibold text-[14px]">{o.owner_name || "—"}</p>
                          <p className="text-gray-400 text-[12px]">{o.owner_email || "—"}</p>
                        </div>
                      </div>
                      <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        {o.members.length} member{o.members.length === 1 ? "" : "s"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="mt-3 ml-7 space-y-2">
                        {o.members.map((m) => {
                          const mOpen = expandedMembers.has(m.member_id);
                          return (
                            <div key={m.member_id} className="border border-gray-100 rounded-lg">
                              <button
                                onClick={() => toggleMember(m.member_id)}
                                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50/60 rounded-lg"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  {mOpen ? <FiChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <FiChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                                  <div className="min-w-0">
                                    <p className="text-gray-800 font-medium text-[13px] truncate">{m.name || "—"}</p>
                                    <p className="text-gray-400 text-[11px] truncate">{m.email}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {m.unassigned ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                                      <FiUserX className="w-3 h-3" /> No brand
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                                      <FiUserCheck className="w-3 h-3" /> {m.assignments.length} brand{m.assignments.length === 1 ? "" : "s"}
                                    </span>
                                  )}
                                </div>
                              </button>

                              {mOpen && (
                                <div className="px-3 pb-3 pt-0">
                                  {m.unassigned ? (
                                    <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mt-1">
                                      <FiAlertTriangle className="w-3.5 h-3.5 inline-block mr-1 align-text-bottom" />
                                      Member saved but not assigned to any brand — no mail will be sent until the owner picks at least one brand.
                                    </p>
                                  ) : (
                                    <div className="overflow-auto">
                                      <table className="min-w-full text-[12px]">
                                        <thead className="bg-gray-50">
                                          <tr className="text-left text-gray-500 uppercase text-[10px] tracking-wider">
                                            <th className="px-3 py-2 font-semibold">Brand</th>
                                            <th className="px-3 py-2 font-semibold">Last status</th>
                                            <th className="px-3 py-2 font-semibold">Last attempt</th>
                                            <th className="px-3 py-2 font-semibold">Reason / note</th>
                                            {/* <th className="px-3 py-2 font-semibold">Totals (sent · skipped · failed)</th> */}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {m.assignments.map((a) => (
                                            <tr key={a.project_id} className="border-t border-gray-100">
                                              <td className="px-3 py-2 align-top">
                                                <div className="font-medium text-gray-800">{a.brand_name || "—"}</div>
                                                {a.brand_url && <div className="text-gray-400 text-[10px] truncate max-w-[180px]">{a.brand_url}</div>}
                                              </td>
                                              <td className="px-3 py-2 align-top"><StatusPill status={a.last_status} /></td>
                                              <td className="px-3 py-2 align-top text-gray-500 tabular-nums whitespace-nowrap">{fmtDate(a.last_sent_at)}</td>
                                              <td className="px-3 py-2 align-top text-gray-500 max-w-[260px]">
                                                {a.last_status === "sent" || a.last_status === "delivered" || a.last_status === "opened" ? (
                                                  <span className="text-emerald-700 inline-flex items-center gap-1">
                                                    <FiCheckCircle className="w-3 h-3" /> Delivered
                                                  </span>
                                                ) : a.last_failure_reason ? (
                                                  <span title={a.last_failure_reason} className="truncate inline-block max-w-[240px]">{a.last_failure_reason}</span>
                                                ) : a.last_status ? "—" : (
                                                  <span className="text-gray-400">No send yet</span>
                                                )}
                                              </td>
                                              {/* <td className="px-3 py-2 align-top text-gray-600 tabular-nums">
                                                {fmtNum(a.totals?.sent || 0)} · {fmtNum(a.totals?.skipped || 0)} · {fmtNum((a.totals?.failed || 0) + (a.totals?.bounced || 0))}
                                              </td> */}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ToastContainer />
    </div>
  );
};

export default MemberOverview;

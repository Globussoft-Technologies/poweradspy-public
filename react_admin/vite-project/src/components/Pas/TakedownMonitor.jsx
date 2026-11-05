import React, { useCallback, useEffect, useRef, useState } from "react";
import Cookies from "js-cookie";
import { Link } from "react-router-dom";
import { FiRefreshCw, FiX, FiSearch } from "react-icons/fi";

/**
 * Takedown Monitor: how many ads/images were deleted, how many are waiting, how many failed, and the log of every step. READ ONLY.
 *
 * Talks only to admin_panel_backend (/admin-panel/copyright-claims/monitor/...), which checks the admin login and the reviewers' allowlist.
 * Shows B3's takedown runs (and, when one is opened, the log of each delete step per system: SQL, Mongo, Elastic, storage ...) and B2's image
 * hash jobs (and what each job did with each image). A network whose tables do not exist yet is shown as "not available", never as zero.
 * A dry run is listed apart: it deleted nothing.
 */

const CLAIMS = `${import.meta.env.VITE_ADMIN_PANEL_API || "http://localhost:4000/admin-panel"}/copyright-claims`;
const BASE = `${CLAIMS}/monitor`;

const GROUP_META = {
  done: { label: "Done", cls: "bg-green-100 text-green-700" },
  failed: { label: "Failed", cls: "bg-rose-100 text-rose-700" },
  running: { label: "Running", cls: "bg-blue-100 text-blue-700" },
  pending: { label: "Waiting", cls: "bg-amber-100 text-amber-700" },
  other: { label: "Other", cls: "bg-gray-100 text-gray-600" },
};
const HASH_META = {
  done: "bg-green-100 text-green-700", no_owner: "bg-gray-100 text-gray-600", failed: "bg-rose-100 text-rose-700", running: "bg-blue-100 text-blue-700",
  pending: "bg-amber-100 text-amber-700", limit_reached: "bg-orange-100 text-orange-700", unresolved: "bg-orange-100 text-orange-700",
};
const OUTCOME_META = { hashed: "bg-green-100 text-green-700", duplicate: "bg-gray-100 text-gray-600", skipped: "bg-amber-100 text-amber-700", failed: "bg-rose-100 text-rose-700" };
const TABS = [{ key: "runs", label: "Takedown runs" }, { key: "failures", label: "Failed steps" }, { key: "hash", label: "Hash jobs" }, { key: "blocklist", label: "Blocked list" }, { key: "attempts", label: "Rejected ads" }, { key: "claims", label: "Claim requests" }];
const BLOCK_TYPES = [{ key: "", label: "All types" }, { key: "advertiser", label: "Advertiser" }, { key: "ad_id", label: "Ad id" }, { key: "url", label: "URL" }, { key: "domain", label: "Domain" }, { key: "image_url", label: "Image URL" }, { key: "image_hash", label: "Image (hash)" }, { key: "page", label: "Page" }];
const BLOCK_STATUS_FILTERS = [{ key: "", label: "All" }, { key: "active", label: "Active" }, { key: "revoked", label: "Revoked" }, { key: "expired", label: "Expired" }];
const BLOCK_STATUS_META = { active: "bg-rose-100 text-rose-700", revoked: "bg-gray-200 text-gray-700", expired: "bg-gray-100 text-gray-600" };
const MATCH_LABEL = { advertiser: "Advertiser name", ad_id: "Ad id", url: "URL", domain: "Domain", sha256: "Same image (exact)", phash: "Similar image", image_url: "Image URL", page: "Page" };
const shortHash = (v) => (typeof v === "string" && /^[0-9a-f]{64}$/i.test(v) ? `${v.slice(0, 16)}…` : v);
const CLAIM_FILTERS = [{ key: "", label: "All" }, { key: "pending", label: "Waiting" }, { key: "accepted", label: "Accepted" }, { key: "rejected", label: "Rejected" }];
const CLAIM_STATUS = { pending: "bg-amber-100 text-amber-700", accepted: "bg-green-100 text-green-700", rejected: "bg-gray-200 text-gray-700" };
const PROCESSING = { none: ["Not started", "bg-gray-100 text-gray-600"], ok: ["Done", "bg-green-100 text-green-700"], partial: ["Partly done", "bg-amber-100 text-amber-700"], failed: ["Failed", "bg-rose-100 text-rose-700"] };
const RUN_FILTERS = [{ key: "", label: "All" }, { key: "failed", label: "Failed" }, { key: "running", label: "Running" }, { key: "pending", label: "Waiting" }, { key: "succeeded", label: "Done" }];
const HASH_FILTERS = ["", "pending", "running", "failed", "limit_reached", "unresolved", "done", "no_owner"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fmtDate = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

function Badge({ cls, children }) {
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${cls || "bg-gray-100 text-gray-600"}`}>{children}</span>;
}
function GroupBadge({ group, status }) {
  const m = GROUP_META[group] || GROUP_META.other;
  return <Badge cls={m.cls}>{status || m.label}</Badge>;
}

/** A call to the monitor with the admin login. 401 sends the person to the login page; 403 (not a reviewer) is returned for the page to explain. */
async function api(path, params = {}, base = BASE) {
  const token = Cookies.get("token");
  if (!token) {
    window.location.assign("/");
    throw new Error("Unauthorized");
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const res = await fetch(`${base}${path}${qs.toString() ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    Cookies.remove("token");
    Cookies.remove("nodeToken");
    window.location.assign("/");
    throw new Error("Unauthorized");
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { ok: res.ok, status: res.status, json };
}

function Stat({ label, value, tone = "text-[#1f296a]", hint }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-[140px]">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function TakedownMonitor() {
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [network, setNetwork] = useState("");
  const [tab, setTab] = useState("runs");

  const [runFilter, setRunFilter] = useState("");
  const [complaint, setComplaint] = useState("");
  const [complaintQuery, setComplaintQuery] = useState("");
  const [runs, setRuns] = useState({ items: [], next: null, unavailable: [], error: "", loading: false });
  const [failures, setFailures] = useState({ items: [], next: null, error: "", loading: false });
  const [hashStatus, setHashStatus] = useState("");
  const [hash, setHash] = useState({ items: [], next: null, error: "", loading: false });

  const [blockType, setBlockType] = useState("");
  const [blockStatus, setBlockStatus] = useState("");
  const [blockText, setBlockText] = useState("");
  const [blockSearch, setBlockSearch] = useState("");
  const [blocklist, setBlocklist] = useState({ items: [], next: null, counts: null, error: "", loading: false });
  const [attempts, setAttempts] = useState({ items: [], next: null, error: "", loading: false });

  const [claimStatus, setClaimStatus] = useState("");
  const [claims, setClaims] = useState({ items: [], next: null, error: "", loading: false });

  const [open, setOpen] = useState(null); // { kind: 'run'|'job', network, id }
  const [log, setLog] = useState({ data: null, items: [], next: null, error: "", loading: false });
  const [stepStatus, setStepStatus] = useState("");
  const [stepSystem, setStepSystem] = useState("");
  const [outcome, setOutcome] = useState("");
  const openRef = useRef(null);
  openRef.current = open;

  const loadOverview = useCallback(async () => {
    try {
      const { ok, status, json } = await api("/overview");
      if (status === 403) { setForbidden(true); return; }
      if (!ok) { setOverviewError(json?.message || "The numbers could not be loaded."); return; }
      setOverviewError("");
      setOverview(json.data);
      setNetwork((current) => current || json.data.networks.find((n) => n.takedown.available || n.hashJobs.available)?.network || json.data.networks[0]?.network || "");
    } catch { setOverviewError("The numbers could not be loaded."); }
  }, []);

  const loadRuns = useCallback(async (reset = true, cursor = null) => {
    if (!network && !complaintQuery) return;
    setRuns((r) => ({ ...r, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/runs", { network: complaintQuery ? undefined : network, complaintId: complaintQuery, status: runFilter, cursor: reset ? undefined : cursor, limit: 25 });
      if (!ok) { setRuns((r) => ({ ...r, loading: false, error: json?.message || "The runs could not be loaded." })); return; }
      setRuns((r) => ({ items: reset ? json.data.items : [...r.items, ...json.data.items], next: json.data.next, unavailable: json.data.unavailable || [], error: "", loading: false }));
    } catch { setRuns((r) => ({ ...r, loading: false, error: "The runs could not be loaded." })); }
  }, [network, runFilter, complaintQuery]);

  const loadFailures = useCallback(async (reset = true, cursor = null) => {
    if (!network) return;
    setFailures((f) => ({ ...f, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/failures", { network, beforeId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setFailures((f) => ({ ...f, loading: false, error: json?.message || "The failed steps could not be loaded." })); return; }
      setFailures((f) => ({ items: reset ? json.data.items : [...f.items, ...json.data.items], next: json.data.next, error: "", loading: false }));
    } catch { setFailures((f) => ({ ...f, loading: false, error: "The failed steps could not be loaded." })); }
  }, [network]);

  const loadHash = useCallback(async (reset = true, cursor = null) => {
    if (!network) return;
    setHash((h) => ({ ...h, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/hash-jobs", { network, status: hashStatus, afterId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setHash((h) => ({ ...h, loading: false, error: json?.message || "The hash jobs could not be loaded." })); return; }
      setHash((h) => ({ items: reset ? json.data.items : [...h.items, ...json.data.items], next: json.data.items.length ? json.data.next : null, error: "", loading: false }));
    } catch { setHash((h) => ({ ...h, loading: false, error: "The hash jobs could not be loaded." })); }
  }, [network, hashStatus]);

  // Who and what is blocked in the chosen network (B1), and the ads the blocklist refused.
  const loadBlocklist = useCallback(async (reset = true, cursor = null) => {
    if (!network) return;
    setBlocklist((b) => ({ ...b, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/blocklist", { network, status: blockStatus, entryType: blockType, q: blockSearch, beforeId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setBlocklist((b) => ({ ...b, loading: false, error: json?.message || "The blocklist could not be loaded." })); return; }
      setBlocklist((b) => ({ items: reset ? json.data.items : [...b.items, ...json.data.items], next: json.data.next, counts: json.data.counts, error: "", loading: false }));
    } catch { setBlocklist((b) => ({ ...b, loading: false, error: "The blocklist could not be loaded." })); }
  }, [network, blockStatus, blockType, blockSearch]);

  const loadAttempts = useCallback(async (reset = true, cursor = null) => {
    if (!network) return;
    setAttempts((a) => ({ ...a, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/attempts", { network, beforeId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setAttempts((a) => ({ ...a, loading: false, error: json?.message || "The rejected ads could not be loaded." })); return; }
      setAttempts((a) => ({ items: reset ? json.data.items : [...a.items, ...json.data.items], next: json.data.next, error: "", loading: false }));
    } catch { setAttempts((a) => ({ ...a, loading: false, error: "The rejected ads could not be loaded." })); }
  }, [network]);

  // The claim requests that came in (the claims list of the same backend): who sent what, and what was decided. Deciding is done on the Copyright Claims page.
  const loadClaims = useCallback(async (reset = true, cursor = null) => {
    setClaims((c) => ({ ...c, loading: true, error: "" }));
    try {
      const { ok, json } = await api("", { status: claimStatus, beforeId: reset ? undefined : cursor, limit: 25 }, CLAIMS);
      if (!ok) { setClaims((c) => ({ ...c, loading: false, error: json?.message || "The claim requests could not be loaded." })); return; }
      setClaims((c) => ({ items: reset ? json.data.items : [...c.items, ...json.data.items], next: json.data.items.length ? json.data.next : null, error: "", loading: false }));
    } catch { setClaims((c) => ({ ...c, loading: false, error: "The claim requests could not be loaded." })); }
  }, [claimStatus]);

  const loadLog = useCallback(async (target, reset = true, cursor = null) => {
    setLog((l) => ({ ...l, loading: true, error: "", ...(reset ? { data: null, items: [], next: null } : {}) }));
    try {
      const res = target.kind === "run"
        ? await api(`/runs/${target.id}/logs`, { network: target.network, status: stepStatus, system: stepSystem, afterId: reset ? undefined : cursor, limit: 100 })
        : await api(`/hash-jobs/${target.id}/results`, { network: target.network, outcome, afterId: reset ? undefined : cursor, limit: 200 });
      if (openRef.current !== target) return;
      if (!res.ok) { setLog((l) => ({ ...l, loading: false, error: res.json?.message || "The log could not be loaded." })); return; }
      const d = res.json.data;
      setLog((l) => ({ data: reset ? d : l.data, items: reset ? d.items : [...l.items, ...d.items], next: d.items.length ? d.next : null, error: "", loading: false }));
    } catch { setLog((l) => ({ ...l, loading: false, error: "The log could not be loaded." })); }
  }, [stepStatus, stepSystem, outcome]);

  useEffect(() => { loadOverview(); const t = setInterval(loadOverview, 60000); return () => clearInterval(t); }, [loadOverview]);
  useEffect(() => { if (tab === "runs") loadRuns(true); }, [tab, loadRuns]);
  useEffect(() => { if (tab === "failures") loadFailures(true); }, [tab, loadFailures]);
  useEffect(() => { if (tab === "hash") loadHash(true); }, [tab, loadHash]);
  useEffect(() => { if (tab === "blocklist") loadBlocklist(true); }, [tab, loadBlocklist]);
  useEffect(() => { if (tab === "attempts") loadAttempts(true); }, [tab, loadAttempts]);
  useEffect(() => { if (tab === "claims") loadClaims(true); }, [tab, loadClaims]);
  useEffect(() => { if (open) loadLog(open, true); }, [open, loadLog]);

  const refresh = () => { loadOverview(); if (tab === "runs") loadRuns(true); if (tab === "failures") loadFailures(true); if (tab === "hash") loadHash(true); if (tab === "blocklist") loadBlocklist(true); if (tab === "attempts") loadAttempts(true); if (tab === "claims") loadClaims(true); if (open) loadLog(open, true); };
  const submitBlockSearch = (e) => { e.preventDefault(); setBlockSearch(blockText.trim()); };
  const openRun = (r) => { setStepStatus(""); setStepSystem(""); setOpen({ kind: "run", network: r.network, id: r.runId }); };
  const openJob = (j) => { setOutcome(""); setOpen({ kind: "job", network: j.network, id: j.id }); };
  const submitComplaint = (e) => {
    e.preventDefault();
    const value = complaint.trim();
    if (value && !UUID.test(value)) { setRuns((r) => ({ ...r, error: "That is not a complaint id." })); return; }
    setComplaintQuery(value);
  };

  if (forbidden) {
    return <div className="p-6"><div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-700">You do not have access to the takedown monitor. Ask an administrator to add your user name to the reviewers.</div></div>;
  }

  const totals = overview?.totals;
  const unavailableNames = totals ? [...new Set(totals.unavailable.map((u) => u.network))] : [];

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#1f296a]">Takedown Monitor</h1>
          <p className="text-sm text-gray-500">What was deleted, what is waiting, what failed, and the log of every step. Read only.</p>
        </div>
        <button onClick={refresh} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50" aria-label="Refresh">
          <FiRefreshCw /> Refresh
        </button>
      </div>

      {overviewError && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{overviewError}</div>}

      {totals && (
        <div className="flex gap-3 flex-wrap">
          <Stat label="Deleted" value={totals.items.deleted} tone="text-green-600" hint="ads removed in real runs" />
          <Stat label="Waiting" value={totals.items.waiting} tone="text-amber-600" hint="planned, not yet done" />
          <Stat label="Failed" value={totals.items.failed} tone="text-rose-600" hint="ads whose delete failed" />
          {totals.verification && <Stat label="Waiting for check" value={totals.verification.pending} tone="text-amber-600" hint="new ads hidden until verified" />}
          {totals.verification && <Stat label="Waiting for cleanup" value={totals.verification.failed} tone="text-rose-600" hint="failed check, not deleted yet" />}
          <Stat label="Takedown runs" value={totals.runs.total} hint={Object.entries(totals.runs.byGroup).map(([g, n]) => `${(GROUP_META[g] || GROUP_META.other).label} ${n}`).join(" · ") || "none yet"} />
          <Stat label="Hash jobs" value={totals.hashJobs.total} hint={Object.entries(totals.hashJobs.byStatus).map(([s, n]) => `${s} ${n}`).join(" · ") || "none yet"} />
        </div>
      )}
      {unavailableNames.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
          Not available (tables missing or not readable): {unavailableNames.join(", ")}. These are not zero; they are not counted.
        </div>
      )}

      {overview && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 bg-gray-50">
              <tr><th className="p-3">Network</th><th className="p-3">Runs</th><th className="p-3">Deleted</th><th className="p-3">Waiting</th><th className="p-3">Failed</th><th className="p-3">Dry runs</th><th className="p-3">Last run</th><th className="p-3">To check / to remove</th><th className="p-3">Hash jobs</th></tr>
            </thead>
            <tbody>
              {overview.networks.map((n) => (
                <tr key={n.network} className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${network === n.network ? "bg-indigo-50" : ""}`} onClick={() => { setNetwork(n.network); setComplaintQuery(""); setComplaint(""); }}>
                  <td className="p-3 font-semibold">{n.network}</td>
                  {n.takedown.available ? (
                    <>
                      <td className="p-3">{n.takedown.runs.total}</td>
                      <td className="p-3 text-green-700">{n.takedown.items.deleted}</td>
                      <td className="p-3 text-amber-700">{n.takedown.items.waiting}</td>
                      <td className="p-3 text-rose-700">{n.takedown.items.failed}</td>
                      <td className="p-3 text-gray-500">{n.takedown.dryRuns.total}</td>
                      <td className="p-3 text-gray-500">{fmtDate(n.takedown.lastRunAt)}</td>
                    </>
                  ) : (
                    <td className="p-3 text-gray-400" colSpan={6}>Takedown: not available</td>
                  )}
                  <td className="p-3">
                    {n.verification?.available
                      ? <><span className="text-amber-700">{n.verification.pending}</span> / <span className="text-rose-700">{n.verification.failed}</span></>
                      : <span className="text-gray-400">{n.verification?.reason === "no_column" ? "not migrated" : "—"}</span>}
                  </td>
                  <td className="p-3">
                    {n.hashJobs.available
                      ? (Object.entries(n.hashJobs.byStatus).map(([s, c]) => <span key={s} className={`mr-1 inline-block px-2 py-0.5 rounded-full text-xs ${HASH_META[s] || "bg-gray-100 text-gray-600"}`}>{s} {c}</span>) || null)
                      : <span className="text-gray-400">not available</span>}
                    {n.hashJobs.available && n.hashJobs.total === 0 && <span className="text-gray-400">none</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 text-sm font-semibold border-b-2 ${tab === t.key ? "border-[#1f296a] text-[#1f296a]" : "border-transparent text-gray-500"}`}>{t.label}</button>
        ))}
        <span className="ml-auto text-sm text-gray-500 pb-2">Network: <b>{network || "—"}</b></span>
      </div>

      {tab === "runs" && (
        <section className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            {RUN_FILTERS.map((f) => (
              <button key={f.key || "all"} onClick={() => setRunFilter(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${runFilter === f.key ? "bg-[#1f296a] text-white border-[#1f296a]" : "bg-white text-gray-600 border-gray-300"}`}>{f.label}</button>
            ))}
            <form onSubmit={submitComplaint} className="ml-auto flex items-center gap-2">
              <input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Find by complaint id" aria-label="Complaint id" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-72" />
              <button type="submit" className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm" aria-label="Search"><FiSearch /></button>
              {complaintQuery && <button type="button" onClick={() => { setComplaint(""); setComplaintQuery(""); }} className="text-xs text-gray-500 underline">clear</button>}
            </form>
          </div>
          {runs.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{runs.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">Run</th><th className="p-3">Status</th><th className="p-3">Mode</th><th className="p-3">Planned</th><th className="p-3">Done</th><th className="p-3">Failed</th><th className="p-3">Started</th><th className="p-3">Complaint / trigger</th></tr></thead>
              <tbody>
                {runs.items.map((r) => (
                  <tr key={`${r.network}-${r.runId}`} className="border-t border-gray-100 cursor-pointer hover:bg-gray-50" onClick={() => openRun(r)}>
                    <td className="p-3 font-mono text-xs">{r.runId.slice(0, 8)} <span className="text-gray-400">{r.network}</span></td>
                    <td className="p-3"><GroupBadge group={r.group} status={r.status} /></td>
                    <td className="p-3">{r.mode === "dry_run" ? <Badge>dry run: deleted nothing</Badge> : "real"}</td>
                    <td className="p-3">{r.itemsPlanned}</td><td className="p-3 text-green-700">{r.itemsSucceeded}</td><td className="p-3 text-rose-700">{r.itemsFailed}</td>
                    <td className="p-3 text-gray-500">{fmtDate(r.startedAt || r.createdAt)}</td>
                    <td className="p-3 font-mono text-xs text-gray-500">{r.complaintId ? r.complaintId.slice(0, 8) : (r.triggerType || "—")}</td>
                  </tr>
                ))}
                {!runs.loading && !runs.items.length && !runs.error && <tr><td className="p-4 text-gray-500" colSpan={8}>No takedown runs{runs.unavailable.length ? ` (not available: ${runs.unavailable.join(", ")})` : ""}.</td></tr>}
              </tbody>
            </table>
          </div>
          {runs.next && <button onClick={() => loadRuns(false, runs.next)} disabled={runs.loading} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm">Load more</button>}
        </section>
      )}

      {tab === "failures" && (
        <section className="space-y-3">
          {failures.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{failures.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">When</th><th className="p-3">System</th><th className="p-3">What</th><th className="p-3">Status</th><th className="p-3">Tries</th><th className="p-3">Error</th><th className="p-3">Retry at</th></tr></thead>
              <tbody>
                {failures.items.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100 align-top cursor-pointer hover:bg-gray-50" onClick={() => openRun({ network, runId: s.runId })}>
                    <td className="p-3 text-gray-500">{fmtDate(s.finishedAt || s.createdAt)}</td>
                    <td className="p-3">{s.system} / {s.operation}</td>
                    <td className="p-3 break-all">{s.targetType}: {s.targetValue || s.targetId || s.internalAdId || "—"}</td>
                    <td className="p-3"><GroupBadge group={s.group} status={s.status} /></td>
                    <td className="p-3">{s.attempts}</td>
                    <td className="p-3 text-rose-700 break-words max-w-md">{s.errorMessage || "—"}</td>
                    <td className="p-3 text-gray-500">{fmtDate(s.nextRetryAt)}</td>
                  </tr>
                ))}
                {!failures.loading && !failures.items.length && !failures.error && <tr><td className="p-4 text-gray-500" colSpan={7}>No failed steps.</td></tr>}
              </tbody>
            </table>
          </div>
          {failures.next && <button onClick={() => loadFailures(false, failures.next)} disabled={failures.loading} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm">Load more</button>}
        </section>
      )}

      {tab === "hash" && (
        <section className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {HASH_FILTERS.map((s) => (
              <button key={s || "all"} onClick={() => setHashStatus(s)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${hashStatus === s ? "bg-[#1f296a] text-white border-[#1f296a]" : "bg-white text-gray-600 border-gray-300"}`}>{s || "All"}</button>
            ))}
          </div>
          {hash.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{hash.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">Job</th><th className="p-3">Blocked</th><th className="p-3">Status</th><th className="p-3">Tries</th><th className="p-3">Updated</th><th className="p-3">Last error</th></tr></thead>
              <tbody>
                {hash.items.map((j) => (
                  <tr key={j.id} className="border-t border-gray-100 align-top cursor-pointer hover:bg-gray-50" onClick={() => openJob(j)}>
                    <td className="p-3 font-mono text-xs">#{j.id}</td>
                    <td className="p-3 break-all">{j.entryType}: {j.value}</td>
                    <td className="p-3"><Badge cls={HASH_META[j.status]}>{j.status}</Badge></td>
                    <td className="p-3">{j.attempts}</td>
                    <td className="p-3 text-gray-500">{fmtDate(j.updatedAt)}</td>
                    <td className="p-3 text-rose-700 break-words max-w-md">{j.lastError || "—"}</td>
                  </tr>
                ))}
                {!hash.loading && !hash.items.length && !hash.error && <tr><td className="p-4 text-gray-500" colSpan={6}>No hash jobs.</td></tr>}
              </tbody>
            </table>
          </div>
          {hash.next && <button onClick={() => loadHash(false, hash.next)} disabled={hash.loading} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm">Load more</button>}
        </section>
      )}

      {tab === "blocklist" && (
        <section className="space-y-3">
          <p className="text-sm text-gray-500">Everything blocked in <b>{network || "this network"}</b>: advertisers, ads, links and images. An advertiser blocked from a claim or from the block request appears here at once. New ads of a blocked advertiser are refused.</p>
          {blocklist.counts && (
            <div className="flex gap-3 flex-wrap">
              <Stat label="Blocked (active)" value={blocklist.counts.byStatus.active || 0} tone="text-rose-600" hint={Object.entries(blocklist.counts.activeByType).map(([t, n]) => `${t} ${n}`).join(" · ") || "nothing blocked yet"} />
              <Stat label="Revoked" value={blocklist.counts.byStatus.revoked || 0} hint="blocks that were lifted" />
              <Stat label="Expired" value={blocklist.counts.byStatus.expired || 0} />
            </div>
          )}
          <div className="flex gap-2 flex-wrap items-center">
            {BLOCK_STATUS_FILTERS.map((f) => (
              <button key={f.key || "all"} onClick={() => setBlockStatus(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${blockStatus === f.key ? "bg-[#1f296a] text-white border-[#1f296a]" : "bg-white text-gray-600 border-gray-300"}`}>{f.label}</button>
            ))}
            <select aria-label="Block type" value={blockType} onChange={(e) => setBlockType(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
              {BLOCK_TYPES.map((t) => <option key={t.key || "all"} value={t.key}>{t.label}</option>)}
            </select>
            <form onSubmit={submitBlockSearch} className="ml-auto flex items-center gap-2">
              <input value={blockText} onChange={(e) => setBlockText(e.target.value)} placeholder="Search a blocked name or link" aria-label="Search blocked" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64" />
              <button type="submit" className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm" aria-label="Search blocked list"><FiSearch /></button>
              {blockSearch && <button type="button" onClick={() => { setBlockText(""); setBlockSearch(""); }} className="text-xs text-gray-500 underline">clear</button>}
            </form>
          </div>
          {blocklist.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{blocklist.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">Type</th><th className="p-3">Blocked</th><th className="p-3">Status</th><th className="p-3">Added by</th><th className="p-3">Added</th><th className="p-3">Reason</th><th className="p-3">Complaint</th></tr></thead>
              <tbody>
                {blocklist.items.map((b) => (
                  <tr key={b.id} className="border-t border-gray-100 align-top">
                    <td className="p-3 whitespace-nowrap">{b.entryType}{b.entryType === "ad_id" && b.identifierNamespace && <div className="text-xs text-gray-400">{b.identifierNamespace === "internal" ? "our row id" : "platform id"}</div>}</td>
                    <td className="p-3 break-all font-medium" title={b.value}>{shortHash(b.value)}</td>
                    <td className="p-3"><Badge cls={BLOCK_STATUS_META[b.status]}>{b.status}</Badge>{b.removedBy && <div className="text-xs text-gray-400 mt-1">by {b.removedBy} · {fmtDate(b.removedAt)}</div>}</td>
                    <td className="p-3 text-gray-600">{b.addedBy || "—"}{b.source && <div className="text-xs text-gray-400">{b.source}</div>}</td>
                    <td className="p-3 text-gray-500">{fmtDate(b.createdAt)}{b.expiresAt && <div className="text-xs text-gray-400">expires {fmtDate(b.expiresAt)}</div>}</td>
                    <td className="p-3 break-words max-w-xs">{b.reason || "—"}</td>
                    <td className="p-3 font-mono text-xs text-gray-500">{b.complaintId ? b.complaintId.slice(0, 8) : "—"}</td>
                  </tr>
                ))}
                {!blocklist.loading && !blocklist.items.length && !blocklist.error && <tr><td className="p-4 text-gray-500" colSpan={7}>Nothing is blocked here{blockSearch || blockType || blockStatus ? " with these filters" : " yet"}.</td></tr>}
              </tbody>
            </table>
          </div>
          {blocklist.next && <button onClick={() => loadBlocklist(false, blocklist.next)} disabled={blocklist.loading} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm">Load more</button>}
        </section>
      )}

      {tab === "attempts" && (
        <section className="space-y-3">
          <p className="text-sm text-gray-500">Ads of <b>{network || "this network"}</b> that the blocklist refused (newest first): at insertion, when a new ad was checked (verification), or when an existing ad matched a new block (verification-recheck; the cleanup cron then deletes it). Only identifiers are kept, never the ad itself.</p>
          {attempts.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{attempts.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">When</th><th className="p-3">Refused because</th><th className="p-3">Advertiser</th><th className="p-3">Ad id</th><th className="p-3">Image</th><th className="p-3">Source</th></tr></thead>
              <tbody>
                {attempts.items.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100 align-top">
                    <td className="p-3 text-gray-500 whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                    <td className="p-3"><Badge cls="bg-rose-100 text-rose-700">{MATCH_LABEL[a.matchType] || a.matchType}</Badge>{a.distance !== null && <div className="text-xs text-gray-400 mt-1">{a.distance} bits apart</div>}</td>
                    <td className="p-3 break-words">{a.advertiser || "—"}</td>
                    <td className="p-3 font-mono text-xs break-all">{a.platformAdId || "—"}</td>
                    <td className="p-3 break-all text-gray-500 text-xs max-w-xs">{a.imageUrl || "—"}</td>
                    <td className="p-3 text-gray-500 text-xs">{a.source || "—"}</td>
                  </tr>
                ))}
                {!attempts.loading && !attempts.items.length && !attempts.error && <tr><td className="p-4 text-gray-500" colSpan={6}>No ad has been refused here yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {attempts.next && <button onClick={() => loadAttempts(false, attempts.next)} disabled={attempts.loading} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm">Load more</button>}
        </section>
      )}

      {tab === "claims" && (
        <section className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            {CLAIM_FILTERS.map((f) => (
              <button key={f.key || "all"} onClick={() => setClaimStatus(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${claimStatus === f.key ? "bg-[#1f296a] text-white border-[#1f296a]" : "bg-white text-gray-600 border-gray-300"}`}>{f.label}</button>
            ))}
            <Link to="/pas/copyright-claims" className="ml-auto text-sm text-[#1f296a] underline">Review and decide on the Copyright Claims page</Link>
          </div>
          {claims.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{claims.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">Claim</th><th className="p-3">Advertiser named</th><th className="p-3">Sent by</th><th className="p-3">Received</th><th className="p-3">Decision</th><th className="p-3">After accept</th></tr></thead>
              <tbody>
                {claims.items.map((c) => (
                  <tr key={c.complaintId} className="border-t border-gray-100 align-top">
                    <td className="p-3 font-mono text-xs">{c.reference}</td>
                    <td className="p-3 break-words">{c.name}</td>
                    <td className="p-3 text-gray-600">{c.organization || "—"}</td>
                    <td className="p-3 text-gray-500">{fmtDate(c.receivedAt)}</td>
                    <td className="p-3"><Badge cls={CLAIM_STATUS[c.status]}>{c.status === "pending" ? "Waiting" : c.status}</Badge>{c.decidedBy && <div className="text-xs text-gray-400 mt-1">{c.decidedBy} · {fmtDate(c.decidedAt)}</div>}</td>
                    <td className="p-3">{c.status === "accepted" ? <Badge cls={(PROCESSING[c.processingStatus] || PROCESSING.none)[1]}>{(PROCESSING[c.processingStatus] || PROCESSING.none)[0]}</Badge> : "—"}</td>
                  </tr>
                ))}
                {!claims.loading && !claims.items.length && !claims.error && <tr><td className="p-4 text-gray-500" colSpan={6}>No claim requests.</td></tr>}
              </tbody>
            </table>
          </div>
          {claims.next && <button onClick={() => loadClaims(false, claims.next)} disabled={claims.loading} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm">Load more</button>}
        </section>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-label={open.kind === "run" ? "Run log" : "Job results"}>
          <div className="bg-white w-full max-w-3xl h-full overflow-y-auto p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#1f296a]">{open.kind === "run" ? "Takedown run log" : `Hash job #${open.id}`}</h2>
                <div className="text-xs text-gray-500 font-mono break-all">{open.network} · {open.id}</div>
              </div>
              <button onClick={() => setOpen(null)} aria-label="Close" className="p-2 rounded-lg hover:bg-gray-100"><FiX /></button>
            </div>
            {log.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{log.error}</div>}

            {open.kind === "run" && log.data && (
              <>
                <div className="flex gap-2 items-center flex-wrap text-sm">
                  <GroupBadge group={log.data.run.group} status={log.data.run.status} />
                  {log.data.run.mode === "dry_run" && <Badge>dry run: deleted nothing</Badge>}
                  <span>planned {log.data.run.itemsPlanned}</span><span className="text-green-700">done {log.data.run.itemsSucceeded}</span><span className="text-rose-700">failed {log.data.run.itemsFailed}</span>
                  <span className="text-gray-500">operator {log.data.run.operator || "—"}</span>
                </div>
                {log.data.run.details && <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs whitespace-pre-wrap break-words">{log.data.run.details}</pre>}
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(log.data.steps.bySystem).map(([system, v]) => (
                    <button key={system} onClick={() => setStepSystem(stepSystem === system ? "" : system)} className={`px-3 py-1.5 rounded-lg border text-xs ${stepSystem === system ? "bg-[#1f296a] text-white border-[#1f296a]" : "bg-white border-gray-300"}`}>
                      {system}: {Object.entries(v.byStatus).map(([s, n]) => `${s} ${n}`).join(", ")}
                    </button>
                  ))}
                  <select aria-label="Step status" value={stepStatus} onChange={(e) => setStepStatus(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
                    <option value="">All statuses</option>
                    {[...new Set(Object.values(log.data.steps.bySystem).flatMap((v) => Object.keys(v.byStatus)))].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-gray-500 bg-gray-50"><tr><th className="p-2">#</th><th className="p-2">System</th><th className="p-2">What</th><th className="p-2">Status</th><th className="p-2">Tries</th><th className="p-2">When</th><th className="p-2">Error</th></tr></thead>
                    <tbody>
                      {log.items.map((s) => (
                        <tr key={s.id} className="border-t border-gray-100 align-top">
                          <td className="p-2 text-gray-400">{s.id}</td>
                          <td className="p-2">{s.system} / {s.operation}</td>
                          <td className="p-2 break-all">{s.targetType}: {s.targetValue || s.targetId || s.internalAdId || "—"}{s.targetUrl ? <div className="text-gray-400">{s.targetUrl}</div> : null}</td>
                          <td className="p-2"><GroupBadge group={s.group} status={s.status} />{s.nextRetryAt && <div className="text-gray-400 mt-1">retry {fmtDate(s.nextRetryAt)}</div>}</td>
                          <td className="p-2">{s.attempts}</td>
                          <td className="p-2 text-gray-500">{fmtDate(s.finishedAt || s.startedAt || s.createdAt)}</td>
                          <td className="p-2 text-rose-700 break-words max-w-xs">{s.errorMessage || (s.details ? <span className="text-gray-500">{s.details}</span> : "—")}</td>
                        </tr>
                      ))}
                      {!log.loading && !log.items.length && !log.error && <tr><td className="p-3 text-gray-500" colSpan={7}>No steps recorded for this run.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {open.kind === "job" && log.data && (
              <>
                <div className="flex gap-2 items-center flex-wrap text-sm">
                  <Badge cls={HASH_META[log.data.job.status]}>{log.data.job.status}</Badge>
                  <span>{log.data.job.entryType}: <b>{log.data.job.value}</b></span>
                  <span className="text-gray-500">run {log.data.generation} of {log.data.latestGeneration}</span>
                  {log.data.job.stats && <span className="text-gray-500">{Object.entries(log.data.job.stats).map(([k, v]) => `${k} ${v}`).join(" · ")}</span>}
                </div>
                {log.data.job.lastError && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{log.data.job.lastError}</div>}
                <select aria-label="Image result" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
                  <option value="">All results</option>
                  {Object.keys(OUTCOME_META).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-gray-500 bg-gray-50"><tr><th className="p-2">Ad</th><th className="p-2">Image</th><th className="p-2">Result</th><th className="p-2">Reason</th><th className="p-2">When</th></tr></thead>
                    <tbody>
                      {log.items.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100 align-top">
                          <td className="p-2 break-all">{r.platformAdId || r.internalAdId || "—"}</td>
                          <td className="p-2 break-all text-gray-500">{r.sourceUrl}</td>
                          <td className="p-2"><Badge cls={OUTCOME_META[r.outcome]}>{r.outcome}</Badge></td>
                          <td className="p-2">{r.reason || "—"}</td>
                          <td className="p-2 text-gray-500">{fmtDate(r.updatedAt)}</td>
                        </tr>
                      ))}
                      {!log.loading && !log.items.length && !log.error && <tr><td className="p-3 text-gray-500" colSpan={5}>No results recorded for this run.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {log.loading && <div className="text-sm text-gray-500">Loading…</div>}
            {log.next && !log.loading && <button onClick={() => loadLog(open, false, log.next)} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm">Load more</button>}
          </div>
        </div>
      )}
    </div>
  );
}

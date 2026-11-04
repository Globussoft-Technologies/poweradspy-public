import React, { useCallback, useEffect, useRef, useState } from "react";
import Cookies from "js-cookie";
import { FiRefreshCw, FiX, FiDownload, FiCopy, FiExternalLink, FiSearch } from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

/**
 * Copyright Claims: review the claims sent by the landing-page form, and accept or reject them.
 *
 * Talks only to admin_panel_backend (/admin-panel/copyright-claims), which checks the admin login and an allowlist of reviewers and then
 * calls the claims service with its own secret. The reviewer recorded with a decision is the logged-in user (the server takes it from the
 * login, never from this page). Evidence files are downloaded through the same login (no address of the storage is ever shown), and a
 * claimant's link is shown as text: it is opened only by a person, after a confirmation.
 *
 * Accept needs the reviewer to confirm that the supporting documents were reviewed. A failed or partial processing after Accept is shown per
 * network with a Retry button; "unable to check" in the search is never shown as "no ads found".
 */

const BASE = `${import.meta.env.VITE_ADMIN_PANEL_API || "http://localhost:4000/admin-panel"}/copyright-claims`;

const STATUS_FILTERS = [
  { key: "pending", label: "Waiting" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "", label: "All" },
];
const STATUS_META = {
  pending: { label: "Waiting", cls: "bg-amber-100 text-amber-700" },
  accepted: { label: "Accepted", cls: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", cls: "bg-gray-200 text-gray-700" },
};
const PROCESSING_META = {
  none: { label: "Not started", cls: "bg-gray-100 text-gray-600" },
  ok: { label: "Done", cls: "bg-green-100 text-green-700" },
  partial: { label: "Partly done", cls: "bg-amber-100 text-amber-700" },
  failed: { label: "Failed", cls: "bg-rose-100 text-rose-700" },
};
const CHECK_META = {
  found: { label: "Found", cls: "bg-green-100 text-green-700" },
  not_found: { label: "Not found", cls: "bg-gray-100 text-gray-600" },
  unable_to_check: { label: "Unable to check", cls: "bg-amber-100 text-amber-700" },
  not_supported: { label: "Not supported", cls: "bg-gray-100 text-gray-500" },
};
const STEP_LABEL = {
  ok: "Blocked", failed: "Failed", not_attempted: "Not tried", queued: "Queued", not_queued: "Not queued", not_supported: "Not available",
};

const fmtDate = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

function Pill({ meta, value }) {
  const m = meta[value] || { label: value || "—", cls: "bg-gray-100 text-gray-600" };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${m.cls}`}>{m.label}</span>;
}

/** A call to the claims backend with the admin login. 401 sends the person to the login page; 403 (not a reviewer) is returned for the page to explain. */
async function api(path, { method = "GET", body, raw = false } = {}) {
  const token = Cookies.get("token");
  if (!token) {
    window.location.assign("/");
    throw new Error("Unauthorized");
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    Cookies.remove("token");
    Cookies.remove("nodeToken");
    window.location.assign("/");
    throw new Error("Unauthorized");
  }
  if (raw) return res;
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { ok: res.ok, status: res.status, json };
}

export default function CopyrightClaims() {
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [forbidden, setForbidden] = useState(false);

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [precheck, setPrecheck] = useState(null);
  const [checking, setChecking] = useState(false);

  const [dialog, setDialog] = useState(null); // 'accept' | 'reject'
  const [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const openRef = useRef(null);
  openRef.current = openId;

  const loadSummary = useCallback(async () => {
    try {
      const { ok, status: code, json } = await api("/summary");
      if (code === 403) { setForbidden(true); return; }
      setSummary(ok ? json.data : { unavailable: true });
    } catch { /* the login redirect, or the network: the list shows its own error */ }
  }, []);

  const loadList = useCallback(async (reset = true, cursor = null) => {
    setLoading(true);
    setListError("");
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (!reset && cursor) qs.set("beforeId", cursor);
      qs.set("limit", "25");
      const { ok, status: code, json } = await api(`?${qs.toString()}`);
      if (code === 403) { setForbidden(true); return; }
      if (!ok) { setListError(json?.message || "The claims could not be loaded."); return; }
      setItems((prev) => (reset ? json.data.items : [...prev, ...json.data.items]));
      setNext(json.data.items.length ? json.data.next : null);
    } catch {
      setListError("The claims could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { loadSummary(); const t = setInterval(loadSummary, 60000); return () => clearInterval(t); }, [loadSummary]);
  useEffect(() => { loadList(true); }, [loadList]);

  const openClaim = useCallback(async (id) => {
    setOpenId(id);
    setDetail(null);
    setDetailError("");
    setPrecheck(null);
    try {
      const { ok, json } = await api(`/${id}`);
      if (openRef.current !== id) return;
      if (!ok) { setDetailError(json?.message || "The claim could not be loaded."); return; }
      setDetail(json.data);
    } catch {
      if (openRef.current === id) setDetailError("The claim could not be loaded.");
    }
  }, []);

  const runPrecheck = async () => {
    if (!openId) return;
    setChecking(true);
    try {
      const { ok, json } = await api(`/${openId}/precheck`);
      setPrecheck(ok ? json.data.networks : [{ network: "all networks", check: "unable_to_check", reason: json?.message || "the search failed" }]);
    } catch {
      setPrecheck([{ network: "all networks", check: "unable_to_check", reason: "the search failed" }]);
    } finally {
      setChecking(false);
    }
  };

  const afterDecision = async (id) => {
    await Promise.all([openClaim(id), loadList(true), loadSummary()]);
  };

  const submitDecision = async () => {
    if (!openId || busy) return;
    setBusy(true);
    try {
      const body = dialog === "accept" ? { evidenceReviewed: reviewed, note } : { reason };
      const { ok, json } = await api(`/${openId}/${dialog}`, { method: "POST", body });
      if (!ok) { toast.error(json?.message || "The decision could not be recorded."); return; }
      const processing = json?.data?.processingStatus;
      if (dialog === "accept") {
        toast[processing === "ok" ? "success" : "warn"](processing === "ok" ? "Accepted. The advertiser is blocked and its images are queued." : "Accepted, but some steps did not finish. See the details and use Retry.");
      } else {
        toast.success("Rejected.");
      }
      setDialog(null);
      setReviewed(false); setNote(""); setReason("");
      await afterDecision(openId);
    } catch {
      toast.error("The decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!openId || busy) return;
    setBusy(true);
    try {
      const { ok, json } = await api(`/${openId}/retry`, { method: "POST", body: {} });
      toast[ok && json?.data?.processingStatus === "ok" ? "success" : "warn"](ok ? "Processing was run again." : (json?.message || "The retry could not be done."));
      await afterDecision(openId);
    } catch {
      toast.error("The retry could not be done.");
    } finally {
      setBusy(false);
    }
  };

  const download = async (file) => {
    try {
      const res = await api(`/${openId}/files/${file.fileId}`, { raw: true });
      if (!res.ok) {
        let message = "The file cannot be downloaded right now.";
        try { message = (await res.json()).message || message; } catch { /* keep the default */ }
        toast.error(message);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name || "evidence";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast.error("The file cannot be downloaded right now.");
    }
  };

  const copyLink = async (url) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied."); } catch { toast.error("Could not copy the link."); }
  };
  const openLink = (url) => {
    if (!/^https:\/\//i.test(url)) return;
    if (window.confirm(`This is a website outside PowerAdspy, given by the claimant:\n\n${url}\n\nOpen it in a new tab?`)) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  if (forbidden) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-xl">
          <h2 className="text-lg font-semibold text-gray-900">Copyright Claims</h2>
          <p className="mt-2 text-sm text-gray-600">You do not have access to review copyright claims. Ask an administrator to add your user name to the list of reviewers.</p>
        </div>
      </div>
    );
  }

  const claim = detail?.claim;
  const waitedHours = summary?.oldestPendingAt ? Math.max(0, Math.round((Date.now() - new Date(summary.oldestPendingAt).getTime()) / 3600000)) : null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <ToastContainer position="top-right" autoClose={4000} />

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold text-gray-900 mr-auto">Copyright Claims</h2>
        <button onClick={() => { loadList(true); loadSummary(); if (openId) openClaim(openId); }} className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50" title="Refresh">
          <FiRefreshCw size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-xs text-gray-500">Waiting for review</div>
          <div className="text-2xl font-semibold text-gray-900">{summary?.unavailable ? "unavailable" : (summary ? summary.pending : "…")}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-xs text-gray-500">Oldest waiting</div>
          <div className={`text-2xl font-semibold ${waitedHours !== null && waitedHours >= 48 ? "text-rose-600" : "text-gray-900"}`}>{summary?.unavailable ? "unavailable" : (waitedHours === null ? "—" : `${waitedHours} h`)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-xs text-gray-500">Accepted, but not fully processed</div>
          <div className={`text-2xl font-semibold ${summary?.failingProcessing > 0 ? "text-amber-600" : "text-gray-900"}`}>{summary?.unavailable ? "unavailable" : (summary ? summary.failingProcessing : "…")}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* the list */}
        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex gap-2 mb-3 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button key={f.key || "all"} onClick={() => setStatus(f.key)} className={`h-9 px-3 text-[13px] rounded-lg border ${status === f.key ? "bg-[#1540a4] text-white border-[#1540a4]" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}>{f.label}</button>
            ))}
          </div>
          {listError && <div className="text-sm text-rose-600 mb-2">{listError}</div>}
          <div className="divide-y divide-gray-100">
            {items.map((c) => (
              <button key={c.complaintId} onClick={() => openClaim(c.complaintId)} className={`w-full text-left py-3 px-2 rounded-lg hover:bg-gray-50 ${openId === c.complaintId ? "bg-[#eef2ff]" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">{c.name}</span>
                  <span className="ml-auto"><Pill meta={STATUS_META} value={c.status} /></span>
                </div>
                <div className="text-xs text-gray-500 mt-1">{c.reference} · {c.organization} · {fmtDate(c.receivedAt)}</div>
                {c.status === "accepted" && c.processingStatus !== "ok" && <div className="mt-1"><Pill meta={PROCESSING_META} value={c.processingStatus} /></div>}
              </button>
            ))}
            {!loading && !items.length && !listError && <div className="py-8 text-center text-sm text-gray-500">No claims here.</div>}
          </div>
          {loading && <div className="py-3 text-center text-sm text-gray-500">Loading…</div>}
          {next && !loading && <button onClick={() => loadList(false, next)} className="mt-3 w-full h-9 text-[13px] rounded-lg border border-gray-200 hover:bg-gray-50">Load more</button>}
        </div>

        {/* one claim */}
        <div className="xl:col-span-3 bg-white rounded-xl border border-gray-100 p-4 min-h-[320px]">
          {!openId && <div className="py-16 text-center text-sm text-gray-500">Choose a claim to review it.</div>}
          {openId && detailError && <div className="text-sm text-rose-600">{detailError}</div>}
          {openId && !detail && !detailError && <div className="text-sm text-gray-500">Loading…</div>}
          {claim && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start gap-3">
                <div>
                  <div className="text-lg font-semibold text-gray-900 break-words">{claim.name}</div>
                  <div className="text-xs text-gray-500">{claim.reference} · received {fmtDate(claim.receivedAt)}</div>
                </div>
                <span className="ml-auto"><Pill meta={STATUS_META} value={claim.status} /></span>
              </div>

              <section>
                <div className="text-xs font-semibold text-gray-500 mb-1">Claimant</div>
                <div className="text-sm text-gray-900">{claim.complainant.name} · {claim.complainant.organization}</div>
                <div className="text-sm text-gray-600">{claim.complainant.email}</div>
                {claim.sourceReference && <div className="text-xs text-gray-500 mt-1">Their reference: {claim.sourceReference}</div>}
              </section>

              <section>
                <div className="text-xs font-semibold text-gray-500 mb-1">Reason</div>
                <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">{claim.reason}</div>
              </section>

              {claim.evidenceUrl && (
                <section>
                  <div className="text-xs font-semibold text-gray-500 mb-1">Link given by the claimant (not opened by us)</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-[12px] bg-gray-50 border border-gray-200 rounded px-2 py-1 break-all">{claim.evidenceUrl}</code>
                    <button onClick={() => copyLink(claim.evidenceUrl)} className="h-8 px-2 text-[12px] rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1"><FiCopy size={12} /> Copy</button>
                    <button onClick={() => openLink(claim.evidenceUrl)} className="h-8 px-2 text-[12px] rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1"><FiExternalLink size={12} /> Open…</button>
                  </div>
                </section>
              )}

              <section>
                <div className="text-xs font-semibold text-gray-500 mb-1">Supporting files</div>
                {detail.filesError && <div className="text-sm text-amber-600">{detail.filesError}</div>}
                {!detail.files.length && !detail.filesError && <div className="text-sm text-gray-500">No files were attached. Documents may arrive by email, quoting {claim.reference}.</div>}
                {detail.files.map((f) => (
                  <div key={f.fileId} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className="truncate text-gray-900">{f.name}</span>
                    <span className="text-xs text-gray-500">{f.kind} · {Math.round((f.size || 0) / 1024)} KB</span>
                    <span className="ml-auto text-xs text-gray-500">{f.scanStatus === "clean" ? "scanned" : f.scanStatus === "pending" ? "scan pending" : f.scanStatus}</span>
                    <button disabled={f.scanStatus === "pending"} onClick={() => download(f)} className="h-8 px-2 text-[12px] rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1"><FiDownload size={12} /> Download</button>
                  </div>
                ))}
              </section>

              {claim.status === "pending" && (
                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs font-semibold text-gray-500">Does the name exist in our data?</div>
                    <button onClick={runPrecheck} disabled={checking} className="ml-auto h-8 px-2 text-[12px] rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"><FiSearch size={12} /> {checking ? "Searching…" : "Search networks"}</button>
                  </div>
                  {precheck && (
                    <div className="text-sm divide-y divide-gray-100 border border-gray-100 rounded-lg">
                      {precheck.map((n) => (
                        <div key={n.network} className="flex items-center gap-3 px-3 py-2">
                          <span className="w-28 text-gray-900">{n.network}</span>
                          <Pill meta={CHECK_META} value={n.check} />
                          <span className="text-xs text-gray-500 truncate">{n.check === "found" ? `${n.ads} ads, ${n.owners} advertiser(s)` : n.reason || ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {claim.status === "pending" ? (
                <section className="flex gap-3 pt-2">
                  <button onClick={() => { setReviewed(false); setNote(""); setDialog("accept"); }} className="h-10 px-4 rounded-lg bg-[#1540a4] text-white text-sm font-medium hover:bg-[#12358a]">Accept…</button>
                  <button onClick={() => { setReason(""); setDialog("reject"); }} className="h-10 px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 hover:bg-gray-50">Reject…</button>
                </section>
              ) : (
                <section>
                  <div className="text-xs font-semibold text-gray-500 mb-1">Decision</div>
                  <div className="text-sm text-gray-900">{STATUS_META[claim.status]?.label} by {claim.decision?.by} on {fmtDate(claim.decision?.at)}</div>
                  {claim.decision?.reason && <div className="text-sm text-gray-600 whitespace-pre-wrap break-words">{claim.decision.reason}</div>}
                </section>
              )}

              {claim.status === "accepted" && (
                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs font-semibold text-gray-500">What happened after the decision</div>
                    <Pill meta={PROCESSING_META} value={claim.processingStatus} />
                    {(claim.processingStatus === "partial" || claim.processingStatus === "failed") && (
                      <button onClick={retry} disabled={busy} className="ml-auto h-8 px-3 text-[12px] rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Retry</button>
                    )}
                  </div>
                  {claim.processing?.message && <div className="text-sm text-rose-600 mb-2">{claim.processing.message}</div>}
                  {(claim.processing?.networks || []).length > 0 && (
                    <div className="text-sm divide-y divide-gray-100 border border-gray-100 rounded-lg">
                      {claim.processing.networks.map((n) => (
                        <div key={n.network} className="flex items-center gap-3 px-3 py-2 flex-wrap">
                          <span className="w-28 text-gray-900">{n.network}</span>
                          <span className="text-xs">Block: <b className={n.blocklist === "failed" ? "text-rose-600" : "text-gray-800"}>{STEP_LABEL[n.blocklist] || n.blocklist}</b></span>
                          <span className="text-xs">Image hashing: <b className={n.hashing === "not_queued" ? "text-rose-600" : "text-gray-800"}>{STEP_LABEL[n.hashing] || n.hashing}</b></span>
                          {n.ads !== null && n.ads !== undefined && <span className="text-xs text-gray-500">{n.ads} ads found</span>}
                          {n.error && <span className="text-xs text-rose-600 truncate">{n.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 mt-2">Removing the ads that already exist is a separate step (takedown) and is not started by this decision.</div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      {dialog && claim && (
        <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5">
            <div className="flex items-start">
              <h3 className="text-lg font-semibold text-gray-900">{dialog === "accept" ? "Accept this claim?" : "Reject this claim?"}</h3>
              <button onClick={() => !busy && setDialog(null)} className="ml-auto text-gray-500 hover:text-gray-800"><FiX size={18} /></button>
            </div>
            <div className="mt-3 text-sm text-gray-700">
              {dialog === "accept" ? "The advertiser below will be blocked on every network and its images will be queued for hashing:" : "Nothing will be blocked. The claim is closed:"}
            </div>
            <div className="mt-2 text-lg font-semibold text-gray-900 break-words">{claim.name}</div>
            <div className="text-xs text-gray-500">{claim.reference} · {claim.complainant.organization}</div>

            {dialog === "accept" ? (
              <>
                <label className="mt-4 flex items-start gap-2 text-sm text-gray-800">
                  <input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                  <span>I reviewed the supporting documents and the name is the advertiser this claim is about.</span>
                </label>
                <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 255))} placeholder="Note (optional)" rows={2} className="mt-3 w-full border border-gray-200 rounded-lg p-2 text-sm" />
              </>
            ) : (
              <textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 255))} placeholder="Reason for rejecting (required)" rows={3} className="mt-4 w-full border border-gray-200 rounded-lg p-2 text-sm" />
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDialog(null)} disabled={busy} className="h-10 px-4 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">Cancel</button>
              <button
                onClick={submitDecision}
                disabled={busy || (dialog === "accept" ? !reviewed : !reason.trim())}
                className="h-10 px-4 rounded-lg bg-[#1540a4] text-white text-sm font-medium hover:bg-[#12358a] disabled:opacity-40"
              >
                {busy ? "Saving…" : dialog === "accept" ? "Accept claim" : "Reject claim"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

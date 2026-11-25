import React, { useCallback, useEffect, useRef, useState } from "react";
import Cookies from "js-cookie";
import { Link } from "react-router-dom";
import { FiRefreshCw, FiX, FiSearch } from "react-icons/fi";

/**
 * Takedown Monitor: how many ads/images were deleted, how many are waiting, how many failed, and the log of every step. READ ONLY.
 * (Comment-only change to trigger a fresh admin panel build, so the deployed bundle includes the complaint-id message fix from #1704.)
 *
 * Talks only to admin_panel_backend (/admin-panel/copyright-claims/monitor/...), which checks the admin login and the reviewers' allowlist.
 * Shows current verification stages, B3's takedown runs (and each delete step), and B2's image hash jobs. A network whose tables do not exist
 * yet is shown as "not available", never as zero.
 * A dry run is listed apart: it deleted nothing.
 *
 * Following one claim: `follow` ({ complaintId, reference, name, nonce }, from "Follow this claim" on the Requests tab, or the Complaint
 * column of the Blocked list) narrows the Blocked list and Rejected ads to what that complaint blocked and refused. Takedown runs are not
 * filtered by it: the cleanup job's runs carry no complaint id, and the page says so instead of showing an unexplained empty table.
 * Every tab starts with one plain sentence saying what it lists, and hash-job statuses are shown in words (the raw value is the tooltip).
 *
 * Ad ids: wherever an ad is shown, AdRef labels each id with its kind ("Platform ad id" = the network's own id, "Our row id" = the row in
 * our database; a tooltip explains both) and names the advertiser above it, so a tester can follow the ad up without guessing.
 *
 * Paging: every list that can grow without end shows one page at a time with Previous / Page N / Next (no endless "Load more"). The
 * APIs page by cursor, so each list keeps the cursors of the pages before it (`history`) and the cursor of the page on screen (`cursor`).
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
const TABS = [{ key: "verification", label: "Ad verification" }, { key: "runs", label: "Takedown runs" }, { key: "failures", label: "Failed steps" }, { key: "hash", label: "Hash jobs" }, { key: "blocklist", label: "Blocked list" }, { key: "attempts", label: "Rejected ads" }, { key: "audit", label: "Audit" }, { key: "claims", label: "Claim requests" }];
const VERIFICATION_STAGES = {
  not_checked: "Not checked yet", checking_metadata: "Checking ad details", checking_images: "Checking images",
  search_index_unavailable: "Waiting for search index", blocklist_unavailable: "Waiting for blocklist",
  hash_service_unavailable: "Waiting for image hash service", images_unavailable: "Waiting for images",
  near_match_review: "Near match needs review", blocklist_match: "Matched blocklist",
  updating_search_index: "Updating search index", search_index_update_failed: "Search index update failed",
  database_status_update_failed: "Saving verification status failed",
};
const AUDIT_STATUS_META = { open: "bg-amber-100 text-amber-700", in_progress: "bg-blue-100 text-blue-700", resolved: "bg-green-100 text-green-700", false_positive: "bg-gray-200 text-gray-700", completed: "bg-green-100 text-green-700", failed: "bg-rose-100 text-rose-700" };
const AUDIT_FINDING_STATUSES = ["open", "in_progress", "resolved", "false_positive"];
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
// hash-job statuses in plain words (the stored value stays in the tooltip, and is what the filter sends)
const HASH_LABEL = {
  pending: "Waiting", running: "Running", failed: "Failed", limit_reached: "Stopped at image limit", unresolved: "Ads not found",
  done: "Done", no_owner: "No ads to hash",
};
const hashLabel = (s) => HASH_LABEL[s] || s;
// one plain sentence per tab, shown at its top (the tabs that already explain themselves inline are not listed)
const TAB_HELP = {
  runs: "A takedown run is one pass of the cleanup job on one network: it deletes the ads that failed the copyright check. Click a run to see every delete step.",
  failures: "Single delete steps (storage, database or search) that failed on this network, newest first. Click one to open the run it belongs to.",
  hash: "A hash job fingerprints the images of one blocked advertiser (or ad, or link), so copies of those images are caught later. Click a job to see each image.",
  claims: "The claims that came in from the website form, read only. Decide on them in the Requests tab.",
};

/**
 * Where a list is after a page move. reset: back to page 1. "next": the page on screen goes onto the history. "back": the last page of the
 * history comes off it (its cursor is the one being loaded).
 */
const pageMove = (prev, reset, cursor, dir) => (reset
  ? { history: [], cursor: null }
  : dir === "back"
    ? { history: (prev.history || []).slice(0, -1), cursor }
    : { history: [...(prev.history || []), prev.cursor ?? null], cursor });

/** Previous / Page N / Next under a list. Hidden while everything fits on page 1. `onPage(cursor, dir)` loads the page. */
function Pager({ state, onPage }) {
  const page = (state.history?.length || 0) + 1;
  if (page === 1 && !state.next) return null;
  const btn = "px-3 py-1.5 rounded-lg border border-gray-300 bg-white! text-sm disabled:opacity-40";
  return (
    <nav className="flex items-center gap-2" aria-label="Pages">
      <button type="button" className={btn} disabled={page === 1 || state.loading} onClick={() => onPage(state.history[state.history.length - 1] ?? null, "back")}>‹ Previous</button>
      <span className="text-sm text-gray-600">Page {page}</span>
      <button type="button" className={btn} disabled={!state.next || state.loading} onClick={() => onPage(state.next, "next")}>Next ›</button>
    </nav>
  );
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fmtDate = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const ageOf = (d) => {
  if (!d) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

// What the two kinds of ad id are, in the words shown on hover.
const ID_HELP = {
  platform: "Platform ad id: the ad network's own id for this ad (what the scraper sent). Use it to find the ad on the network or in PowerAdSpy search.",
  row: "Our row id: the number of the ad's row in our own database table for this network. It is not the same as the platform ad id.",
};

/** One ad, readable at a glance: the advertiser, then each id with a label saying which kind it is. Missing parts are left out. */
function AdRef({ advertiser, platformId, rowId }) {
  if (!advertiser && !platformId && !rowId) return <span>—</span>;
  return (
    <div className="space-y-0.5">
      <div className="font-medium text-gray-900 break-words" title="Advertiser of this ad">{advertiser || <span className="text-gray-400 font-normal">advertiser unknown</span>}</div>
      {platformId && <div className="text-xs break-all" title={ID_HELP.platform}><span className="text-gray-400">Platform ad id </span><span className="font-mono">{platformId}</span></div>}
      {rowId && <div className="text-xs break-all" title={ID_HELP.row}><span className="text-gray-400">Our row id </span><span className="font-mono">{rowId}</span></div>}
    </div>
  );
}

/** A takedown step's target: an ad as an AdRef, anything else as "type: value". */
function StepTarget({ s }) {
  if (s.targetType === "ad") return <AdRef advertiser={s.advertiser} platformId={s.targetId || s.targetValue} rowId={s.internalAdId} />;
  return <>{s.targetType}: {s.targetValue || s.targetId || s.internalAdId || "—"}</>;
}

// What each kind of block catches, in one line (shown under the type in the Blocked list).
const BLOCK_EXPLAIN = {
  advertiser: "blocks every ad of this advertiser name (also spelled without spaces, with dashes or dots)",
  page: "blocks every ad of this page name",
  url: "blocks ads using this link (image, video or landing page)",
  domain: "blocks ads landing on this website or its sub-domains",
  image_url: "blocks ads using this image address",
  image_hash: "blocks this exact image under any advertiser",
};
// Where the check found the match, in words.
const CAUSE_SOURCE = { verification: "new-ad check", "verification-recheck": "recheck of existing ads" };

/**
 * Why the cleanup blocked an ad id: the ad failed the copyright check, and `cause` (from the check's own record) says what it matched.
 * Without a record the page says so, instead of leaving only "failed copyright verification".
 */
function BlockCause({ b }) {
  if (b.entryType !== "ad_id" || b.addedBy !== "copyright-verification") return null;
  const c = b.cause;
  if (!c) return <div className="mt-1 text-xs text-gray-400">What this ad matched was not found. Without the attempts index on this network, only the two days before the block are searched; otherwise no record was kept.</div>;
  const e = c.matchedEntry;
  return (
    <div className="mt-1 rounded-lg bg-amber-50 border border-amber-100 px-2 py-1.5 text-xs text-amber-900 space-y-0.5">
      <div>
        <b>Why:</b> the ad matched <b>{MATCH_LABEL[c.matchType] || c.matchType}</b>
        {e && <> — blocked {ENTRY_LABEL[e.type] || e.type}{e.type === "ad_id" ? (e.namespace === "internal" ? " (our row id)" : " (platform ad id)") : ""} <span className="font-mono break-all" title={e.value}>{shortHash(e.value)}</span></>}
        {c.distance !== null && c.distance !== undefined && <> ({c.distance} bits apart)</>}
      </div>
      {c.advertiser && <div>Advertiser of the ad: <b>{c.advertiser}</b></div>}
      <div className="text-amber-800/80">Found by the {CAUSE_SOURCE[c.source] || c.source || "check"}{e?.complaintId ? <> · claim <span className="font-mono" title={e.complaintId}>{e.complaintId.slice(0, 8)}</span></> : null} · {fmtDate(c.at)}</div>
    </div>
  );
}

// The kind of blocklist entry a rejected ad matched, in words.
const ENTRY_LABEL = { advertiser: "advertiser", page: "page", ad_id: "ad id", url: "URL", domain: "domain", image_url: "image URL", image_hash: "image" };

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

function Stat({ label, value, tone = "text-[#1f296a]", hint, help }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-[140px]" title={help}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function TakedownMonitor({ follow, onOpenRequests } = {}) {
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState("");
  const [imageHashingHealthy, setImageHashingHealthy] = useState(null);
  const [verification, setVerification] = useState({ items: [], next: null, available: true, reason: "", error: "", loading: false });
  const [forbidden, setForbidden] = useState(false);
  const [network, setNetwork] = useState("");
  const [tab, setTab] = useState("runs");

  const [runFilter, setRunFilter] = useState("");
  const [complaint, setComplaint] = useState("");
  const [complaintQuery, setComplaintQuery] = useState("");
  // the "not a complaint id" message has its own state: kept in runs.error it outlived the text it was about, because clearing the
  // input does not reload the runs. It goes away as soon as the input changes, is cleared, or another network is chosen.
  const [complaintError, setComplaintError] = useState("");
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
  const [audits, setAudits] = useState({ items: [], next: null, error: "", loading: false });

  const [claimStatus, setClaimStatus] = useState("");
  // the claim being followed: Blocked list and Rejected ads show only what this complaint blocked / refused
  const [followed, setFollowed] = useState(null);
  const [claims, setClaims] = useState({ items: [], next: null, error: "", loading: false });

  const [open, setOpen] = useState(null); // { kind: 'run'|'job', network, id }
  const [log, setLog] = useState({ data: null, items: [], next: null, error: "", loading: false });
  const [stepStatus, setStepStatus] = useState("");
  const [stepSystem, setStepSystem] = useState("");
  const [outcome, setOutcome] = useState("");
  const [findingStatus, setFindingStatus] = useState("");
  const openRef = useRef(null);
  const verificationRef = useRef(null);
  openRef.current = open;
  verificationRef.current = verification;

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

  const loadImageHashingHealth = useCallback(async () => {
    try {
      const { ok, json } = await api("/image-hashing-health");
      setImageHashingHealthy(ok && json?.data?.healthy === true);
    } catch { setImageHashingHealthy(false); }
  }, []);

  const loadVerification = useCallback(async (reset = true, cursor = null, dir = "next") => {
    if (!network) return;
    setVerification((v) => ({ ...v, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/verification", { network, afterId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setVerification((v) => ({ ...v, loading: false, error: json?.message || "The verification details could not be loaded." })); return; }
      setVerification((v) => ({
        items: json.data.items, ...pageMove(v, reset, cursor, dir), next: json.data.next,
        available: json.data.available, reason: json.data.reason || "", error: "", loading: false,
      }));
    } catch { setVerification((v) => ({ ...v, loading: false, error: "The verification details could not be loaded." })); }
  }, [network]);

  const loadRuns = useCallback(async (reset = true, cursor = null, dir = "next") => {
    if (!network && !complaintQuery) return;
    setRuns((r) => ({ ...r, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/runs", { network: complaintQuery ? undefined : network, complaintId: complaintQuery, status: runFilter, cursor: reset ? undefined : cursor, limit: 25 });
      if (!ok) { setRuns((r) => ({ ...r, loading: false, error: json?.message || "The runs could not be loaded." })); return; }
      setRuns((r) => ({ items: json.data.items, ...pageMove(r, reset, cursor, dir), next: json.data.next, unavailable: json.data.unavailable || [], error: "", loading: false }));
    } catch { setRuns((r) => ({ ...r, loading: false, error: "The runs could not be loaded." })); }
  }, [network, runFilter, complaintQuery]);

  const loadFailures = useCallback(async (reset = true, cursor = null, dir = "next") => {
    if (!network) return;
    setFailures((f) => ({ ...f, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/failures", { network, beforeId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setFailures((f) => ({ ...f, loading: false, error: json?.message || "The failed steps could not be loaded." })); return; }
      setFailures((f) => ({ items: json.data.items, ...pageMove(f, reset, cursor, dir), next: json.data.next, error: "", loading: false }));
    } catch { setFailures((f) => ({ ...f, loading: false, error: "The failed steps could not be loaded." })); }
  }, [network]);

  const loadHash = useCallback(async (reset = true, cursor = null, dir = "next") => {
    if (!network) return;
    setHash((h) => ({ ...h, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/hash-jobs", { network, status: hashStatus, afterId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setHash((h) => ({ ...h, loading: false, error: json?.message || "The hash jobs could not be loaded." })); return; }
      setHash((h) => ({ items: json.data.items, ...pageMove(h, reset, cursor, dir), next: json.data.items.length ? json.data.next : null, error: "", loading: false }));
    } catch { setHash((h) => ({ ...h, loading: false, error: "The hash jobs could not be loaded." })); }
  }, [network, hashStatus]);

  // Who and what is blocked in the chosen network (B1), and the ads the blocklist refused.
  const loadBlocklist = useCallback(async (reset = true, cursor = null, dir = "next") => {
    if (!network) return;
    setBlocklist((b) => ({ ...b, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/blocklist", { network, status: blockStatus, entryType: blockType, q: blockSearch, complaintId: followed?.complaintId, beforeId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setBlocklist((b) => ({ ...b, loading: false, error: json?.message || "The blocklist could not be loaded." })); return; }
      setBlocklist((b) => ({ items: json.data.items, ...pageMove(b, reset, cursor, dir), next: json.data.next, counts: json.data.counts, error: "", loading: false }));
    } catch { setBlocklist((b) => ({ ...b, loading: false, error: "The blocklist could not be loaded." })); }
  }, [network, blockStatus, blockType, blockSearch, followed]);

  const loadAttempts = useCallback(async (reset = true, cursor = null, dir = "next") => {
    if (!network) return;
    setAttempts((a) => ({ ...a, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/attempts", { network, complaintId: followed?.complaintId, beforeId: reset ? undefined : cursor, limit: 50 });
      if (!ok) { setAttempts((a) => ({ ...a, loading: false, error: json?.message || "The rejected ads could not be loaded." })); return; }
      setAttempts((a) => ({ items: json.data.items, ...pageMove(a, reset, cursor, dir), next: json.data.next, error: "", loading: false }));
    } catch { setAttempts((a) => ({ ...a, loading: false, error: "The rejected ads could not be loaded." })); }
  }, [network, followed]);

  // B6's audit runs (each verification cleanup writes one) and, when one is opened, what it found.
  const loadAudits = useCallback(async (reset = true, cursor = null, dir = "next") => {
    if (!network) return;
    setAudits((a) => ({ ...a, loading: true, error: "" }));
    try {
      const { ok, json } = await api("/audits", { network, cursor: reset ? undefined : cursor, limit: 25 });
      if (!ok) { setAudits((a) => ({ ...a, loading: false, error: json?.message || "The audit could not be loaded." })); return; }
      setAudits((a) => ({ items: json.data.items, ...pageMove(a, reset, cursor, dir), next: json.data.next, error: "", loading: false }));
    } catch { setAudits((a) => ({ ...a, loading: false, error: "The audit could not be loaded." })); }
  }, [network]);

  // The claim requests that came in (the claims list of the same backend): who sent what, and what was decided. Deciding is done on the Copyright Claims page.
  const loadClaims = useCallback(async (reset = true, cursor = null, dir = "next") => {
    setClaims((c) => ({ ...c, loading: true, error: "" }));
    try {
      const { ok, json } = await api("", { status: claimStatus, beforeId: reset ? undefined : cursor, limit: 25 }, CLAIMS);
      if (!ok) { setClaims((c) => ({ ...c, loading: false, error: json?.message || "The claim requests could not be loaded." })); return; }
      setClaims((c) => ({ items: json.data.items, ...pageMove(c, reset, cursor, dir), next: json.data.items.length ? json.data.next : null, error: "", loading: false }));
    } catch { setClaims((c) => ({ ...c, loading: false, error: "The claim requests could not be loaded." })); }
  }, [claimStatus]);

  const loadLog = useCallback(async (target, reset = true, cursor = null, dir = "next") => {
    setLog((l) => ({ ...l, loading: true, error: "", ...(reset ? { data: null, items: [], next: null } : {}) }));
    try {
      const res = target.kind === "run"
        ? await api(`/runs/${target.id}/logs`, { network: target.network, status: stepStatus, system: stepSystem, afterId: reset ? undefined : cursor, limit: 100 })
        : target.kind === "audit"
          ? await api(`/audits/${target.id}/findings`, { network: target.network, status: findingStatus, afterId: reset ? undefined : cursor, limit: 100 })
          : await api(`/hash-jobs/${target.id}/results`, { network: target.network, outcome, afterId: reset ? undefined : cursor, limit: 200 });
      if (openRef.current !== target) return;
      if (!res.ok) { setLog((l) => ({ ...l, loading: false, error: res.json?.message || "The log could not be loaded." })); return; }
      const d = res.json.data;
      setLog((l) => ({ data: reset ? d : l.data, items: d.items, ...pageMove(l, reset, cursor, dir), next: d.items.length ? d.next : null, error: "", loading: false }));
    } catch { setLog((l) => ({ ...l, loading: false, error: "The log could not be loaded." })); }
  }, [stepStatus, stepSystem, outcome, findingStatus]);

  // "Follow this claim" from the Requests tab: show that claim's blocks (the nonce re-applies it when the same claim is followed again)
  useEffect(() => {
    if (!follow?.complaintId) return;
    setFollowed({ complaintId: follow.complaintId, reference: follow.reference || null, name: follow.name || null });
    setTab("blocklist");
  }, [follow?.complaintId, follow?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const followComplaint = (complaintId, name = null) => { setFollowed({ complaintId, reference: null, name }); setTab("blocklist"); };
  useEffect(() => { loadOverview(); const t = setInterval(loadOverview, 60000); return () => clearInterval(t); }, [loadOverview]);
  useEffect(() => { loadImageHashingHealth(); const t = setInterval(loadImageHashingHealth, 60000); return () => clearInterval(t); }, [loadImageHashingHealth]);
  useEffect(() => {
    if (tab !== "verification") return undefined;
    loadVerification(true);
    // the minute refresh only on page 1: someone reading page 3 is not sent back to the first page
    const t = setInterval(() => { if (!verificationRef.current.history?.length) loadVerification(true); }, 60000);
    return () => clearInterval(t);
  }, [tab, loadVerification]);
  useEffect(() => { if (tab === "runs") loadRuns(true); }, [tab, loadRuns]);
  useEffect(() => { if (tab === "failures") loadFailures(true); }, [tab, loadFailures]);
  useEffect(() => { if (tab === "hash") loadHash(true); }, [tab, loadHash]);
  useEffect(() => { if (tab === "blocklist") loadBlocklist(true); }, [tab, loadBlocklist]);
  useEffect(() => { if (tab === "attempts") loadAttempts(true); }, [tab, loadAttempts]);
  useEffect(() => { if (tab === "audit") loadAudits(true); }, [tab, loadAudits]);
  useEffect(() => { if (tab === "claims") loadClaims(true); }, [tab, loadClaims]);
  useEffect(() => { if (open) loadLog(open, true); }, [open, loadLog]);

  const refresh = () => { loadOverview(); loadImageHashingHealth(); if (tab === "verification") loadVerification(true); if (tab === "runs") loadRuns(true); if (tab === "failures") loadFailures(true); if (tab === "hash") loadHash(true); if (tab === "blocklist") loadBlocklist(true); if (tab === "attempts") loadAttempts(true); if (tab === "audit") loadAudits(true); if (tab === "claims") loadClaims(true); if (open) loadLog(open, true); };
  const submitBlockSearch = (e) => { e.preventDefault(); setBlockSearch(blockText.trim()); };
  const openRun = (r) => { setStepStatus(""); setStepSystem(""); setOpen({ kind: "run", network: r.network, id: r.runId }); };
  const openJob = (j) => { setOutcome(""); setOpen({ kind: "job", network: j.network, id: j.id }); };
  const openAudit = (a) => { setFindingStatus(""); setOpen({ kind: "audit", network: a.network, id: a.auditId }); };
  // From a run log: the audit written for that run (a run that removed no ad has none).
  const openAuditOfRun = async (run) => {
    try {
      const { ok, json } = await api("/audits", { network: run.network, takedownRunId: run.runId, limit: 1 });
      const found = ok && json?.data?.items?.[0];
      if (found) openAudit(found);
      else setLog((l) => ({ ...l, error: ok ? "There is no audit for this run: it removed no ad, or it ran before the audit was saved." : json?.message || "The audit could not be loaded." }));
    } catch { setLog((l) => ({ ...l, error: "The audit could not be loaded." })); }
  };
  const submitComplaint = (e) => {
    e.preventDefault();
    const value = complaint.trim();
    if (value && !UUID.test(value)) { setComplaintError("That is not a complaint id."); return; }
    setComplaintError("");
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
        <div className="flex items-center gap-2">
          <div role="status" aria-live="polite" className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${imageHashingHealthy === null ? "bg-gray-400 animate-pulse" : imageHashingHealthy ? "bg-green-500" : "bg-rose-500"}`} />
            <span>Image hashing service</span>
            <span className={`font-medium ${imageHashingHealthy === null ? "text-gray-500" : imageHashingHealthy ? "text-green-700" : "text-rose-700"}`}>
              {imageHashingHealthy === null ? "Checking" : imageHashingHealthy ? "Healthy" : "Unavailable"}
            </span>
          </div>
          <button onClick={refresh} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white! text-sm hover:bg-gray-50!" aria-label="Refresh">
            <FiRefreshCw /> Refresh
          </button>
        </div>
      </div>

      {overviewError && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{overviewError}</div>}

      {totals && (
        <div className="flex gap-3 flex-wrap">
          <Stat label="Deleted" value={totals.items.deleted} tone="text-green-600" hint="ads removed in real runs" help="Ads really deleted by takedown runs, all networks added up. A dry run never counts." />
          <Stat label="Waiting" value={totals.items.waiting} tone="text-amber-600" hint="planned, not yet done" help="Ads a run planned to delete that are neither done nor failed yet. Normally 0, or a few while a run is working." />
          <Stat label="Failed" value={totals.items.failed} tone="text-rose-600" hint="ads whose delete failed (per run)" help="Counted per run: an ad in two stopped runs counts twice. To know what is really left, look at Waiting for cleanup." />
          {totals.verification && <Stat label="Waiting for check" value={totals.verification.pending} tone="text-amber-600" hint="new ads hidden until verified" help="New ads saved but hidden from search until the copyright check (every 2 minutes) looks at them." />}
          {totals.verification && <Stat label="Waiting for cleanup" value={totals.verification.failed} tone="text-rose-600" hint="failed check, not deleted yet" help="Ads that matched the block list. They are hidden already, and the cleanup job (every 15 minutes) deletes them." />}
          <Stat label="Takedown runs" value={totals.runs.total} hint={Object.entries(totals.runs.byGroup).map(([g, n]) => `${(GROUP_META[g] || GROUP_META.other).label} ${n}`).join(" · ") || "none yet"} help="How many cleanup passes have run, by state." />
          <Stat label="Hash jobs" value={totals.hashJobs.total} hint={Object.entries(totals.hashJobs.byStatus).map(([s, n]) => `${hashLabel(s)} ${n}`).join(" · ") || "none yet"} help="Image fingerprint jobs, one per blocked entry and network, by state." />
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
                <tr key={n.network} className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${network === n.network ? "bg-indigo-50" : ""}`} onClick={() => { setNetwork(n.network); setComplaintQuery(""); setComplaint(""); setComplaintError(""); }}>
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
                      ? (Object.entries(n.hashJobs.byStatus).map(([s, c]) => <span key={s} title={s} className={`mr-1 inline-block px-2 py-0.5 rounded-full text-xs ${HASH_META[s] || "bg-gray-100 text-gray-600"}`}>{hashLabel(s)} {c}</span>) || null)
                      : <span className="text-gray-400">not available</span>}
                    {n.hashJobs.available && n.hashJobs.total === 0 && <span className="text-gray-400">none</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {overview && <p className="text-xs text-gray-500 -mt-2">Click a network in the table to choose it. The tabs below always show the chosen network.</p>}

      {followed && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg p-3 text-sm flex items-start gap-3 flex-wrap" role="status">
          <div className="space-y-1">
            <div>Following claim <b>{followed.reference || followed.complaintId.slice(0, 8)}</b>{followed.name ? <> (<b>{followed.name}</b>)</> : null} on <b>{network || "—"}</b>.</div>
            <div className="text-xs">Blocked list and Rejected ads show only what this claim blocked and refused. Choose another network in the table to see it there. Takedown runs are not linked to a claim, so that tab is not filtered.</div>
            <div className="text-[11px] font-mono break-all">complaint id {followed.complaintId}</div>
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setTab("blocklist")} className="px-3 py-1.5 rounded-lg border border-indigo-300 bg-white! text-xs">Blocked list</button>
            <button type="button" onClick={() => setTab("attempts")} className="px-3 py-1.5 rounded-lg border border-indigo-300 bg-white! text-xs">Rejected ads</button>
            <button type="button" onClick={() => setFollowed(null)} className="px-3 py-1.5 rounded-lg border border-indigo-300 bg-white! text-xs">Stop following</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 text-sm font-semibold border-b-2 ${tab === t.key ? "border-[#1f296a] text-[#1f296a]" : "border-transparent text-gray-500"}`}>{t.label}</button>
        ))}
        <span className="ml-auto text-sm text-gray-500 pb-2">Network: <b>{network || "—"}</b></span>
      </div>

      {TAB_HELP[tab] && <p className="text-sm text-gray-500">{TAB_HELP[tab]}</p>}

      {tab === "verification" && (
        <section className="space-y-3">
          <p className="text-sm text-gray-500">Ads still at copyright status 0 for {network || "this network"}. The stage and detail show the verifier’s last recorded progress.</p>
          {verification.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{verification.error}</div>}
          {!verification.available && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
              {verification.reason === "diagnostics_not_migrated"
                ? "Per-ad stage details are not installed on this network yet. Apply the copyright schema update, then refresh."
                : verification.reason === "no_column"
                  ? "The copyright status column is not installed on this network."
                  : verification.reason === "no_database"
                    ? "This network’s database is not available."
                    : "Verification details are not available for this network."}
            </div>
          )}
          {verification.available && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">Ad</th><th className="p-3">Current stage</th><th className="p-3">Image attempts</th><th className="p-3">Detail</th><th className="p-3">First checked</th><th className="p-3">Last checked</th></tr></thead>
                <tbody>
                  {verification.items.map((item) => (
                    <tr key={`${network}-${item.internalAdId}`} className="border-t border-gray-100">
                      <td className="p-3 min-w-48"><AdRef advertiser={item.advertiser} platformId={item.platformAdId} rowId={item.internalAdId} /></td>
                      <td className="p-3"><Badge cls={item.stage === "near_match_review" || item.stage === "blocklist_unavailable" || item.stage === "search_index_unavailable" || item.stage === "hash_service_unavailable" || item.stage === "images_unavailable" || item.stage.endsWith("failed") ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"}>{VERIFICATION_STAGES[item.stage] || item.stage}</Badge></td>
                      <td className="p-3">{item.attempts}</td>
                      <td className="p-3 min-w-64">{item.detail}</td>
                      <td className="p-3 text-gray-500 whitespace-nowrap">{fmtDate(item.firstCheckedAt)}</td>
                      <td className="p-3 text-gray-500 whitespace-nowrap">{fmtDate(item.lastCheckedAt)}<div className="text-xs text-gray-400">{ageOf(item.lastCheckedAt)}</div></td>
                    </tr>
                  ))}
                  {!verification.items.length && !verification.loading && <tr><td className="p-4 text-gray-500" colSpan={6}>No ads are waiting for check on this network.</td></tr>}
                  {verification.loading && !verification.items.length && <tr><td className="p-4 text-gray-500" colSpan={6}>Loading verification details…</td></tr>}
                </tbody>
              </table>
              <div className="p-3 border-t border-gray-100 empty:hidden"><Pager state={verification} onPage={(c, d) => loadVerification(false, c, d)} /></div>
            </div>
          )}
        </section>
      )}

      {tab === "runs" && (
        <section className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            {RUN_FILTERS.map((f) => (
              <button key={f.key || "all"} onClick={() => setRunFilter(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${runFilter === f.key ? "bg-[#1f296a]! text-white border-[#1f296a]" : "bg-white! text-gray-600 border-gray-300"}`}>{f.label}</button>
            ))}
            <form onSubmit={submitComplaint} className="ml-auto flex items-center gap-2">
              <input value={complaint} onChange={(e) => { setComplaint(e.target.value); setComplaintError(""); }} placeholder="Find by complaint id (the long id)" title="The long complaint id shown on the claim page, for example 11111111-1111-4111-8111-111111111111. The short CR- reference does not work here." aria-label="Complaint id" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-72" />
              <button type="submit" className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white! text-sm" aria-label="Search"><FiSearch /></button>
              {(complaintQuery || complaint) && <button type="button" onClick={() => { setComplaint(""); setComplaintQuery(""); setComplaintError(""); }} className="text-xs text-gray-500 underline">clear</button>}
            </form>
          </div>
          {complaintError && <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{complaintError}</div>}
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
                    <td className="p-3 font-mono text-xs text-gray-500" title={r.complaintId || undefined}>{r.complaintId ? r.complaintId.slice(0, 8) : (r.triggerType || "—")}</td>
                  </tr>
                ))}
                {!runs.loading && !runs.items.length && !runs.error && !complaintQuery && <tr><td className="p-4 text-gray-500" colSpan={8}>No takedown runs{runs.unavailable.length ? ` (not available: ${runs.unavailable.join(", ")})` : ""}.</td></tr>}
                {/* the cleanup job's runs carry no complaint id, so a complaint search is normally empty: say why, and offer what does work */}
                {!runs.loading && !runs.items.length && !runs.error && complaintQuery && (
                  <tr><td className="p-4 text-gray-600" colSpan={8}>
                    No takedown run is linked to this complaint. Runs are started by the cleanup job (trigger <i>verification</i>), which deletes the ads that failed the copyright check without recording which claim caused it.
                    {" "}<button type="button" onClick={() => followComplaint(complaintQuery)} className="text-[#1f296a] underline">Show this claim&apos;s blocks and rejected ads instead</button>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager state={runs} onPage={(c, d) => loadRuns(false, c, d)} />
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
                    <td className="p-3 break-all min-w-48"><StepTarget s={s} /></td>
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
          <Pager state={failures} onPage={(c, d) => loadFailures(false, c, d)} />
        </section>
      )}

      {tab === "hash" && (
        <section className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {HASH_FILTERS.map((s) => (
              <button key={s || "all"} onClick={() => setHashStatus(s)} title={s || undefined} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${hashStatus === s ? "bg-[#1f296a]! text-white border-[#1f296a]" : "bg-white! text-gray-600 border-gray-300"}`}>{s ? hashLabel(s) : "All"}</button>
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
                    <td className="p-3" title={j.status}><Badge cls={HASH_META[j.status]}>{hashLabel(j.status)}</Badge></td>
                    <td className="p-3">{j.attempts}</td>
                    <td className="p-3 text-gray-500">{fmtDate(j.updatedAt)}</td>
                    <td className="p-3 text-rose-700 break-words max-w-md">{j.lastError || "—"}</td>
                  </tr>
                ))}
                {!hash.loading && !hash.items.length && !hash.error && <tr><td className="p-4 text-gray-500" colSpan={6}>No hash jobs.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager state={hash} onPage={(c, d) => loadHash(false, c, d)} />
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
              <button key={f.key || "all"} onClick={() => setBlockStatus(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${blockStatus === f.key ? "bg-[#1f296a]! text-white border-[#1f296a]" : "bg-white! text-gray-600 border-gray-300"}`}>{f.label}</button>
            ))}
            <select aria-label="Block type" value={blockType} onChange={(e) => setBlockType(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
              {BLOCK_TYPES.map((t) => <option key={t.key || "all"} value={t.key}>{t.label}</option>)}
            </select>
            <form onSubmit={submitBlockSearch} className="ml-auto flex items-center gap-2">
              <input value={blockText} onChange={(e) => setBlockText(e.target.value)} placeholder="Search a blocked name or link" aria-label="Search blocked" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64" />
              <button type="submit" className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white! text-sm" aria-label="Search blocked list"><FiSearch /></button>
              {blockSearch && <button type="button" onClick={() => { setBlockText(""); setBlockSearch(""); }} className="text-xs text-gray-500 underline">clear</button>}
            </form>
          </div>
          {blocklist.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{blocklist.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">Type</th><th className="p-3">Blocked</th><th className="p-3">Status</th><th className="p-3">Added by</th><th className="p-3">Added</th><th className="p-3">Reason (and why)</th><th className="p-3">Complaint</th></tr></thead>
              <tbody>
                {blocklist.items.map((b) => (
                  <tr key={b.id} className="border-t border-gray-100 align-top">
                    <td className="p-3 max-w-[14rem]">
                      <div className="whitespace-nowrap">{b.entryType}</div>
                      {b.entryType === "ad_id" && b.identifierNamespace && <div className="text-xs text-gray-400" title={b.identifierNamespace === "internal" ? ID_HELP.row : ID_HELP.platform}>{b.identifierNamespace === "internal" ? "our row id: blocks this one ad" : "platform ad id: blocks this one ad"}</div>}
                      {BLOCK_EXPLAIN[b.entryType] && <div className="text-xs text-gray-400">{BLOCK_EXPLAIN[b.entryType]}</div>}
                    </td>
                    <td className="p-3 break-all font-medium" title={b.value}>
                      {shortHash(b.value)}
                      {/* an image fingerprint: the ad the image was taken from */}
                      {b.origin && (b.origin.platformAdId || b.origin.internalAdId) && (
                        <div className="mt-1 font-normal text-xs text-gray-500"><div className="text-gray-400">image of the ad:</div><AdRef advertiser={b.origin.advertiser} platformId={b.origin.platformAdId} rowId={b.origin.internalAdId} /></div>
                      )}
                    </td>
                    <td className="p-3"><Badge cls={BLOCK_STATUS_META[b.status]}>{b.status}</Badge>{b.removedBy && <div className="text-xs text-gray-400 mt-1">by {b.removedBy} · {fmtDate(b.removedAt)}</div>}</td>
                    <td className="p-3 text-gray-600">{b.addedBy || "—"}{b.source && <div className="text-xs text-gray-400">{b.source}</div>}</td>
                    <td className="p-3 text-gray-500">{fmtDate(b.createdAt)}{b.expiresAt && <div className="text-xs text-gray-400">expires {fmtDate(b.expiresAt)}</div>}</td>
                    <td className="p-3 break-words max-w-sm"><div>{b.reason || "—"}</div><BlockCause b={b} /></td>
                    <td className="p-3 font-mono text-xs text-gray-500">{b.complaintId
                      ? <button type="button" title={`${b.complaintId}\nClick to show only this claim's blocks and rejected ads`} onClick={() => followComplaint(b.complaintId, b.entryType === "advertiser" ? b.value : null)} className="text-[#1f296a] underline">{b.complaintId.slice(0, 8)}</button>
                      : "—"}</td>
                  </tr>
                ))}
                {!blocklist.loading && !blocklist.items.length && !blocklist.error && <tr><td className="p-4 text-gray-500" colSpan={7}>Nothing is blocked here{followed ? " for this claim" : ""}{blockSearch || blockType || blockStatus ? " with these filters" : followed ? "" : " yet"}.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager state={blocklist} onPage={(c, d) => loadBlocklist(false, c, d)} />
        </section>
      )}

      {tab === "attempts" && (
        <section className="space-y-3">
          <p className="text-sm text-gray-500">Ads of <b>{network || "this network"}</b> that the blocklist refused (newest first): at insertion, when a new ad was checked (verification), or when an existing ad matched a new block (verification-recheck; the cleanup cron then deletes it). Only identifiers are kept, never the ad itself.</p>
          {attempts.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{attempts.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">When</th><th className="p-3">Refused because</th><th className="p-3">Advertiser</th><th className="p-3" title={ID_HELP.platform}>Platform ad id</th><th className="p-3">Image</th><th className="p-3">Source</th></tr></thead>
              <tbody>
                {attempts.items.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100 align-top">
                    <td className="p-3 text-gray-500 whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                    <td className="p-3"><Badge cls="bg-rose-100 text-rose-700">{MATCH_LABEL[a.matchType] || a.matchType}</Badge>{a.distance !== null && <div className="text-xs text-gray-400 mt-1">{a.distance} bits apart</div>}
                      {/* which block entry it hit: the advertiser name, the platform ad id or row id, the image fingerprint… */}
                      {a.matchedEntry && <div className="text-xs text-gray-500 mt-1 break-all" title={a.matchedEntry.value}>matched {ENTRY_LABEL[a.matchedEntry.type] || a.matchedEntry.type}{a.matchedEntry.type === "ad_id" ? (a.matchedEntry.namespace === "internal" ? " (our row id)" : " (platform ad id)") : ""}: <span className="font-mono">{shortHash(a.matchedEntry.value)}</span></div>}</td>
                    <td className="p-3 break-words">{a.advertiser || <span className="text-gray-400" title="The ad did not carry a name, and it no longer exists in our data">unknown</span>}</td>
                    <td className="p-3 font-mono text-xs break-all">{a.platformAdId || "—"}</td>
                    <td className="p-3 break-all text-gray-500 text-xs max-w-xs">{a.imageUrl || "—"}</td>
                    <td className="p-3 text-gray-500 text-xs">{a.source || "—"}</td>
                  </tr>
                ))}
                {!attempts.loading && !attempts.items.length && !attempts.error && <tr><td className="p-4 text-gray-500" colSpan={6}>{followed ? "No ad has been refused for this claim on this network yet." : "No ad has been refused here yet."}</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager state={attempts} onPage={(c, d) => loadAttempts(false, c, d)} />
        </section>
      )}

      {tab === "audit" && (
        <section className="space-y-3">
          <p className="text-sm text-gray-500">The audit of <b>{network || "this network"}</b>, newest first: one row per check (for example each verification cleanup), with how many ads it expected to remove and how many it found removed. Open one to see each finding.</p>
          {audits.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{audits.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">When</th><th className="p-3">Audit</th><th className="p-3">Type</th><th className="p-3">Status</th><th className="p-3">Expected</th><th className="p-3">Found</th><th className="p-3">Takedown run</th></tr></thead>
              <tbody>
                {audits.items.map((a) => (
                  <tr key={a.auditId} className="border-t border-gray-100 align-top cursor-pointer hover:bg-gray-50" onClick={() => openAudit(a)}>
                    <td className="p-3 text-gray-500 whitespace-nowrap">{fmtDate(a.finishedAt || a.startedAt || a.createdAt)}</td>
                    <td className="p-3 font-mono text-xs">{a.auditId.slice(0, 8)}</td>
                    <td className="p-3">{a.auditType}</td>
                    <td className="p-3"><Badge cls={AUDIT_STATUS_META[a.status]}>{a.status}</Badge></td>
                    <td className="p-3">{a.expectedCount}</td>
                    <td className={`p-3 ${a.foundCount === a.expectedCount ? "text-green-700" : "text-rose-700"}`}>{a.foundCount}</td>
                    <td className="p-3">{a.takedownRunId
                      ? <button type="button" className="font-mono text-xs text-[#1f296a] underline" onClick={(e) => { e.stopPropagation(); openRun({ network: a.network, runId: a.takedownRunId }); }}>{a.takedownRunId.slice(0, 8)}</button>
                      : "—"}</td>
                  </tr>
                ))}
                {!audits.loading && !audits.items.length && !audits.error && <tr><td className="p-4 text-gray-500" colSpan={7}>No audit yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager state={audits} onPage={(c, d) => loadAudits(false, c, d)} />
        </section>
      )}

      {tab === "claims" && (
        <section className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            {CLAIM_FILTERS.map((f) => (
              <button key={f.key || "all"} onClick={() => setClaimStatus(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${claimStatus === f.key ? "bg-[#1f296a]! text-white border-[#1f296a]" : "bg-white! text-gray-600 border-gray-300"}`}>{f.label}</button>
            ))}
            {/* inside Copyright Request the decision is one tab away; on its own (old route) the page links to the claims page */}
            {onOpenRequests
              ? <button type="button" onClick={onOpenRequests} className="ml-auto text-sm text-[#1f296a] underline">Review and decide on the Requests tab</button>
              : <Link to="/pas/copyright-claims" className="ml-auto text-sm text-[#1f296a] underline">Review and decide on the Copyright Claims page</Link>}
          </div>
          {claims.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{claims.error}</div>}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 bg-gray-50"><tr><th className="p-3">Claim</th><th className="p-3">Complaint id</th><th className="p-3">Advertiser named</th><th className="p-3">Sent by</th><th className="p-3">Received</th><th className="p-3">Decision</th><th className="p-3">After accept</th></tr></thead>
              <tbody>
                {claims.items.map((c) => (
                  <tr key={c.complaintId} className="border-t border-gray-100 align-top">
                    <td className="p-3 font-mono text-xs">{c.reference}</td>
                    <td className="p-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                      <span title={c.complaintId}>{c.complaintId.slice(0, 8)}…</span>
                      {c.status === "accepted" && <button type="button" onClick={() => { setFollowed({ complaintId: c.complaintId, reference: c.reference, name: c.name }); setTab("blocklist"); }} className="ml-2 font-sans text-[#1f296a] underline">Follow</button>}
                    </td>
                    <td className="p-3 break-words">{c.name}</td>
                    <td className="p-3 text-gray-600">{c.organization || "—"}</td>
                    <td className="p-3 text-gray-500">{fmtDate(c.receivedAt)}</td>
                    <td className="p-3"><Badge cls={CLAIM_STATUS[c.status]}>{c.status === "pending" ? "Waiting" : c.status}</Badge>{c.decidedBy && <div className="text-xs text-gray-400 mt-1">{c.decidedBy} · {fmtDate(c.decidedAt)}</div>}</td>
                    <td className="p-3">{c.status === "accepted" ? <Badge cls={(PROCESSING[c.processingStatus] || PROCESSING.none)[1]}>{(PROCESSING[c.processingStatus] || PROCESSING.none)[0]}</Badge> : "—"}</td>
                  </tr>
                ))}
                {!claims.loading && !claims.items.length && !claims.error && <tr><td className="p-4 text-gray-500" colSpan={7}>No claim requests.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager state={claims} onPage={(c, d) => loadClaims(false, c, d)} />
        </section>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-label={open.kind === "run" ? "Run log" : open.kind === "audit" ? "Audit findings" : "Job results"}>
          <div className="bg-white w-full max-w-3xl h-full overflow-y-auto p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#1f296a]">{open.kind === "run" ? "Takedown run log" : open.kind === "audit" ? "Audit findings" : `Hash job #${open.id}`}</h2>
                <div className="text-xs text-gray-500 font-mono break-all">{open.network} · {open.id}</div>
              </div>
              <button onClick={() => setOpen(null)} aria-label="Close" className="p-2 rounded-lg hover:bg-gray-100!"><FiX /></button>
            </div>
            {log.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-sm">{log.error}</div>}

            {open.kind === "run" && log.data?.run && (
              <>
                <div className="flex gap-2 items-center flex-wrap text-sm">
                  <GroupBadge group={log.data.run.group} status={log.data.run.status} />
                  {log.data.run.mode === "dry_run" && <Badge>dry run: deleted nothing</Badge>}
                  <span>planned {log.data.run.itemsPlanned}</span><span className="text-green-700">done {log.data.run.itemsSucceeded}</span><span className="text-rose-700">failed {log.data.run.itemsFailed}</span>
                  <span className="text-gray-500">operator {log.data.run.operator || "—"}</span>
                  <button type="button" onClick={() => openAuditOfRun(log.data.run)} className="ml-auto px-3 py-1.5 rounded-lg border border-gray-300 bg-white! text-xs">Open audit</button>
                </div>
                {log.data.run.details && <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs whitespace-pre-wrap break-words">{log.data.run.details}</pre>}
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(log.data.steps.bySystem).map(([system, v]) => (
                    <button key={system} onClick={() => setStepSystem(stepSystem === system ? "" : system)} className={`px-3 py-1.5 rounded-lg border text-xs ${stepSystem === system ? "bg-[#1f296a]! text-white border-[#1f296a]" : "bg-white! border-gray-300"}`}>
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
                          <td className="p-2 break-all min-w-40"><StepTarget s={s} />{s.targetUrl ? <div className="text-gray-400">{s.targetUrl}</div> : null}</td>
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

            {open.kind === "audit" && log.data?.audit && (
              <>
                <div className="flex gap-2 items-center flex-wrap text-sm">
                  <Badge cls={AUDIT_STATUS_META[log.data.audit.status]}>{log.data.audit.status}</Badge>
                  <span>{log.data.audit.auditType}</span>
                  <span>expected {log.data.audit.expectedCount}</span>
                  <span className={log.data.audit.foundCount === log.data.audit.expectedCount ? "text-green-700" : "text-rose-700"}>found {log.data.audit.foundCount}</span>
                  <span className="text-gray-500">{fmtDate(log.data.audit.finishedAt || log.data.audit.startedAt)}</span>
                  {log.data.audit.takedownRunId && <button type="button" onClick={() => openRun({ network: log.data.audit.network, runId: log.data.audit.takedownRunId })} className="ml-auto px-3 py-1.5 rounded-lg border border-gray-300 bg-white! text-xs">Open takedown run</button>}
                </div>
                {log.data.audit.details && <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs whitespace-pre-wrap break-words">{log.data.audit.details}</pre>}
                <div className="flex gap-2 items-center flex-wrap text-xs">
                  {Object.entries(log.data.counts.byStatus).map(([st, n]) => <Badge key={st} cls={AUDIT_STATUS_META[st]}>{st} {n}</Badge>)}
                  <select aria-label="Finding status" value={findingStatus} onChange={(e) => setFindingStatus(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
                    <option value="">All findings</option>
                    {AUDIT_FINDING_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-gray-500 bg-gray-50"><tr><th className="p-2">Ad</th><th className="p-2">Finding</th><th className="p-2">Where</th><th className="p-2">Status</th><th className="p-2">Details</th><th className="p-2">When</th></tr></thead>
                    <tbody>
                      {log.items.map((f) => (
                        <tr key={f.id} className="border-t border-gray-100 align-top">
                          <td className="p-2 break-all min-w-40"><AdRef advertiser={f.advertiser} platformId={f.platformAdId} rowId={f.internalAdId} /></td>
                          <td className="p-2">{f.findingType}</td>
                          <td className="p-2 break-all">{f.system}{f.location ? ` / ${f.location}` : ""}</td>
                          <td className="p-2"><Badge cls={AUDIT_STATUS_META[f.status]}>{f.status}</Badge>{f.resolution && <div className="text-gray-400 mt-1">{f.resolution}</div>}</td>
                          <td className="p-2 break-words max-w-xs text-gray-500">{f.resolutionNote || f.details || "—"}</td>
                          <td className="p-2 text-gray-500">{fmtDate(f.resolvedAt || f.createdAt)}</td>
                        </tr>
                      ))}
                      {!log.loading && !log.items.length && !log.error && <tr><td className="p-3 text-gray-500" colSpan={6}>No findings recorded for this audit.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {open.kind === "job" && log.data?.job && (
              <>
                <div className="flex gap-2 items-center flex-wrap text-sm">
                  <span title={log.data.job.status}><Badge cls={HASH_META[log.data.job.status]}>{hashLabel(log.data.job.status)}</Badge></span>
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
                          <td className="p-2 break-all min-w-40"><AdRef advertiser={r.advertiser || (log.data.job.entryType === "advertiser" ? log.data.job.value : null)} platformId={r.platformAdId} rowId={r.internalAdId} /></td>
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
            <Pager state={log} onPage={(c, d) => loadLog(open, false, c, d)} />
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import Cookies from "js-cookie";
import { FiRefreshCw, FiAlertTriangle, FiLock, FiSettings } from "react-icons/fi";
import CopyrightClaims from "./CopyrightClaims";
import TakedownMonitor from "./TakedownMonitor";

/**
 * Copyright Request: the one menu entry for everything about copyright claims.
 *   Requests    the claims that came in, to review, accept or reject (CopyrightClaims)
 *   Monitoring  what is deleted, waiting, failed and the log of every step, the hash jobs, and the claim requests list (TakedownMonitor)
 *
 * Before showing either, this page asks the backend one cheap question (the claims summary) and says in words what is wrong when the answer is
 * not a yes: the admin server cannot be reached, copyright claims are not set up on it, the person is not a reviewer, or the claims service is
 * down. Each of those has a Retry. When it is a yes, the two tabs show a badge: claims waiting, and delete steps that failed. Only the open
 * tab is on screen, so only it asks the backend for its data.
 *
 * "Follow this claim" on an accepted claim (Requests) switches to Monitoring and shows only what that claim blocked and refused: the claim is
 * handed over as { complaintId, reference, name } and a counter, so pressing it twice for the same claim still re-applies the filter.
 * The "How this page works" box is a plain <details>: closed by default, it explains the flow in a few lines for people new to the page.
 */

const ROOT = import.meta.env.VITE_ADMIN_PANEL_API || "http://localhost:4000/admin-panel";
const CLAIMS = `${ROOT}/copyright-claims`;
const POLL_MS = 60000;
const TABS = [{ key: "requests", label: "Requests" }, { key: "monitoring", label: "Monitoring" }];

/** The short "start here" explanation shown above the tabs (closed by default). Kept in words a first-time tester understands. */
function HowItWorks() {
  return (
    <details className="mx-4 md:mx-6 mt-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-gray-700">
      <summary className="cursor-pointer font-semibold text-[#1f296a]">How this page works (start here)</summary>
      <ol className="list-decimal ml-5 mt-2 space-y-1">
        <li><b>A claim comes in</b> from the copyright form on the website. It waits on the <b>Requests</b> tab with the status <i>Waiting</i>.</li>
        <li><b>You decide.</b> Open the claim, read it, download the files, then press <b>Accept…</b> or <b>Reject…</b>. Only these two buttons (and <b>Retry</b> after an accept) change anything.</li>
        <li><b>Accept blocks the advertiser</b> on every network and starts a <i>hash job</i> that fingerprints its images. Reject blocks nothing.</li>
        <li><b>Background jobs do the rest</b> (when the copyright check is switched on): every 2 minutes new and existing ads are checked against the block list; every 15 minutes the ads that failed are deleted.</li>
        <li><b>Watch it on the Monitoring tab</b> (read only). On an accepted claim, <b>Follow this claim</b> opens Monitoring filtered to that claim.</li>
      </ol>
      <p className="mt-2 text-xs text-gray-500">Every claim has two codes: the short <b>reference</b> (CR-XXXXXX) shown to the claimant, and the long <b>complaint id</b> shown on the claim page, which links the claim to its blocks.</p>
    </details>
  );
}

/** Ask the backend. Resolves { state, pending?, failed? }; state is ok | unreachable | not_configured | forbidden | service_down. A 401 sends the person to the login page. */
async function probeBackend() {
  const token = Cookies.get("token");
  if (!token) {
    window.location.assign("/");
    return { state: "checking" };
  }
  const headers = { Authorization: `Bearer ${token}` };
  let res;
  try {
    res = await fetch(`${CLAIMS}/summary`, { headers });
  } catch {
    return { state: "unreachable" };
  }
  if (res.status === 401) {
    Cookies.remove("token");
    Cookies.remove("nodeToken");
    window.location.assign("/");
    return { state: "checking" };
  }
  if (res.status === 403) return { state: "forbidden" };
  if (res.status === 503) return { state: "not_configured" };
  if (!res.ok) return { state: "service_down" };
  let pending = 0;
  try { pending = Number((await res.json())?.data?.pending) || 0; } catch { /* the badge is just left out */ }
  let failed = 0;
  try {
    const overview = await fetch(`${CLAIMS}/monitor/overview`, { headers });
    if (overview.ok) failed = Number((await overview.json())?.data?.totals?.items?.failed) || 0;
  } catch { /* the badge is just left out */ }
  return { state: "ok", pending, failed };
}

function Panel({ icon, tone, title, children, onRetry }) {
  return (
    <div className="p-4 md:p-6">
      <div className={`rounded-xl border p-6 flex gap-4 items-start ${tone}`}>
        <div className="text-2xl mt-0.5">{icon}</div>
        <div className="space-y-2 text-sm">
          <h2 className="text-base font-bold">{title}</h2>
          {children}
          {onRetry && (
            <button onClick={onRetry} className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-current bg-white/70! text-sm font-semibold">
              <FiRefreshCw /> Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CopyrightRequest() {
  const [tab, setTab] = useState("requests");
  const [probe, setProbe] = useState({ state: "checking" });
  const [checkedAt, setCheckedAt] = useState(null);
  // the claim the Monitoring tab should follow (set by "Follow this claim" on the Requests tab)
  const [follow, setFollow] = useState(null);
  const followClaim = useCallback((claim) => {
    setFollow((prev) => ({ ...claim, nonce: (prev?.nonce || 0) + 1 }));
    setTab("monitoring");
  }, []);

  const check = useCallback(async () => {
    const result = await probeBackend();
    setProbe(result);
    if (result.state !== "checking") setCheckedAt(new Date());
  }, []);

  useEffect(() => { check(); const t = setInterval(check, POLL_MS); return () => clearInterval(t); }, [check]);

  const { state } = probe;
  let blocked = null;
  if (state === "unreachable") {
    blocked = (
      <Panel icon={<FiAlertTriangle />} tone="bg-rose-50 border-rose-200 text-rose-800" title="The admin server cannot be reached" onRetry={check}>
        <p>This page gets its data from the admin backend at <b className="font-mono">{ROOT}</b>, and it did not answer.</p>
        <ul className="list-disc ml-5 space-y-1">
          <li>Start <b>admin_panel_backend</b> (it listens on port 4000 unless PORT is set).</li>
          <li>If it runs somewhere else, set <b className="font-mono">VITE_ADMIN_PANEL_API</b> in the admin panel&apos;s .env to its address.</li>
        </ul>
      </Panel>
    );
  } else if (state === "not_configured") {
    blocked = (
      <Panel icon={<FiSettings />} tone="bg-amber-50 border-amber-200 text-amber-800" title="Copyright claims are not set up on the server yet" onRetry={check}>
        <p>The admin backend is running, but it is missing one of these settings (all three are needed):</p>
        <ul className="list-disc ml-5 space-y-1 font-mono text-xs">
          <li>PAS_NODE_API_URL: the address of the service that stores the claims</li>
          <li>COPYRIGHT_CLAIMS_ADMIN_TOKEN: the same admin token that service holds</li>
          <li>COPYRIGHT_CLAIMS_REVIEWERS: the user names allowed to review (yours must be in it)</li>
        </ul>
      </Panel>
    );
  } else if (state === "forbidden") {
    blocked = (
      <Panel icon={<FiLock />} tone="bg-gray-50 border-gray-200 text-gray-700" title="You do not have access to copyright requests">
        <p>Only the reviewers can see claims, decide on them and watch the takedowns. Ask an administrator to add your user name to the reviewers.</p>
      </Panel>
    );
  } else if (state === "service_down") {
    blocked = (
      <Panel icon={<FiAlertTriangle />} tone="bg-rose-50 border-rose-200 text-rose-800" title="The claims service is not answering" onRetry={check}>
        <p>The admin backend is running, but the service that stores the claims did not answer. Check that it is running and that copyright claims are switched on in it (compliance.claims.enabled).</p>
      </Panel>
    );
  }

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#1f296a]">Copyright Request</h1>
          <p className="text-sm text-gray-500">Claims that came in, what was decided, and what was deleted, is waiting or failed.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {checkedAt && state === "ok" && <span>Checked {checkedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button onClick={check} aria-label="Check the connection" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white! text-gray-700 text-sm hover:bg-gray-50!">
            <FiRefreshCw className={state === "checking" ? "animate-spin" : ""} /> Check
          </button>
        </div>
      </div>

      {state === "checking" && !checkedAt ? (
        <div className="p-6 text-sm text-gray-500">Checking the connection…</div>
      ) : blocked ? blocked : (
        <>
          <HowItWorks />
          <div className="px-4 md:px-6 mt-3 flex items-center gap-2 border-b border-gray-200" role="tablist" aria-label="Copyright request">
            {TABS.map((t) => {
              const badge = state === "ok" ? (t.key === "requests" ? probe.pending : probe.failed) : 0;
              const badgeTitle = t.key === "requests" ? "Claims waiting for a decision" : "Ads whose delete failed";
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-5 py-2 text-sm font-semibold border-b-2 flex items-center gap-2 ${tab === t.key ? "border-[#1f296a] text-[#1f296a]" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                >
                  {t.label}
                  {badge > 0 && <span title={badgeTitle} className={`text-white text-[11px] font-semibold rounded-full min-w-[20px] h-[20px] px-1.5 flex items-center justify-center ${t.key === "requests" ? "bg-rose-600" : "bg-gray-800"}`}>{badge}</span>}
                </button>
              );
            })}
          </div>
          {tab === "requests"
            ? <CopyrightClaims onFollowClaim={followClaim} />
            : <TakedownMonitor follow={follow} onOpenRequests={() => setTab("requests")} />}
        </>
      )}
    </div>
  );
}

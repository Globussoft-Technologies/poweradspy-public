import React, { useEffect, useRef, useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import powerAdSpyLogo from "../assets/poweradspy-logo.webp";

/**
 * Standalone email unsubscribe / resubscribe page.
 *
 * Linked from every report mail's footer:
 *   {APP_URL}/facebook/unsubscribe-page?email=...&sig=...
 * (the signed token rides as `sig`, not `token`, to avoid the auth bootstrap that
 *  treats ?token= as a login JWT and strips the query.)
 * On load it calls the platform API to unsubscribe the address (the user already
 * clicked "Unsubscribe" in the email), shows a friendly confirmation, and offers
 * a one-click Resubscribe. The signed `token` proves the link came from a real
 * mail — a direct/guessed URL is rejected by the API.
 *
 * Public — no auth, no Redux/SDUI. Rendered early in AppWrapper so it never
 * touches the dashboard/network-ad routing.
 *
 * Backend: pas_node_api  POST /api/v1/email/unsubscribe | /resubscribe  { email, token }
 */

const PAS_API_BASE = import.meta.env.VITE_PAS_API_BASE_URL || "";

// Map the link's ?page= to the canonical mail_type the dashboard shows.
function pageToMailType(page) {
  if (page === "dataReport") return "dataReport";
  if (page === "competitor") return "competitorUpdate";
  return null;
}

async function postEmail(pathname, email, token, mailType) {
  const res = await fetch(`${PAS_API_BASE}/api/v1/email/${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, token, mail_type: mailType }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  if (!res.ok || body?.success === false) {
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  return body;
}

// Big circular status icon with a soft gradient ring + glow.
function StatusIcon({ tone = "green", spin = false, children }) {
  const tones = {
    green: "from-emerald-400 to-green-600 shadow-green-500/30",
    red: "from-rose-400 to-red-600 shadow-red-500/30",
    indigo: "from-indigo-400 to-violet-600 shadow-indigo-500/30",
  };
  return (
    <div className="relative mx-auto mb-7 w-24 h-24">
      <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${tones[tone]} blur-xl opacity-40 ${spin ? "" : "animate-pulse"}`} />
      <div className={`relative w-24 h-24 rounded-full bg-gradient-to-br ${tones[tone]} flex items-center justify-center shadow-2xl`}>
        {children}
      </div>
    </div>
  );
}

export default function UnsubscribePage({ email, token, page }) {
  const mailType = pageToMailType(page);
  // status: 'working' | 'done' | 'error' | 'resubscribing' | 'resubscribed'
  const [status, setStatus] = useState(email ? "working" : "error");
  const [errorMsg, setErrorMsg] = useState(email ? "" : "This unsubscribe link is missing an email address.");
  const ranRef = useRef(false);

  const runUnsubscribe = async () => {
    setStatus("working");
    setErrorMsg("");
    try {
      await postEmail("unsubscribe", email, token, mailType);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong. Please try again.");
    }
  };

  useEffect(() => {
    if (!email || ranRef.current) return;
    ranRef.current = true; // guard React 18 StrictMode double-invoke
    runUnsubscribe();
  }, [email]);

  const handleResubscribe = async () => {
    setStatus("resubscribing");
    try {
      await postEmail("resubscribe", email, token, mailType);
      setStatus("resubscribed");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Could not resubscribe. Please try again.");
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-violet-100 px-4 py-12">
      {/* Decorative blurred blobs */}
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-indigo-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-violet-300/30 blur-3xl" />

      <div className="relative w-full max-w-xl bg-white/95 backdrop-blur rounded-[28px] shadow-2xl ring-1 ring-black/5 px-8 py-12 sm:px-14 sm:py-14 text-center">
        {/* Brand logo */}
        <div className="flex items-center justify-center mb-10">
          <img src={powerAdSpyLogo} alt="PowerAdSpy" className="h-14 w-auto object-contain" />
        </div>

        {/* Working */}
        {status === "working" && (
          <>
            <StatusIcon tone="indigo" spin>
              <Loader2 className="w-12 h-12 text-white animate-spin" />
            </StatusIcon>
            <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-slate-800">Processing your request…</h1>
            <p className="text-[15px] text-slate-500 mt-3">Unsubscribing <span className="font-semibold text-slate-700">{email}</span></p>
          </>
        )}

        {/* Unsubscribed */}
        {status === "done" && (
          <>
            <StatusIcon tone="green">
              <Check className="w-12 h-12 text-white" strokeWidth={3} />
            </StatusIcon>
            <h1 className="text-[30px] sm:text-[34px] font-extrabold tracking-tight text-slate-800">You've been unsubscribed</h1>
            <p className="text-[16px] text-slate-500 mt-4 leading-relaxed max-w-md mx-auto">
              <span className="font-semibold text-slate-700">{email}</span> will no longer receive
              PowerAdSpy emails. We're sorry to see you go 👋
            </p>
            <div className="mt-10 pt-8 border-t border-slate-100">
              <p className="text-[15px] text-slate-500 mb-4">Changed your mind?</p>
              <button
                onClick={handleResubscribe}
                className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-2xl text-white text-[16px] font-bold bg-gradient-to-r from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.03] hover:shadow-xl active:scale-95"
              >
                Resubscribe to emails
              </button>
            </div>
          </>
        )}

        {/* Resubscribing */}
        {status === "resubscribing" && (
          <>
            <StatusIcon tone="indigo" spin>
              <Loader2 className="w-12 h-12 text-white animate-spin" />
            </StatusIcon>
            <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-slate-800">Resubscribing…</h1>
            <p className="text-[15px] text-slate-500 mt-3">{email}</p>
          </>
        )}

        {/* Resubscribed */}
        {status === "resubscribed" && (
          <>
            <StatusIcon tone="green">
              <Check className="w-12 h-12 text-white" strokeWidth={3} />
            </StatusIcon>
            <h1 className="text-[30px] sm:text-[34px] font-extrabold tracking-tight text-slate-800">Welcome back! 🎉</h1>
            <p className="text-[16px] text-slate-500 mt-4 leading-relaxed max-w-md mx-auto">
              <span className="font-semibold text-slate-700">{email}</span> is subscribed again and
              will keep receiving PowerAdSpy updates.
            </p>
          </>
        )}

        {/* Error */}
        {status === "error" && (
          <>
            <StatusIcon tone="red">
              <X className="w-12 h-12 text-white" strokeWidth={3} />
            </StatusIcon>
            <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-slate-800">Something went wrong</h1>
            <p className="text-[15px] text-slate-500 mt-4 max-w-md mx-auto">{errorMsg}</p>
            {email && (
              <button
                onClick={runUnsubscribe}
                className="mt-8 inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-2xl text-white text-[16px] font-bold bg-gradient-to-r from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.03] hover:shadow-xl active:scale-95"
              >
                Try again
              </button>
            )}
          </>
        )}

        <p className="text-[12px] text-slate-400 mt-12">© {new Date().getFullYear()} PowerAdSpy · All rights reserved</p>
      </div>
    </div>
  );
}

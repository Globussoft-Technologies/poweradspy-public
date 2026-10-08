import React, { useEffect, useState } from "react";
import { Share, PlusSquare, X } from "lucide-react";
import { isInstalledMobileNow } from "../../hooks/useInstalledMobile";

/**
 * InstallAppPrompt — "Install PowerAdSpy" banner for phone browsers.
 *
 * - Chrome / Edge / Samsung Internet / Opera (Android): one-tap Install via the
 *   browser's deferred `beforeinstallprompt` event.
 * - iPhone / iPad (Safari, and Chrome/Edge on iOS 16.4+): there is no install
 *   API, so it shows the Share → "Add to Home Screen" steps instead.
 * - Hidden on desktop, inside the installed app, on Firefox (product decision),
 *   and for 7 days after "Not now".
 */

// Opt-in: the banner shows on the website (phone browsers), so it stays off
// until VITE_ENABLE_PWA_INSTALL_PROMPT=true is set in the deploy's .env.
const ENABLED = import.meta.env.VITE_ENABLE_PWA_INSTALL_PROMPT === "true";

const DISMISS_KEY = "pas.installPrompt.dismissedAt";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

// Captured at module load (before React mounts) so an early event isn't missed.
let deferredPrompt = null;
const listeners = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own banner instead of the mini-infobar
    deferredPrompt = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

const ua = () => (typeof navigator !== "undefined" ? navigator.userAgent || "" : "");
const isFirefox = () => /Firefox|FxiOS/i.test(ua());
const isIOS = () =>
  /iPhone|iPad|iPod/i.test(ua()) ||
  // iPadOS 13+ reports a desktop Mac UA; touch support gives it away.
  (/Macintosh/i.test(ua()) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
const isPhoneWidth = () =>
  typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator?.standalone === true);

const recentlyDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
};

const InstallAppPrompt = () => {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(recentlyDismissed);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.add(rerender);
    // Small delay so the banner doesn't compete with the first paint.
    const t = setTimeout(() => setReady(true), 2500);
    return () => {
      listeners.delete(rerender);
      clearTimeout(t);
    };
  }, []);

  const ios = isIOS();
  // iOS has no install API — always show the Share → Add to Home Screen steps.
  const canPrompt = !!deferredPrompt && !ios;
  const visible =
    ENABLED && ready && !hidden && !isFirefox() && isPhoneWidth() && !isStandalone() && !isInstalledMobileNow() &&
    (canPrompt || ios);

  // The Freshchat launcher sits in the same corner and covered the Install
  // button; index.css hides it while this class is on <body>.
  useEffect(() => {
    document.body.classList.toggle("pwa-install-open", visible);
    return () => document.body.classList.remove("pwa-install-open");
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage blocked */ }
    setHidden(true);
  };

  const install = async () => {
    const e = deferredPrompt;
    if (!e) return;
    deferredPrompt = null;
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice?.outcome !== "accepted") dismiss();
      else setHidden(true);
    } catch {
      setHidden(true);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Install PowerAdSpy"
      className="fixed inset-x-3 z-[70] rounded-2xl border border-theme-border bg-theme-card p-3 shadow-2xl"
      style={{ bottom: "calc(12px + env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl border border-theme-border" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-theme-text">Install PowerAdSpy</p>
          {canPrompt ? (
            <p className="mt-0.5 text-xs text-theme-text-muted">
              Get the app on your home screen — opens full-screen, built for your phone.
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-theme-text-muted">
              Tap <Share size={13} className="inline -mt-0.5 text-[#3762c1]" /> <b>Share</b>, then{" "}
              <PlusSquare size={13} className="inline -mt-0.5 text-[#3762c1]" /> <b>Add to Home Screen</b>.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-theme-text-muted"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-theme-text-muted"
        >
          Not now
        </button>
        {canPrompt && (
          <button
            type="button"
            onClick={install}
            className="rounded-lg bg-[#335296] px-4 py-2 text-xs font-bold text-white"
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
};

export default InstallAppPrompt;

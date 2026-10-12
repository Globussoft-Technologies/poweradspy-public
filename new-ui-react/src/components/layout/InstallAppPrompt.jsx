import React, { useEffect, useState } from "react";
import { Share, X, Download, MoreVertical } from "lucide-react";
import { isInstalledMobileNow } from "../../hooks/useInstalledMobile";

/**
 * InstallAppPrompt — "Install PowerAdSpy" banner for phone browsers, plus
 * InstallIconButton, the download icon in the header that opens it on demand.
 *
 * - Chrome / Edge / Samsung Internet / Opera (Android): one-tap Install via the
 *   browser's deferred `beforeinstallprompt` event.
 * - iPhone / iPad (Safari, and Chrome/Edge/Firefox on iOS 16.4+): there is no
 *   install API, so it shows the Share → "Add to Home Screen" steps instead.
 *   Other iOS browsers before 16.4 can't add to the home screen: it asks to
 *   open the page in Safari.
 * - Firefox (Android): no install event either, so it shows the menu steps.
 * - Android without a ready install event: the browser-menu steps.
 * - In-app browsers (Instagram, Facebook, WhatsApp…) can't install: it asks to
 *   open the page in Chrome or Safari.
 * - Hidden on desktop and inside the installed app; the automatic popup also
 *   stays away for a day after ✕.
 *
 * Shown as one small card (icon, one-line hint, Install button when the
 * browser can install in one tap, ✕).
 */

// On by default for phone-browser visitors (popup + header icon). Set
// VITE_ENABLE_PWA_INSTALL_PROMPT=false in the deploy's .env to switch both off.
const ENABLED = import.meta.env.VITE_ENABLE_PWA_INSTALL_PROMPT !== "false";

// v2: earlier dismissals (7-day snooze, or a stray tap on the backdrop) don't carry over.
const DISMISS_KEY = "pas.installPrompt.dismissedAt.v2";
// ✕ hides the automatic popup for a day (the header icon stays).
const DISMISS_MS = 24 * 60 * 60 * 1000;

// Captured at module load (before React mounts) so an early event isn't missed.
let deferredPrompt = null;
// True while the card is open because the header icon was tapped.
let openedFromIcon = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own banner instead of the mini-infobar
    deferredPrompt = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    openedFromIcon = false;
    notify();
  });
}

const ua = () => (typeof navigator !== "undefined" ? navigator.userAgent || "" : "");
const isFirefox = () => /Firefox|FxiOS/i.test(ua());
const isIOS = () =>
  /iPhone|iPad|iPod/i.test(ua()) ||
  // iPadOS 13+ reports a desktop Mac UA; touch support gives it away.
  (/Macintosh/i.test(ua()) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
const isInAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|MicroMessenger/i.test(ua());
// Chrome / Firefox / Edge / Opera on iOS (all WebKit underneath).
const isIOSOtherBrowser = () => /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua());
// Other iOS browsers gained "Add to Home Screen" in iOS 16.4; before that only
// Safari could do it.
const iosOtherBrowserCanInstall = () => {
  const m = ua().match(/OS (\d+)_(\d+)/);
  if (!m) return true; // iPadOS desktop UA: no version → assume a current iPadOS
  const major = Number(m[1]), minor = Number(m[2]);
  return major > 16 || (major === 16 && minor >= 4);
};
const isPhoneWidth = () =>
  typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;
const isStandalone = () =>
  typeof window !== "undefined" &&
  (["standalone", "fullscreen", "minimal-ui"].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches) ||
    window.navigator?.standalone === true);

// Phone browser where installing makes sense (not desktop, not already the app).
const isInstallablePhoneBrowser = () =>
  ENABLED && isPhoneWidth() && !isStandalone() && !isInstalledMobileNow();

const recentlyDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
};

const useInstallState = () => {
  const [, force] = useState(0);
  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.add(rerender);
    return () => listeners.delete(rerender);
  }, []);
};

// Shows the browser's own install dialog. Resolves true once it was shown.
const promptInstall = async () => {
  const e = deferredPrompt;
  if (!e) return false;
  deferredPrompt = null;
  notify();
  try {
    await e.prompt();
    await e.userChoice;
  } catch { /* dialog unavailable */ }
  return true;
};

/** Header download icon (phone browsers only). */
export const InstallIconButton = ({ className = "" }) => {
  useInstallState();
  if (!isInstallablePhoneBrowser()) return null;

  const onTap = async () => {
    // Android with a ready install event: straight to the install dialog.
    if (deferredPrompt && !isIOS() && !isInAppBrowser()) {
      await promptInstall();
      return;
    }
    openedFromIcon = true;
    notify();
  };

  return (
    <button
      type="button"
      onClick={onTap}
      title="Install app"
      aria-label="Install PowerAdSpy app"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#3762c1] transition-colors hover:bg-theme-text/[0.08] active:scale-95 ${className}`}
    >
      <Download size={19} strokeWidth={2.2} />
    </button>
  );
};

const InstallAppPrompt = () => {
  useInstallState();
  const [hidden, setHidden] = useState(recentlyDismissed);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Small delay so the banner doesn't compete with the first paint.
    const t = setTimeout(() => setReady(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const ios = isIOS();
  const inApp = isInAppBrowser();
  // iOS has no install API — always show the Share → Add to Home Screen steps.
  const canPrompt = !!deferredPrompt && !ios && !inApp;
  // Firefox on Android never fires the install event, so its menu steps show
  // automatically too (Chromium browsers wait for the event, which also tells
  // us the app isn't installed yet).
  const firefoxAndroid = isFirefox() && !ios && !inApp;
  const auto = ready && !hidden && (canPrompt || (ios && !inApp) || firefoxAndroid);
  const visible = isInstallablePhoneBrowser() && (openedFromIcon || auto);

  // The Freshchat launcher sits in the same corner and covered the Install
  // button; index.css hides it while this class is on <body>.
  useEffect(() => {
    document.body.classList.toggle("pwa-install-open", visible);
    return () => document.body.classList.remove("pwa-install-open");
  }, [visible]);

  if (!visible) return null;

  const close = () => {
    openedFromIcon = false;
    setHidden(true);
    notify();
  };

  // ✕ on the automatic popup snoozes it; closing the card opened from the
  // icon doesn't (the icon stays available either way).
  const dismiss = () => {
    if (!openedFromIcon) {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage blocked */ }
    }
    close();
  };

  const install = async () => {
    await promptInstall();
    close();
  };

  // Inline icon used inside the one-line hint.
  const chip = (Icon) => (
    <span className="mx-0.5 inline-flex h-6 w-6 -translate-y-px items-center justify-center rounded-md border border-theme-border bg-theme-bg align-middle text-[#335296] dark:text-[#8fb0ff]">
      <Icon size={14} strokeWidth={2.2} />
    </span>
  );
  const strong = (text) => <b className="text-theme-text">{text}</b>;

  // One line that says what to do. iOS has no install API; Chrome / Firefox /
  // Edge on iOS keep Share in their menu, and before iOS 16.4 they can't add to
  // the home screen at all, so the card points to Safari.
  let hint;
  if (inApp) {
    hint = <>Open this page in {strong(ios ? "Safari" : "Chrome")} to install</>;
  } else if (ios) {
    hint = !isIOSOtherBrowser()
      ? <>Tap {chip(Share)} then {strong("Add to Home Screen")}</>
      : iosOtherBrowserCanInstall()
        ? <>Tap {chip(Share)} (or menu → Share) then {strong("Add to Home Screen")}</>
        : <>Open this page in {strong("Safari")} to add it to your Home Screen</>;
  } else if (canPrompt) {
    hint = "Quick access from your home screen";
  } else {
    hint = <>Tap {chip(MoreVertical)} then {strong("Install app")}</>;
  }

  // A small card above the bottom edge: app icon, name + one-line hint, an
  // Install button when the browser can install in one tap, and ✕.
  return (
    <div
      role="dialog"
      aria-label="Install PowerAdSpy"
      className="fixed inset-x-3 z-[70] flex items-center gap-3 rounded-2xl border border-theme-border bg-theme-card p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300"
      style={{ bottom: "calc(12px + env(safe-area-inset-bottom))" }}
    >
      <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl border border-theme-border" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-theme-text">Install PowerAdSpy</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-theme-text-muted">{hint}</p>
      </div>
      {canPrompt && (
        <button
          type="button"
          onClick={install}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#335296] px-4 text-[13.5px] font-bold transition-transform active:scale-95"
          // Inline: the light theme remaps Tailwind's white text classes to dark.
          style={{ color: "#ffffff" }}
        >
          <Download size={15} strokeWidth={2.4} />
          Install
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Close"
        className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-theme-text-muted active:bg-theme-text/[0.06]"
      >
        <X size={18} />
      </button>
    </div>
  );
};

export default InstallAppPrompt;

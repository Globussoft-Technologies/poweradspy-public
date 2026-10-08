import { useEffect, useState } from 'react';

// "Installed phone app" = launched from the home-screen icon AND phone-sized.
// Standalone is reported via the display-mode media query (Chrome, Edge,
// Samsung Internet, Opera, newer iOS) or navigator.standalone (iOS Safari,
// including older versions without display-mode support).
//
// KEEP IN SYNC with the inline script in index.html, which applies the same
// check before first paint and toggles the `pwa-mobile` class on <html> that
// the `pwa:` Tailwind variant and the index.css phone rules key off.
export const PWA_MOBILE_CLASS = 'pwa-mobile';
const PHONE_QUERY = '(max-width: 767px)';
const STANDALONE_QUERY = '(display-mode: standalone)';

const mq = (query) =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(query).matches;

export const isInstalledMobileNow = () =>
  typeof window !== 'undefined' &&
  (mq(STANDALONE_QUERY) || window.navigator?.standalone === true) &&
  (typeof window.matchMedia === 'function' ? mq(PHONE_QUERY) : window.innerWidth < 768);

export function useInstalledMobile() {
  const [isInstalledMobile, setIsInstalledMobile] = useState(isInstalledMobileNow);

  useEffect(() => {
    const update = () => {
      const next = isInstalledMobileNow();
      // Keep the CSS hook in step with JS (e.g. rotation / resize).
      document.documentElement.classList.toggle(PWA_MOBILE_CLASS, next);
      setIsInstalledMobile(next);
    };
    update();
    window.addEventListener('resize', update);
    const standalone = typeof window.matchMedia === 'function'
      ? window.matchMedia(STANDALONE_QUERY)
      : null;
    standalone?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      standalone?.removeEventListener?.('change', update);
    };
  }, []);

  return isInstalledMobile;
}

// Global 401 safety net.
//
// Individual API helpers in services/api.js already redirect on 401, but not every
// fetch in the app goes through them (e.g. component-local fetch clients). This
// patches window.fetch ONCE so that ANY 401 from one of our own backends triggers
// the same logout→login redirect (handle401). Third-party 401s (fonts, Google,
// media hosts) are ignored so an unrelated 401 can't log the user out.

import { handle401 } from '../services/api';

const OUR_API_BASES = [
  import.meta.env.VITE_PAS_API_BASE_URL,   // PAS backend (auth, trends, etc.)
  import.meta.env.VITE_NODE_API_URL,       // competitor-analysis backend
]
  .filter(Boolean)
  .map((b) => String(b).replace(/\/$/, ''));

function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && 'url' in input) return input.url; // Request
  return String(input || ''); // URL object → href
}

// A 401 should redirect only when it came from one of OUR APIs: a same-origin
// request (relative URL or our own host) or one of the configured API base URLs.
function isOurApi(url) {
  try {
    if (!url) return false;
    if (url.startsWith('/')) return true; // relative → same origin
    if (OUR_API_BASES.some((b) => url.startsWith(b))) return true;
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

let installed = false;
export function installAuthFetchInterceptor() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await originalFetch(input, init);
    // Only inspect the status — never read the body (that would consume the
    // single-use stream the caller still needs).
    try {
      if (res && res.status === 401 && isOurApi(urlOf(input))) handle401();
    } catch { /* never break the caller because of the interceptor */ }
    return res;
  };
}

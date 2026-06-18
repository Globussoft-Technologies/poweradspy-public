import { useEffect, useRef } from 'react';

const SNAPSHOT_TAG = '__uiSnapshot';

// When set, the next snapshot write replaces the current history entry instead of
// pushing a new one. Callers use this when they perform a route navigation AND a
// tracked state change in the same action — e.g. drilling from a project's
// Competitor Analytics view into the Dashboard (Recent Activity / Platform / Top
// Country). react-router already pushes one entry for the URL change, so folding
// the snapshot into it keeps a SINGLE browser Back press enough to return,
// instead of leaving a dead same-URL entry that wastes a press.
let coalesceNextWrite = false;
let coalesceTimer = null;
export function coalesceNextHistoryWrite() {
  coalesceNextWrite = true;
  // Self-expire so a stray call (e.g. an action that ends up not changing the
  // snapshot) can't silently swallow a later, unrelated push. The intended write
  // happens within the hook's 250ms debounce and consumes the flag first.
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = setTimeout(() => {
    coalesceNextWrite = false;
    coalesceTimer = null;
  }, 600);
}

/**
 * Option C: browser back button works without visible URL changes.
 * Pushes a tagged history entry on each state change (debounced, same URL).
 * On popstate, if the entry is ours, calls onRestore with the snapshot.
 * Other popstate handlers (modals, router) keep working — they check their own tags.
 */
export function useBrowserHistoryState(snapshot, onRestore) {
  const lastSerializedRef = useRef(null);
  const onRestoreRef = useRef(onRestore);
  const initRef = useRef(true);

  onRestoreRef.current = onRestore;

  useEffect(() => {
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSerializedRef.current) return;

    const t = setTimeout(() => {
      const tagged = { ...snapshot, [SNAPSHOT_TAG]: true };
      if (initRef.current || coalesceNextWrite) {
        // Init: seed the current entry. Coalesce: a route navigation already
        // created the entry for this page, so replace rather than stack a second.
        initRef.current = false;
        coalesceNextWrite = false;
        if (coalesceTimer) {
          clearTimeout(coalesceTimer);
          coalesceTimer = null;
        }
        window.history.replaceState(tagged, '', window.location.href);
      } else {
        window.history.pushState(tagged, '', window.location.href);
      }
      lastSerializedRef.current = serialized;
    }, 250);

    return () => clearTimeout(t);
  }, [snapshot]);

  useEffect(() => {
    const onPop = (e) => {
      const s = e.state;
      if (!s || !s[SNAPSHOT_TAG]) return;
      lastSerializedRef.current = JSON.stringify(
        Object.fromEntries(Object.entries(s).filter(([k]) => k !== SNAPSHOT_TAG))
      );
      onRestoreRef.current?.(s);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}

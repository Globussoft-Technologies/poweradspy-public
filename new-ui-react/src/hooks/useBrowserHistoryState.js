import { useEffect, useRef } from 'react';

const SNAPSHOT_TAG = '__uiSnapshot';

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
      if (initRef.current) {
        initRef.current = false;
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

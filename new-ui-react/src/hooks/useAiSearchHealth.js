import { useEffect, useRef, useState } from 'react';
import { checkAiSearchHealth } from '../services/aiSearchService';

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Polls the AI-search health endpoint and reports whether the feature should be
 * offered. The AI-search toggle is shown ONLY while this returns `available`.
 *
 * - Polls immediately, then every `intervalMs` (default 60s).
 * - Skips polling while the tab is hidden (and re-checks on becoming visible),
 *   so a backgrounded tab doesn't keep hitting the endpoint.
 * - `enabled=false` fully disables polling and forces `available=false` (e.g.
 *   for guests / before login).
 *
 * @param {{ enabled?: boolean, intervalMs?: number }} [opts]
 * @returns {{ available: boolean, checking: boolean, checked: boolean }}
 *   `checked` becomes true once at least one health check has COMPLETED, so
 *   callers can distinguish "not checked yet" from "checked and unavailable".
 */
export function useAiSearchHealth({ enabled = true, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      setAvailable(false);
      return undefined;
    }

    let cancelled = false;
    let controller = null;

    const runCheck = async () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      setChecking(true);
      try {
        const res = await checkAiSearchHealth({ signal: controller.signal });
        if (!cancelled) setAvailable(!!res?.ok);
      } catch {
        if (!cancelled) setAvailable(false);
      } finally {
        if (!cancelled) { setChecking(false); setChecked(true); }
      }
    };

    runCheck();
    timerRef.current = setInterval(runCheck, intervalMs);

    const onVisibility = () => { if (document.visibilityState === 'visible') runCheck(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);

  return { available, checking, checked };
}

export default useAiSearchHealth;

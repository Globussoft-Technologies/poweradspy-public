import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { getImageGenCredits, getImageGenAccess, syncImageGenCredits } from '../services/api';

const ImageGenCreditsContext = createContext(null);

// Last known { enabled, balance } per user, so the header pill paints instantly
// on reload instead of waiting for two network calls. Always replaced by the
// live answer a moment later — it is a display hint, never trusted for gating.
const CACHE_PREFIX = 'pas.imagegen.credits.';
// Coming back to the tab re-syncs with aMember (catches a top-up activated in
// aMember admin / another tab) — at most once per this many ms.
const FOCUS_SYNC_MIN_MS = 30_000;

function readCache(userId) {
  if (!userId) return null;
  try { return JSON.parse(window.localStorage.getItem(CACHE_PREFIX + userId) || 'null'); } catch { return null; }
}
function writeCache(userId, value) {
  if (!userId) return;
  try { window.localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(value)); } catch { /* private mode etc. */ }
}

/**
 * ImageGenCreditsProvider — AI Recreate access + global credits balance.
 *
 * `enabled` is the single frontend switch for the whole feature set (Recreate
 * buttons, MySpace, Profile, credits pill, imageGen notifications). It comes
 * from GET /api/v1/imageGen/access (config.json imageGen.enabled +
 * imageGen.allowedUserIds). `accessResolved` tells route guards when the live
 * answer has arrived and it's safe to redirect.
 *
 * Load: access check and a fresh aMember credits sync run in parallel (one
 * round-trip instead of two in a row); the cached balance shows meanwhile.
 *
 * Mounted once near the app root so the header indicator, every Recreate
 * button and RecreateModal's optimistic update all share ONE balance.
 */
export function ImageGenCreditsProvider({ children }) {
  const { token, user } = useAuth();
  const userId = user?.user_id ?? user?.id ?? null;
  const [enabled, setEnabled] = useState(() => !!readCache(userId)?.enabled);
  const [accessResolved, setAccessResolved] = useState(false);
  const [balance, setBalance] = useState(() => (readCache(userId)?.enabled ? readCache(userId)?.balance ?? null : null)); // null = not loaded yet (not "0 credits")
  const [loading, setLoading] = useState(false);
  // Full GET /credits payload (plan, cycle/top-up split, quota, dates). Every
  // screen that shows credits reads this one object, so a change anywhere
  // (reserve, refund, top-up, plan change, another tab) shows everywhere at once.
  const [summary, setSummary] = useState(null);
  const lastSyncRef = useRef(0);
  const balanceRef = useRef(balance);
  balanceRef.current = balance;

  const applyCredits = useCallback((res) => {
    const data = res?.data;
    const next = data?.balance;
    if (typeof next === 'number') {
      setBalance(next);
      setSummary(data);
      writeCache(userId, { enabled: true, balance: next });
    }
    return data || null;
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setEnabled(false);
      setAccessResolved(true);
      setBalance(null);
      setSummary(null);
      return undefined;
    }
    const cached = readCache(userId);
    if (cached?.enabled) {
      setEnabled(true);
      if (typeof cached.balance === 'number') setBalance(cached.balance);
    }
    setAccessResolved(false);
    setLoading(true);
    // A user without access gets a 404 from /credits/sync — ignored below.
    const creditsReq = syncImageGenCredits().catch(() => null);
    lastSyncRef.current = Date.now();
    getImageGenAccess()
      .then(async (res) => {
        if (cancelled) return;
        const ok = !!res?.data?.enabled;
        setEnabled(ok);
        if (!ok) { setBalance(null); setSummary(null); writeCache(userId, { enabled: false }); return; }
        const credits = await creditsReq;
        if (!cancelled) applyCredits(credits);
      })
      .catch(() => { if (!cancelled) { setEnabled(false); setBalance(null); } })
      .finally(() => { if (!cancelled) { setAccessResolved(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [token, userId, applyCredits]);

  const refresh = useCallback(async () => {
    if (!token || !enabled) return;
    setLoading(true);
    try {
      return applyCredits(await getImageGenCredits());
    } catch {
      // A failed credits fetch must not break the rest of the app — keep the last value.
      return null;
    } finally {
      setLoading(false);
    }
  }, [token, enabled, applyCredits]);

  /** Like refresh(), but re-reads aMember now (top-up checkout return, etc.). */
  const sync = useCallback(async () => {
    if (!token || !enabled) return null;
    lastSyncRef.current = Date.now();
    try { return applyCredits(await syncImageGenCredits()); } catch { return null; }
  }, [token, enabled, applyCredits]);

  // Another tab changed the balance (it writes the same cache key) → refetch
  // the full summary here too, so open tabs never disagree.
  useEffect(() => {
    if (!token || !enabled || !userId) return undefined;
    const onStorage = (e) => {
      if (e.key !== CACHE_PREFIX + userId || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue)?.balance;
        if (typeof next === 'number' && next !== balanceRef.current) refresh();
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [token, enabled, userId, refresh]);

  // Back to the tab → fresh aMember sync (throttled), so a top-up or plan
  // change made in aMember shows without a reload.
  useEffect(() => {
    if (!token || !enabled) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastSyncRef.current < FOCUS_SYNC_MIN_MS) return;
      lastSyncRef.current = Date.now();
      syncImageGenCredits().then(applyCredits).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [token, enabled, applyCredits]);

  // Optimistic decrement right when a Recreate job is submitted (reserved
  // server-side immediately). Returns the previous balance so a caller can
  // restore it on a submission failure.
  const decrementOptimistic = useCallback((amount = 1) => {
    let prev;
    setBalance((b) => {
      prev = b;
      return typeof b === 'number' ? Math.max(0, b - amount) : b;
    });
    // Keep the shared summary in step so plan/usage numbers move too
    // (plan credits are spent first, then top-up — same order as the server).
    setSummary((sm) => {
      if (!sm || typeof sm.balance !== 'number') return sm;
      const fromCycle = Math.min(amount, Math.max(0, sm.cycle_balance ?? 0));
      return {
        ...sm,
        balance: Math.max(0, sm.balance - amount),
        cycle_balance: Math.max(0, (sm.cycle_balance ?? 0) - fromCycle),
        topup_balance: Math.max(0, (sm.topup_balance ?? 0) - (amount - fromCycle)),
        used_this_cycle: (sm.used_this_cycle ?? 0) + fromCycle,
      };
    });
    return prev;
  }, []);

  const restore = useCallback((prevBalance) => {
    if (typeof prevBalance === 'number') setBalance(prevBalance);
  }, []);

  return (
    <ImageGenCreditsContext.Provider value={{ enabled, accessResolved, balance, summary, loading, refresh, sync, decrementOptimistic, restore }}>
      {children}
    </ImageGenCreditsContext.Provider>
  );
}

export function useImageGenCredits() {
  const ctx = useContext(ImageGenCreditsContext);
  // Outside the provider: feature off, safe no-op defaults instead of crashing.
  if (!ctx) {
    return {
      enabled: false, accessResolved: true, balance: null, loading: false,
      summary: null, refresh: async () => null, sync: async () => null, decrementOptimistic: () => undefined, restore: () => {},
    };
  }
  return ctx;
}

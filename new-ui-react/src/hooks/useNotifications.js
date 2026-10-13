import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchNotifications, markNotificationsRead } from '../services/api';
import { useAuth } from './useAuth';

// Frontend control for how often the primary notifications API is polled.
// VITE_NOTIFY_POLL_SEC (seconds) is the knob in .env — change it to any cadence.
// When unset/invalid, fall back to 60s and let the backend's meta.pollIntervalMs win.
const ENV_POLL_MS = (() => {
  const sec = Number(import.meta.env.VITE_NOTIFY_POLL_SEC);
  return Number.isFinite(sec) && sec >= 1 ? Math.round(sec * 1000) : null;
})();
const POLL_INTERVAL = ENV_POLL_MS ?? 60000; // default 1 min when the env knob is unset
const SHOWN_NOTIFICATIONS_KEY = 'shown_notifications'; // localStorage key for deduplication

/**
 * useNotifications — polls for ad notifications and deduplicates using localStorage.
 */
export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  // Local "All" view — the backend only ever returns unread (is_view=0) items,
  // so this accumulates everything seen this session (read + unread) purely
  // client-side, letting the bell's All/Unread tabs be genuinely different
  // instead of two tabs showing the same list. Capped so it can't grow forever
  // in a long-lived tab.
  const [allNotifications, setAllNotifications] = useState([]);
  const ALL_CAP = 100;
  const [unreadCount, setUnreadCount] = useState(0);
  const [newNotifications, setNewNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  // Server-driven poll cadence (env-controlled via meta.pollIntervalMs); falls back to default.
  const [pollMs, setPollMs] = useState(POLL_INTERVAL);
  const intervalRef = useRef(null);
  const initialPollUserRef = useRef(null);

  // Get previously shown notification IDs from localStorage
  const getShownNotificationIds = useCallback(() => {
    try {
      const stored = localStorage.getItem(SHOWN_NOTIFICATIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, []);

  // Save shown notification IDs to localStorage
  const saveShownNotificationIds = useCallback((ids) => {
    try {
      localStorage.setItem(SHOWN_NOTIFICATIONS_KEY, JSON.stringify(ids));
    } catch {
      // silently fail if localStorage full
    }
  }, []);

  const poll = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const result = await fetchNotifications();
      const allNotifs = result.data || [];

      // Cadence control: the frontend .env knob (VITE_NOTIFY_POLL_SEC) wins. Only when
      // it's unset do we adopt the backend's reported meta.pollIntervalMs. The effect
      // below re-arms the interval whenever pollMs changes.
      if (ENV_POLL_MS == null) {
        const serverMs = Number(result.meta?.pollIntervalMs);
        if (Number.isFinite(serverMs) && serverMs >= 1000) {
          setPollMs((prev) => (prev === serverMs ? prev : serverMs));
        }
      }

      // Bell badge + dropdown show ALL unread notifications (server is_view=0).
      // They persist until the user clicks "mark as read" — never auto-cleared.
      setNotifications(allNotifs);
      setUnreadCount(allNotifs.length);

      // Merge into the local "All" accumulator — upsert by id, keep an
      // already-read item's read:true (a freshly (re)fetched id is always
      // unread by definition, since the server only returns unread rows).
      setAllNotifications((prev) => {
        const prevById = new Map(prev.map((n) => [n.id, n]));
        const merged = allNotifs.map((n) => ({ ...n, read: prevById.get(n.id)?.read ?? false }));
        const rest = prev.filter((n) => !allNotifs.some((fresh) => fresh.id === n.id));
        return [...merged, ...rest].slice(0, ALL_CAP);
      });

      // Toast dedup: only notifications we have NOT toasted before are "fresh".
      // This stops the popup from re-firing every poll / on reload, WITHOUT
      // hiding them from the bell.
      const shownIds = getShownNotificationIds();
      const fresh = allNotifs.filter(n => !shownIds.includes(n.id));
      if (fresh.length > 0) {
        setNewNotifications(fresh);
      }
      // Track currently-unread ids as "already shown" (bounded — drops ids once read).
      saveShownNotificationIds(allNotifs.map(n => n.id));
    } catch {
      // silently fail — next poll will retry
    } finally {
      setLoading(false);
    }
  }, [user, getShownNotificationIds, saveShownNotificationIds]);

  // Start polling when user is logged in
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setAllNotifications([]);
      setUnreadCount(0);
      // Clear localStorage when user logs out
      localStorage.removeItem(SHOWN_NOTIFICATIONS_KEY);
      initialPollUserRef.current = null;
      return;
    }

    // Initial fetch for this user only. Updating pollMs re-arms the interval
    // without immediately hitting the endpoint a second time.
    const userKey = user.id ?? user.user_id ?? user.email;
    if (initialPollUserRef.current !== userKey) {
      initialPollUserRef.current = userKey;
      poll();
    }

    // Set up interval at the current (possibly server-driven) cadence. Re-arms when
    // pollMs changes after the server reports its interval.
    intervalRef.current = setInterval(poll, pollMs);

    return () => {
      /* v8 ignore next -- intervalRef is always set earlier in this effect, so the guard's else is defensive */
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user, poll, pollMs]);

  const markAllRead = useCallback(async () => {
    if (notifications.length === 0) return;
    const ids = notifications.map((n) => n.id);
    setNotifications([]);
    setUnreadCount(0);
    setAllNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    const ok = await markNotificationsRead(ids);
    if (!ok) poll();
  }, [notifications, poll]);

  const markRead = useCallback(async (ids) => {
    const ok = await markNotificationsRead(ids);
    if (ok) {
      setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
      setUnreadCount((prev) => Math.max(0, prev - ids.length));
      setAllNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    }
  }, []);

  return { notifications, allNotifications, unreadCount, newNotifications, loading, markAllRead, markRead, refresh: poll };
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchNotifications, markNotificationsRead } from '../services/api';
import { useAuth } from './useAuth';

const POLL_INTERVAL = 30000; // 30 seconds
const SHOWN_NOTIFICATIONS_KEY = 'shown_notifications'; // localStorage key for deduplication

/**
 * useNotifications — polls for ad notifications and deduplicates using localStorage.
 */
export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newNotifications, setNewNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);

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

      // Bell badge + dropdown show ALL unread notifications (server is_view=0).
      // They persist until the user clicks "mark as read" — never auto-cleared.
      setNotifications(allNotifs);
      setUnreadCount(allNotifs.length);

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
      setUnreadCount(0);
      // Clear localStorage when user logs out
      localStorage.removeItem(SHOWN_NOTIFICATIONS_KEY);
      return;
    }

    // Initial fetch
    poll();

    // Set up interval
    intervalRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      /* v8 ignore next -- intervalRef is always set earlier in this effect, so the guard's else is defensive */
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user, poll]);

  const markAllRead = useCallback(async () => {
    if (notifications.length === 0) return;
    const ids = notifications.map((n) => n.id);
    const ok = await markNotificationsRead(ids);
    if (ok) {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [notifications]);

  const markRead = useCallback(async (ids) => {
    const ok = await markNotificationsRead(ids);
    if (ok) {
      setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
      setUnreadCount((prev) => Math.max(0, prev - ids.length));
    }
  }, []);

  return { notifications, unreadCount, newNotifications, loading, markAllRead, markRead, refresh: poll };
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { getImageGenNotifications, markImageGenNotificationsRead } from '../services/api';
import { useAuth } from './useAuth';
import { useImageGenCredits } from './useImageGenCredits';

const POLL_MS = 30000;

/**
 * Header-bell notifications for AI Recreate jobs (succeeded/failed) — a
 * separate feed from useNotifications.js's existing keyword/advertiser/domain
 * search-alert system, merged into the same bell UI by Header.jsx. Kept as
 * its own hook/endpoint rather than folded into that one: the existing
 * system's `type` field is a strict 0/1/2 (keyword/advertiser/domain) enum
 * baked into both the write path and NotifRow's copy, so bolting a 4th,
 * differently-shaped notification onto it would mean rewriting that enum
 * everywhere it's checked — not worth the risk for an unrelated feature.
 */
export function useImageGenNotifications() {
  const { user: authUser } = useAuth();
  // No AI Recreate access → behave exactly like a logged-out user: no polling,
  // no items, nothing in the bell.
  const { enabled } = useImageGenCredits();
  const user = enabled ? authUser : null;
  const [items, setItems] = useState([]); // newest first, as returned by the API
  const [unreadCount, setUnreadCount] = useState(0);
  const [newItems, setNewItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const intervalRef = useRef(null);
  const knownIdsRef = useRef(null);

  const poll = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getImageGenNotifications({ limit: 20 });
      const nextItems = res?.data?.items || [];
      if (knownIdsRef.current) setNewItems(nextItems.filter((item) => !knownIdsRef.current.has(item.id)));
      knownIdsRef.current = new Set(nextItems.map((item) => item.id));
      setItems(nextItems);
      setUnreadCount(res?.data?.unread_count || 0);
      setNextCursor(res?.data?.next_cursor || null);
    } catch {
      // silently fail — next tick retries, same posture as useNotifications.js
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      setNewItems([]);
      setNextCursor(null);
      knownIdsRef.current = null;
      return undefined;
    }
    poll();
    intervalRef.current = setInterval(poll, POLL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [user, poll]);

  const markRead = useCallback(async (ids) => {
    const unreadIds = ids.filter((id) => items.some((n) => n.id === id && !n.read));
    if (!unreadIds.length) return;
    setItems((prev) => prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - unreadIds.length));
    try {
      await markImageGenNotificationsRead(unreadIds);
    } catch {
      // ignore — bell just stays as-is until the next poll reconciles it
    }
  }, [items]);

  const markAllRead = useCallback(() => markRead(items.filter((n) => !n.read).map((n) => n.id)), [items, markRead]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getImageGenNotifications({ limit: 20, cursor: nextCursor });
      const more = res?.data?.items || [];
      setItems((current) => [...current, ...more.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(res?.data?.next_cursor || null);
    } catch { /* the next scroll can retry */ }
    finally { setLoadingMore(false); }
  }, [nextCursor, loadingMore]);

  return { items, unreadCount, newItems, markRead, markAllRead, refresh: poll, loadMore, hasMore: !!nextCursor, loadingMore };
}

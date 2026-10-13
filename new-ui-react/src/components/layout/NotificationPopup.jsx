import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Bell, Globe, RefreshCw, Search, Sparkle, User } from "lucide-react";
import { autoUpdate, flip, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import "./notification-popup.css";
import "../shared/floating-popover.css";

const TYPE_MAP = { 0: { label: "Keyword", icon: Search }, 1: { label: "Advertiser", icon: User }, 2: { label: "Domain", icon: Globe } };

/** TODAY -> "Just now" / "12 min ago" / "3 h ago"; YESTERDAY -> "6:15 PM";
 * EARLIER -> "Oct 10, 6:15 PM". The group header already says which day. */
function relativeTime(value) {
  const date = new Date(value);
  const group = groupLabel(value);
  if (group === "TODAY") {
    const minutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.floor(minutes / 60)} h ago`;
  }
  if (group === "YESTERDAY") return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function groupLabel(value) { const date = new Date(value); const now = new Date(); const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); const days = Math.round((start(now) - start(date)) / 86400000); return days <= 0 ? "TODAY" : days === 1 ? "YESTERDAY" : "EARLIER"; }
function groupItems(items) { const groups = []; items.forEach((item) => { const label = groupLabel(item.created_at); let group = groups.find((entry) => entry.label === label); if (!group) { group = { label, items: [] }; groups.push(group); } group.items.push(item); }); return groups; }

function RecreateThumb({ notif }) {
  const success = notif.status === "succeeded"; const primary = notif.data?.image_url; const fallback = notif.data?.advertiser_avatar; const [image, setImage] = useState(primary || fallback || null);
  useEffect(() => setImage(primary || fallback || null), [primary, fallback]);
  if (success && image) return <div className="np-th"><img src={image} alt="" loading="lazy" decoding="async" onError={() => setImage((current) => current !== fallback ? fallback || null : null)}/><span className="np-ai-tag"><Sparkle size={10} fill="currentColor"/></span></div>;
  return <div className={`np-th ${success ? "sys" : "fail"}`}>{success ? <Sparkle size={20} fill="currentColor"/> : <AlertCircle size={20}/>}</div>;
}
function RecreateRow({ notif, onOpen, onTryAgain }) {
  const success = notif.status === "succeeded"; const advertiser = notif.data?.advertiser || `${String(notif.data?.network || "Source").replace(/^./, (c) => c.toUpperCase())} ad`;
  return <div className={`np-it ${!notif.read ? "unread" : ""}`} role="button" tabIndex={0} onClick={() => onOpen?.(notif)} onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onOpen?.(notif); } }}>
    <RecreateThumb notif={notif}/>
    <div className="np-body">
      <div className="np-title">{success ? "Your ad is ready" : <>Generation failed <span className="np-pill">Credit refunded</span></>}</div>
      <div className="np-subrow">
        <div className="np-sub" title={advertiser}>{advertiser} · {relativeTime(notif.created_at)}</div>
        {success ? null : <button className="np-action" onClick={(event) => { event.stopPropagation(); onTryAgain?.(notif); }}><RefreshCw size={12}/> Try again</button>}
      </div>
    </div>
    {!notif.read ? <span className="np-unread-dot"/> : null}
  </div>;
}
function KeywordRow({ notif, onOpen }) { const info = TYPE_MAP[notif.type] || TYPE_MAP[0]; const Icon = info.icon; return <div className={`np-it ${!notif.read ? "unread" : ""}`} role="button" tabIndex={0} onClick={() => onOpen?.(notif)} onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) onOpen?.(notif); }}><div className="np-th sys"><Icon size={20}/></div><div className="np-body"><div className="np-title">New ads found for “{notif.keyword}”</div><div className="np-sub">{info.label} · {relativeTime(notif.created_at)}</div></div>{!notif.read ? <span className="np-unread-dot"/> : null}</div>; }

export default function NotificationPopup({ notifications, allNotifications = [], onMarkAllRead, onNotificationClick, onClose, imageGenNotifications = [], onImageGenNotificationClick, onImageGenTryAgain, anchorRef, onLoadMore, hasMore, loadingMore }) {
  const [tab, setTab] = useState("all"); const unreadCount = notifications.length + imageGenNotifications.filter((item) => !item.read).length;
  const { refs, floatingStyles, context, isPositioned, x, y } = useFloating({ open: true, onOpenChange: (open) => { if (!open) onClose?.(); }, placement: "bottom-end", strategy: "fixed", whileElementsMounted: autoUpdate, middleware: [offset(10), flip({ padding: 12 }), shift({ padding: 12 })] });
  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true }); const { getFloatingProps } = useInteractions([dismiss]);
  useEffect(() => { if (anchorRef?.current) refs.setReference(anchorRef.current); }, [anchorRef, refs]);
  const positioned = typeof isPositioned === "boolean" ? isPositioned : x != null && y != null;
  const all = useMemo(() => [...allNotifications.map((item) => ({ ...item, kind: "keyword" })), ...imageGenNotifications.map((item) => ({ ...item, kind: "imagegen" }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [allNotifications, imageGenNotifications]);
  const unread = useMemo(() => [...notifications.map((item) => ({ ...item, kind: "keyword" })), ...imageGenNotifications.filter((item) => !item.read).map((item) => ({ ...item, kind: "imagegen" }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [notifications, imageGenNotifications]);
  const source = tab === "unread" ? unread : all; const groups = useMemo(() => groupItems(source), [source]);
  return <FloatingPortal>
    <div ref={refs.setFloating} style={{ ...floatingStyles, visibility: positioned ? "visible" : "hidden" }} {...getFloatingProps({ className: "np" })}>
      <div className={`np-motion floating-popover-motion ${positioned ? "is-positioned" : ""}`}>
      <div className="np-h"><span>Notifications</span>{unreadCount > 0 ? <button onClick={onMarkAllRead}>Mark all as read</button> : null}</div>
      <div className="np-tabs"><button className={`np-tab ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")}>All</button><button className={`np-tab ${tab === "unread" ? "on" : ""}`} onClick={() => setTab("unread")}>Unread{unreadCount ? ` · ${unreadCount}` : ""}</button></div>
      <div className="np-list" onScroll={(event) => { const node = event.currentTarget; if (hasMore && !loadingMore && node.scrollHeight - node.scrollTop - node.clientHeight < 80) onLoadMore?.(); }}>
        {source.length ? groups.map((group) => <React.Fragment key={group.label}><div className="np-grp">{group.label}</div>{group.items.map((notif) => notif.kind === "imagegen" ? <RecreateRow key={`ig_${notif.id}`} notif={notif} onOpen={onImageGenNotificationClick} onTryAgain={onImageGenTryAgain}/> : <KeywordRow key={notif.id} notif={notif} onOpen={onNotificationClick}/>)}</React.Fragment>) : <div className="np-empty"><Bell size={24}/><span>You're all caught up</span></div>}
        {loadingMore ? <div className="np-more">Loading…</div> : null}
      </div>
      </div>
    </div>
  </FloatingPortal>;
}

import React from "react";
import { Search, User, Globe, CheckCheck, Bell } from "lucide-react";

/**
 * Map keyword request type (0=keyword, 1=advertiser, 2=domain) to a label + icon.
 */
const TYPE_MAP = {
  0: { label: "Keyword", icon: Search, color: "#6b99ff" },
  1: { label: "Advertiser", icon: User, color: "#a78bfa" },
  2: { label: "Domain", icon: Globe, color: "#34d399" },
};

/**
 * Relative time string from a date.
 */
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * NotificationPopup — dropdown list of scraping notifications.
 */
const NotificationPopup = ({ notifications, onMarkAllRead, onClose }) => {
  return (
    <div
      className="group absolute right-0 top-full mt-2 w-80 z-[60] rounded-xl p-[2px] overflow-hidden shadow-2xl"
      style={{ animation: "notifSlideIn 0.2s ease-out" }}
    >
      {/* Spinning neon gradient border — mirrors the ad-card hover treatment */}
      <div className="absolute inset-[-100%] z-0 bg-[conic-gradient(from_0deg,transparent_0_180deg,#335296_240deg,#244a94_300deg,transparent_360deg)] opacity-0 group-hover:opacity-100 animate-[spin_3s_linear_infinite] transition-opacity duration-500 pointer-events-none" />
      <div className="relative z-10 max-h-96 bg-theme-card border border-theme-border group-hover:border-transparent rounded-[10px] overflow-hidden transition-colors duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-theme-text-muted" />
          <span className="text-xs font-bold text-theme-text uppercase tracking-wider">
            Notifications
          </span>
          {notifications.length > 0 && (
            <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 leading-none">
              {notifications.length}
            </span>
          )}
        </div>
        {notifications.length > 0 && (
          <button
            onClick={onMarkAllRead}
            className="flex items-center gap-1 text-[10px] font-semibold text-[#6b99ff] hover:text-[#5a88ee] transition-colors"
          >
            <CheckCheck size={12} />
            Mark all read
          </button>
        )}
      </div>

      {/* Notification List */}
      <div className="overflow-y-auto max-h-80 custom-scrollbar">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4">
            <div className="w-10 h-10 rounded-full bg-theme-text/[0.05] flex items-center justify-center mb-3">
              <Bell size={18} className="text-theme-text-muted" />
            </div>
            <p className="text-xs text-theme-text-muted font-medium">
              No new notifications
            </p>
            <p className="text-[10px] text-theme-text-muted/60 mt-1">
              You'll be notified when new ads are scraped
            </p>
          </div>
        ) : (
          notifications.map((notif) => {
            const typeInfo = TYPE_MAP[notif.type] || TYPE_MAP[0];
            const Icon = typeInfo.icon;
            return (
              <div
                key={notif.id}
                className="flex items-start gap-3 px-4 py-3 hover:bg-theme-text/[0.03] transition-colors border-b border-theme-border/50 last:border-b-0"
              >
                {/* Type icon */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: `${typeInfo.color}15` }}
                >
                  <Icon size={14} style={{ color: typeInfo.color }} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-theme-text leading-tight truncate">
                    New ads found for{" "}
                    <span style={{ color: typeInfo.color }}>
                      "{notif.keyword}"
                    </span>
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{
                        color: typeInfo.color,
                        backgroundColor: `${typeInfo.color}15`,
                      }}
                    >
                      {typeInfo.label}
                    </span>
                    <span className="text-[9px] text-theme-text-muted">
                      {timeAgo(notif.created_at)}
                    </span>
                  </div>
                </div>

                {/* Unread indicator */}
                <div className="w-2 h-2 rounded-full bg-[#6b99ff] shrink-0 mt-2" />
              </div>
            );
          })
        )}
      </div>
      </div>

      {/* Inline animation keyframe */}
      <style>{`
        @keyframes notifSlideIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default NotificationPopup;

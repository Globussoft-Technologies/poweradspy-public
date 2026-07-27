import React from "react";
import { Lock } from "lucide-react";

/**
 * Secure section lock. Restricted data is never rendered into the DOM; the
 * blurred layer is synthetic UI only. The matching API capability remains the
 * authoritative server-side gate.
 */
const PlanLockedSection = ({ allowed, title, onUpgrade, children, className = "", compact = false }) => {
  if (allowed) return children;

  return (
    <div className={`relative ${compact ? "min-h-[92px]" : "min-h-[150px]"} overflow-hidden rounded-2xl border border-theme-border bg-theme-card ${className}`}>
      <div aria-hidden="true" className="absolute inset-0 p-5 blur-md opacity-30 pointer-events-none select-none">
        <div className="h-3 w-32 rounded bg-theme-text/40" />
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="h-16 rounded-xl bg-theme-text/20" />
          <div className="h-16 rounded-xl bg-theme-text/20" />
          <div className="h-16 rounded-xl bg-theme-text/20" />
        </div>
        <div className="mt-4 h-3 w-full rounded bg-theme-text/20" />
        <div className="mt-2 h-3 w-4/5 rounded bg-theme-text/20" />
      </div>
      <div className={`relative z-10 flex ${compact ? "min-h-[92px] flex-row" : "min-h-[150px] flex-col"} items-center justify-center gap-2 px-5 py-4 text-center bg-theme-bg/55 backdrop-blur-[2px]`}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#6b99ff]/15 text-[#6b99ff]">
          <Lock size={16} />
        </span>
        <div className="text-sm font-bold text-theme-text">{title}</div>
        <div className="text-xs text-theme-text-muted">Upgrade your plan to unlock this section.</div>
        <button
          type="button"
          onClick={onUpgrade}
          className="mt-1 rounded-lg bg-[#335296] px-4 py-2 text-xs font-bold text-white hover:bg-[#3f63ad]"
        >
          Upgrade plan
        </button>
      </div>
    </div>
  );
};

export default PlanLockedSection;

import React from 'react';
import { Lock } from 'lucide-react';

// Shown instead of hard-hiding a feature the user's plan doesn't include (PRD FR-17:
// "a locked preview with upgrade CTA, not a hard removal"). Generic — any future
// GA-gated feature can reuse this rather than duplicating the layout.
//
// `flex-1 h-full` matters: this renders as a direct flex sibling of <Sidebar> inside
// a `flex flex-1 overflow-hidden` row (App.jsx) with no wrapper telling it to grow —
// without these, the component only takes its content's width/height and sits
// squished next to the sidebar instead of filling + centering in the remaining page.
const LockedFeaturePreview = ({ title, description, onUpgrade }) => (
  <div className="relative flex-1 h-full overflow-hidden flex items-center justify-center">
    {/* Blurred "sample data" background — an abstract, generic dashboard mockup so
        the locked state doesn't read as a blank/broken page. Not real data, purely
        decorative (aria-hidden). */}
    <div aria-hidden="true" className="absolute inset-0 p-10 md:p-16 flex flex-col gap-8 blur-md opacity-25 pointer-events-none select-none">
      <div className="flex items-end gap-3 h-40">
        {[55, 85, 40, 70, 95, 60, 80].map((h, i) => (
          <div key={i} className="flex-1 rounded-t-lg bg-theme-accent" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-theme-surface border border-theme-border" />
        ))}
      </div>
    </div>

    {/* Foreground — lock + copy + CTA, centered over the blurred backdrop */}
    <div className="relative z-10 flex flex-col items-center justify-center gap-4 text-center px-8 py-10 mx-4 max-w-md bg-theme-bg/85 backdrop-blur-sm rounded-2xl border border-theme-border shadow-2xl">
      <div className="w-14 h-14 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center">
        <Lock size={24} className="text-theme-text-muted" />
      </div>
      <h3 className="text-lg font-bold text-theme-text">{title}</h3>
      <p className="text-theme-text-secondary text-sm">{description}</p>
      <button
        onClick={onUpgrade}
        className="bg-gradient-to-r from-[#3762c1] to-[#335296] hover:from-[#4374e0] hover:to-[#3e64b8] text-white rounded-full text-sm px-6 py-2.5 font-semibold shadow-lg shadow-blue-900/20 transition-all active:scale-95"
      >
        Upgrade to unlock
      </button>
    </div>
  </div>
);

export default LockedFeaturePreview;

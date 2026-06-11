import React from "react";

/**
 * ToggleSwitchFilter — Simple boolean on/off toggle.
 * Used for Meta Ads Library, Verified accounts, Search by Image, etc.
 */
const ToggleSwitchFilter = ({ label, value, onChange, disabled = false }) => {
  const isOn = !!value;

  if (disabled) {
    return (
      <div className="px-3 py-2 opacity-35 cursor-not-allowed" title="Not available for this platform">
        <div className="w-full flex items-center justify-between">
          <span className="text-[14px] text-theme-text-muted capitalize tracking-wider">
            {label}
          </span>
          <div className="relative w-6 h-3 2xl:w-8 2xl:h-4 rounded-full bg-[#333]">
            <div className="absolute top-0.5 w-2.5 h-2.5 2xl:w-3 2xl:h-3 rounded-full -translate-y-[1px] 2xl:translate-y-0 bg-white/40 translate-x-0.5 2xl:translate-x-1" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <button
        onClick={() => onChange(!isOn)}
        className="w-full flex items-center justify-between group"
      >
        <span className="text-[14px] text-theme-text-secondary capitalize tracking-wider group-hover:text-theme-text transition-colors">
          {label}
        </span>
        <div
          className={`relative w-6 h-3 2xl:w-8 2xl:h-4 rounded-full transition-colors ${isOn ? "bg-[#335296]" : "bg-[#333]"}`}
        >
          <div
            className={`absolute top-0.5 w-2.5 h-2.5 2xl:w-3 2xl:h-3 rounded-full -translate-y-[1px] 2xl:translate-y-0 bg-white transition-transform ${isOn ? "translate-x-3 2xl:translate-x-4" : "translate-x-0.5 2xl:translate-x-1"}`}
          />
        </div>
      </button>
    </div>
  );
};

export default ToggleSwitchFilter;

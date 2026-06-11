import React from "react";

const RangeFilter = ({ icon, label }) => (
  <div className="px-3 py-1.5 flex items-center justify-between group">
    <div className="flex items-center gap-2">
      <span className="text-theme-text-muted group-hover:text-[#6b99ff] transition-colors">
        {icon}
      </span>
      <span className="text-[10px] font-semibold text-theme-text-secondary uppercase tracking-wider">
        {label}
      </span>
    </div>
    <div className="flex items-center gap-1 w-24">
      <input
        type="number"
        placeholder="Min"
        className="w-full bg-transparent border-b border-[#444] pb-0.5 text-[10px] text-gray-200 outline-none focus:border-[#3759a3]/50 transition-colors placeholder:text-theme-text-muted text-center"
      />
      <span className="text-theme-text-muted text-[9px]">–</span>
      <input
        type="number"
        placeholder="Max"
        className="w-full bg-transparent border-b border-[#444] pb-0.5 text-[10px] text-gray-200 outline-none focus:border-[#3759a3]/50 transition-colors placeholder:text-theme-text-muted text-center"
      />
    </div>
  </div>
);

export default RangeFilter;

import React from "react";

const SectionLabel = ({ label, collapsed = false }) => (
  <div className={`px-3 pt-4 pb-2 text-[16px] font-bold text-theme-text capitalize tracking-wider ${collapsed ? 'hidden h-4' : ''}`}>
    {!collapsed && label}
  </div>
);

export default SectionLabel;

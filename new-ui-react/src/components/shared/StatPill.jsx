import React from 'react';

const StatPill = ({ icon, value, tooltip, tooltipAlign = 'center' }) => (
    <div className="relative group/stat flex items-center gap-1 text-[11px] font-bold text-[#888] justify-center">
        {icon}
        <span>{value}</span>
        {tooltip && (
            <span className={`absolute bottom-full mb-1.5 px-2 py-1 bg-[#222] text-white text-[9px] font-medium rounded-md opacity-0 group-hover/stat:opacity-100 transition-opacity pointer-events-none border border-[#333] w-max max-w-[160px] text-center leading-relaxed ${
                tooltipAlign === 'right' ? 'right-0' :
                tooltipAlign === 'left'  ? 'left-0'  :
                'left-1/2 -translate-x-1/2'
            }`}>
                {tooltip}
            </span>
        )}
    </div>
);

export default StatPill;

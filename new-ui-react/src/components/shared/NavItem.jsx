import React from 'react';

const NavItem = ({ icon, label, active = false, onClick, collapsed = false, badge = null }) => (
    <button
        onClick={onClick}
        className={`w-full flex items-center ${collapsed ? 'justify-center px-1' : 'gap-2.5 px-3'} py-2 rounded-lg text-[14px] font-semibold transition-all ${
            active ? 'bg-theme-text/[0.06] text-theme-text' : 'text-theme-text-muted hover:bg-theme-text/[0.04] hover:text-white/80'
        }`}
        title={collapsed ? label : undefined}
    >
        <span className={active ? 'text-white' : 'text-inherit'}>{icon}</span>
        {!collapsed && <span className="flex-1 text-left">{label}</span>}
        {!collapsed && badge && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                {badge}
            </span>
        )}
    </button>
);

export default NavItem;

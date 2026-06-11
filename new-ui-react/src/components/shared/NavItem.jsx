import React from 'react';

const NavItem = ({ icon, label, active = false, onClick, collapsed = false }) => (
    <button
        onClick={onClick}
        className={`w-full flex items-center ${collapsed ? 'justify-center px-1' : 'gap-2.5 px-3'} py-2 rounded-lg text-[14px] font-semibold transition-all ${
            active ? 'bg-theme-text/[0.06] text-theme-text' : 'text-theme-text-muted hover:bg-theme-text/[0.04] hover:text-white/80'
        }`}
        title={collapsed ? label : undefined}
    >
        <span className={active ? 'text-white' : 'text-inherit'}>{icon}</span>
        {!collapsed && <span>{label}</span>}
    </button>
);

export default NavItem;

import React from 'react';
import CreditsTab from './tabs/CreditsTab';
import NotificationsTab from './tabs/NotificationsTab';

// Account/Billing live in aMember's own member area (the header's "Account"
// link); Team doesn't exist in this app at all.
const TABS = [
  { key: 'credits', label: 'Credits' },
  { key: 'notifications', label: 'Notifications' },
];

export default function ProfilePage({ tab, onNavigateTab, onShowMySpacePage, onShowToast, onUpgrade }) {
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'credits';

  const handleTabKeyDown = (e, idx) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); onNavigateTab?.(TABS[(idx + 1) % TABS.length].key); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); onNavigateTab?.(TABS[(idx - 1 + TABS.length) % TABS.length].key); }
  };

  return (
    <div className="pfl content">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        .pfl{ font-family:"Plus Jakarta Sans", system-ui, sans-serif; font-weight:400; flex:999 1 560px; min-width:0;
              padding:20px 28px 40px; box-sizing:border-box; overflow-y:auto; height:100%;
              scrollbar-width:none; -ms-overflow-style:none; }
        .pfl::-webkit-scrollbar{ width:0; height:0; display:none; }
        .pfl *{ font-family:inherit; box-sizing:border-box; }
        .pfl h1.pt{ margin:0; font-size:22px; font-weight:800; line-height:1.3; letter-spacing:-0.2px; color:var(--ps-text); }
        .pfl .tabs{ display:flex; gap:4px; border-bottom:1px solid var(--ps-border); margin-top:12px; flex-wrap:wrap;
                    overflow-x:auto; overflow-y:hidden; scrollbar-width:none; -ms-overflow-style:none; }
        .pfl .tabs::-webkit-scrollbar{ width:0; height:0; display:none; }
        .pfl .tab{ padding:8px 12px; font-size:13.5px; font-weight:600; color:var(--ps-text-muted); border-bottom:2px solid transparent;
                   margin-bottom:-1px; background:none; border-top:0; border-left:0; border-right:0; cursor:pointer;
                   white-space:nowrap; }
        .pfl .tab:hover{ color:var(--ps-text); }
        .pfl .tab.on{ color:var(--ps-accent); border-bottom-color:var(--ps-accent-strong); font-weight:700; }
        .pfl .lbl{ font-size:11px; font-weight:700; letter-spacing:1px; color:var(--ps-text-subtle); text-transform:uppercase; }
        .pfl .btn{ height:44px; padding:0 18px; border-radius:10px; font-weight:700; font-size:14px; font-family:inherit;
                   display:inline-flex; align-items:center; justify-content:center; gap:8px; box-sizing:border-box; cursor:pointer; }
        .pfl .b1{ border:0; background:var(--ps-btn); color:var(--ps-btn-text); }
        .pfl .b1:disabled{ background:var(--ps-btn-disabled-bg); color:var(--ps-btn-disabled-text); cursor:not-allowed; }
        .pfl .bo{ border:1px solid var(--ps-outline-accent-border); background:var(--ps-surface); color:var(--ps-btn); }
        .pfl .b2{ border:1px solid var(--ps-border-strong); background:var(--ps-surface); color:var(--ps-text); }
        .pfl .bsm{ height:38px; padding:0 12px; border:1px solid var(--ps-border-strong); border-radius:9px; background:var(--ps-surface); font-size:13px;
                   font-weight:600; color:var(--ps-text); display:inline-flex; align-items:center; gap:6px; cursor:pointer; }
        .pfl .card{ margin-top:16px; border:1px solid var(--ps-border); border-radius:14px; box-shadow:var(--ps-shadow-sm);
                    background:var(--ps-surface); overflow:hidden; }
        .pfl .err-banner{ background:var(--ps-danger-bg); color:var(--ps-danger); border-radius:10px; padding:12px 14px; display:flex;
                           align-items:center; justify-content:space-between; gap:12px; margin-top:16px; font-size:13.5px; }
        .pfl input:not([type=checkbox]):not([type=radio]), .pfl select{ height:40px; }
        .pfl .err-banner button{ background:none; border:1px solid var(--ps-danger); color:var(--ps-danger); border-radius:8px; padding:4px 10px;
                                   font-size:12px; font-weight:700; cursor:pointer; }
        .pfl .skel{ background:linear-gradient(90deg,var(--ps-surface-3) 25%,var(--ps-hover) 37%,var(--ps-surface-3) 63%); background-size:400% 100%;
                    animation:pfl-shimmer 1.4s ease infinite; border-radius:8px; }
        @keyframes pfl-shimmer{ 0%{background-position:100% 50%} 100%{background-position:0 50%} }
      `}</style>

      <h1 className="pt">Profile</h1>

      <div className="tabs" role="tablist">
        {TABS.map((t, idx) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            tabIndex={activeTab === t.key ? 0 : -1}
            className={`tab ${activeTab === t.key ? 'on' : ''}`}
            onClick={() => onNavigateTab?.(t.key)}
            onKeyDown={(e) => handleTabKeyDown(e, idx)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'credits' && <CreditsTab onUpgrade={onUpgrade} onShowMySpacePage={onShowMySpacePage} />}
      {activeTab === 'notifications' && <NotificationsTab onShowToast={onShowToast} />}
    </div>
  );
}

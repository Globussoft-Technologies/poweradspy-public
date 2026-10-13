import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useFloating, offset, flip, shift, autoUpdate, FloatingPortal, useClick, useDismiss, useInteractions,
} from '@floating-ui/react';
import { getImageGenCreditHistory, downloadImageGenCreditHistoryCsv } from '../../../services/api';
import { useImageGenCredits } from '../../../hooks/useImageGenCredits';
import BuyTopUpModal from '../BuyTopUpModal';

const FILTERS = [
  { value: 'all', label: 'All activity' },
  { value: 'used', label: 'Used' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'allocated', label: 'Allocated' },
];

const PILL_CLASS = { used: 'pUsed', refunded: 'pRefunded', allocated: 'pAllocated' };
const PILL_LABEL = { used: 'Used', refunded: 'Refunded', allocated: 'Allocated' };

const PAGE_SIZE = 8;

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** "Credits per year" for yearly-upfront plans, "per month" etc. otherwise. */
function periodLabel(summary) {
  if (summary?.is_trial) return 'Trial credits';
  const p = summary?.refresh_period;
  if (!p) return 'Credits per cycle';
  const months = p.unit === 'year' ? 12 * p.count : p.unit === 'month' ? p.count : null;
  if (months === 12) return 'Credits per year';
  if (months === 1) return 'Credits per month';
  if (p.unit === 'week' && p.count === 1) return 'Credits per week';
  if (p.unit === 'day' && p.count === 1) return 'Credits per day';
  return `Credits every ${p.count} ${p.unit}${p.count > 1 ? 's' : ''}`;
}

/** "300 per month", "3630 per year", "10 for the trial" — from periodLabel. */
function perCycleText(summary, total) {
  if (summary?.is_trial) return `${total} for the trial`;
  const label = periodLabel(summary);
  return label.startsWith('Credits ') ? `${total} ${label.slice(8)}` : `${total} per cycle`;
}

/** Date-only values from the backend ("2026-10-23") — formatted in UTC so the
 * day never shifts with the viewer's timezone. */
function fmtDay(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function CreditsTab({ onUpgrade, onShowMySpacePage }) {
  const navigate = useNavigate();
  // Shared with the header/MySpace/Recreate — any balance change shows here live.
  const { summary, refresh: refreshCredits } = useImageGenCredits();
  const [loadingSummary, setLoadingSummary] = useState(!summary);
  const [summaryError, setSummaryError] = useState(null);

  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState({ items: [], total: 0 });
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const loadSummary = useCallback(() => {
    setLoadingSummary(true);
    setSummaryError(null);
    refreshCredits()
      .then((data) => { if (!data) setSummaryError('Failed to load credits.'); })
      .finally(() => setLoadingSummary(false));
  }, [refreshCredits]);

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    setHistoryError(null);
    getImageGenCreditHistory({ type: filter, page, limit: PAGE_SIZE })
      .then((res) => setHistory(res?.data || { items: [], total: 0 }))
      .catch((err) => setHistoryError(err.message || 'Failed to load credit history.'))
      .finally(() => setLoadingHistory(false));
  }, [filter, page]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { setPage(1); }, [filter]);
  // Balance moved (reserve, refund, top-up, allocation — here or in another
  // screen/tab) → the history has a new line; reload it.
  const seenBalanceRef = useRef(summary?.balance);
  useEffect(() => {
    if (typeof summary?.balance !== 'number') return;
    if (seenBalanceRef.current === undefined) { seenBalanceRef.current = summary.balance; return; }
    if (seenBalanceRef.current !== summary.balance) { seenBalanceRef.current = summary.balance; loadHistory(); }
  }, [summary?.balance, loadHistory]);

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open: filterOpen,
    onOpenChange: setFilterOpen,
    placement: 'bottom-start',
    middleware: [offset(6), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const filterClick = useClick(context);
  const filterDismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([filterClick, filterDismiss]);

  const total = summary?.monthly_quota ?? 0;
  const used = summary?.used_this_cycle ?? 0;
  const left = summary?.cycle_balance ?? Math.max(0, total - used);
  const topupLeft = summary?.topup_balance ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  // Under 10% of the plan's credits left → red bar + red "left" value.
  const low = total > 0 ? left < total * 0.1 : left <= 0;
  const lowColor = low ? 'var(--ps-danger-icon)' : undefined;

  const totalPages = Math.max(1, Math.ceil((history.total || 0) / PAGE_SIZE));
  const rangeStart = history.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(page * PAGE_SIZE, history.total || 0);

  const handleRowClick = (item) => {
    if (item.type === 'used' && item.image_id) {
      // The URL-sync effect in App.jsx picks up the new pathname and flips
      // showMySpacePage/showProfilePage itself — no extra dispatch needed here.
      navigate(`/myspace?image=${encodeURIComponent(item.image_id)}`);
    }
  };

  return (
    <>
      <style>{`
        .us{ margin-top:14px; border:1px solid var(--ps-border); border-radius:12px; background:var(--ps-surface); }
        .us-h{ display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid var(--ps-divider); flex-wrap:wrap; }
        .us-t{ font-size:14.5px; font-weight:700; color:var(--ps-text); }
        .us-pill{ font-size:12px; font-weight:600; color:var(--ps-accent); background:var(--ps-accent-soft); border-radius:6px; padding:2px 8px; white-space:nowrap; }
        .us-act{ margin-left:auto; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
        .us-link{ font-size:13px; font-weight:600; color:var(--ps-accent); background:none; border:0; padding:0; cursor:pointer; }
        .us-link:hover{ text-decoration:underline; }
        .us-btn{ height:30px; padding:0 12px; border:1px solid var(--ps-border-strong); border-radius:8px; font-size:13px; font-weight:600;
                 color:var(--ps-text); background:var(--ps-surface); cursor:pointer; }
        .us-btn:hover{ background:var(--ps-surface-2); }
        .us-r{ display:grid; grid-template-columns:minmax(200px,260px) minmax(0,1fr) 120px; align-items:center; gap:20px; padding:14px 18px; }
        .us-r + .us-r{ border-top:1px solid var(--ps-divider); }
        .us-n{ font-size:13.5px; font-weight:600; color:var(--ps-text); }
        .us-s{ font-size:12px; color:var(--ps-text-subtle); margin-top:2px; }
        .us-bar{ height:6px; border-radius:3px; background:var(--ps-track); overflow:hidden; }
        .us-bar > div{ height:100%; border-radius:3px; background:var(--ps-accent-strong); transition:width .4s; }
        .us-v{ text-align:right; font-variant-numeric:tabular-nums; font-size:13px; color:var(--ps-text-muted); }
        .us-v b{ font-size:15px; font-weight:700; color:var(--ps-text); }
        .tbx{ margin-top:10px; border:1px solid var(--ps-border); border-radius:12px; overflow-x:auto; }
        .cht table{ width:100%; border-collapse:collapse; min-width:640px; }
        .cht th{ text-align:left; font-size:10.5px; font-weight:700; letter-spacing:.8px; text-transform:uppercase;
                 color:var(--ps-text-subtle); background:var(--ps-surface-2); padding:9px 16px; border-bottom:1px solid var(--ps-border); }
        .cht td{ padding:10px 16px; border-bottom:1px solid var(--ps-divider); font-size:13px; vertical-align:middle; }
        .cht .c-date{ width:200px; }
        .cht .c-num{ width:110px; }
        .cht tr:last-child td{ border-bottom:0; }
        .num{ text-align:right; font-variant-numeric:tabular-nums; }
        .pill{ display:inline-flex; align-items:center; font-size:11.5px; font-weight:700; border-radius:8px; padding:3px 9px; }
        .pAllocated{ background:var(--ps-accent-soft); color:var(--ps-accent); }
        .pUsed{ background:var(--ps-surface-3); color:var(--ps-text-2); }
        .pRefunded{ background:var(--ps-success-bg); color:var(--ps-success); }
        .pos{ color:var(--ps-success); font-weight:700; }
        .neg{ color:var(--ps-text); font-weight:700; }
        .cht .used-row{ cursor:pointer; }
        .cht .used-row:hover{ background:var(--ps-surface-2); }
        .ch-filter-menu{ background:var(--ps-surface); border:1px solid var(--ps-border); border-radius:10px; box-shadow:0 8px 24px rgba(24,28,60,.12);
                          padding:4px; min-width:160px; z-index:1000; }
        .ch-filter-opt{ display:block; width:100%; text-align:left; padding:8px 10px; font-size:13px; font-weight:600;
                        color:var(--ps-text); background:none; border:0; border-radius:7px; cursor:pointer; }
        .ch-filter-opt:hover{ background:var(--ps-hover); }
        .ch-filter-opt.on{ color:var(--ps-accent); background:var(--ps-accent-soft); }
        .ch-footer{ display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:12.5px; color:var(--ps-text-subtle); }
        .ch-head .bsm{ height:34px; }
        .ch-pg{ width:30px; height:30px; border-radius:8px; border:1px solid var(--ps-border-strong); color:var(--ps-text-2); background:var(--ps-surface);
                display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
        .ch-pg:disabled{ border-color:var(--ps-border); color:var(--ps-text-disabled); cursor:not-allowed; }
        @media (max-width:760px){
          .us-r{ grid-template-columns:1fr; gap:10px; }
          .us-v{ text-align:left; }
        }
      `}</style>

      {summaryError ? (
        <div className="err-banner">
          <span>{summaryError}</span>
          <button onClick={loadSummary}>Retry</button>
        </div>
      ) : loadingSummary ? (
        <div className="us" style={{ padding: '14px 18px' }}><div className="skel" style={{ height: 70 }} /></div>
      ) : (
        <div className="us">
          <div className="us-h">
            <span className="us-t">Image credits</span>
            <span className="us-pill">{summary?.plan_label || 'No active plan'}</span>
            <div className="us-act">
              <button className="us-link" onClick={() => setTopUpOpen(true)}>Buy top-up</button>
              <button className="us-btn" onClick={() => onUpgrade?.()}>Upgrade plan</button>
            </div>
          </div>
          <div className="us-r">
            <div>
              <div className="us-n">{summary?.is_trial ? 'Trial credits' : 'Plan credits'}</div>
              <div className="us-s">
                Refreshes {summary?.cycle_resets_at ? fmtDay(summary.cycle_resets_at) : '—'}
                {summary?.ends_on && <> · Ends {fmtDay(summary.ends_on)}</>}
              </div>
            </div>
            <div>
              <div className="us-bar"><div style={{ width: `${pct}%`, background: lowColor }} /></div>
              <div className="us-s" style={{ marginTop: 6 }}>
                {used} of {total} used · {perCycleText(summary, total)} · 1 credit = 1 image
              </div>
            </div>
            <div className="us-v">
              <div><b style={{ color: lowColor }}>{left}</b> left</div>
              <div className="us-s">{pct}% used</div>
            </div>
          </div>
          {topupLeft > 0 && (
            <div className="us-r">
              <div>
                <div className="us-n">Top-up credits</div>
                <div className="us-s">Never expire · used after plan credits</div>
              </div>
              <div />
              <div className="us-v"><div><b>{topupLeft}</b> left</div></div>
            </div>
          )}
        </div>
      )}

      <div className="ch-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Credit history</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button ref={refs.setReference} {...getReferenceProps()} className="bsm">
            {FILTERS.find((f) => f.value === filter)?.label} <ChevronDown size={13} />
          </button>
          {filterOpen && (
            <FloatingPortal>
              <div ref={refs.setFloating} style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }} {...getFloatingProps()} className="ch-filter-menu">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    className={`ch-filter-opt ${filter === f.value ? 'on' : ''}`}
                    onClick={() => { setFilter(f.value); setFilterOpen(false); }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </FloatingPortal>
          )}
          <button className="bsm" onClick={() => downloadImageGenCreditHistoryCsv(filter).catch(() => {})}>
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      <div className="tbx cht">
        {historyError ? (
          <div className="err-banner" style={{ margin: 14 }}>
            <span>{historyError}</span>
            <button onClick={loadHistory}>Retry</button>
          </div>
        ) : loadingHistory ? (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel" style={{ height: 30 }} />)}
          </div>
        ) : history.items.length === 0 ? (
          <p style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--ps-text-subtle)', padding: 32, margin: 0 }}>No credit activity yet</p>
        ) : (
          <>
            <table>
              <thead>
                <tr><th className="c-date">Date</th><th>Activity</th><th className="num c-num">Credits</th><th className="num c-num">Balance</th></tr>
              </thead>
              <tbody>
                {history.items.map((item) => (
                  <tr key={item.id} className={item.type === 'used' && item.image_id ? 'used-row' : ''} onClick={() => handleRowClick(item)}>
                    <td style={{ color: 'var(--ps-text-2)', whiteSpace: 'nowrap' }}>{fmtDate(item.date)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className={`pill ${PILL_CLASS[item.type] || 'pUsed'}`}>{PILL_LABEL[item.type] || item.type}</span>
                        <span style={{ color: 'var(--ps-text-2)' }}>{item.detail}</span>
                      </div>
                    </td>
                    <td className={`num ${item.delta > 0 ? 'pos' : 'neg'}`}>
                      {item.delta > 0 ? `+${item.delta}` : `−${Math.abs(item.delta)}`}
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>{item.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ch-footer">
              <span>Showing {rangeStart}–{rangeEnd} of {history.total}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ch-pg" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft size={15} /></button>
                <button className="ch-pg" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}><ChevronRight size={15} /></button>
              </div>
            </div>
          </>
        )}
      </div>

      {topUpOpen && (
        <BuyTopUpModal
          topup={summary?.topup}
          onClose={() => setTopUpOpen(false)}
          onCreditsSynced={() => loadHistory()}
        />
      )}
    </>
  );
}

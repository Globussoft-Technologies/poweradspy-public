import React, { useState, useEffect } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { autoUpdate, flip, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions } from '@floating-ui/react';
import { getImageGenCredits } from '../../services/api';
import { useImageGenCredits } from '../../hooks/useImageGenCredits';
import '../shared/floating-popover.css';

const DAY_MS = 24 * 60 * 60 * 1000;

// Theme tokens (src/styles/ps-tokens.css) — light/dark values switch with
// html.dark, so the number and bold text stay readable in dark mode.
const BRAND_PURPLE = 'var(--ps-btn)'; // "Upgrade plan" bg, "Go to MySpace" text, plan badge text
const BAR_FILL = 'var(--ps-accent-strong)';
const BAR_TRACK = 'var(--ps-track)';
const BADGE_BG = 'var(--ps-accent-soft)';
const REFRESH_BG = 'var(--ps-surface-3)';
const REFRESH_ICON = 'var(--ps-violet)';
const NUMBER_DARK = 'var(--ps-text)';
const GO_BORDER = 'var(--ps-accent-border)';

/**
 * Header Credits dropdown (screen 2). monthly_quota/plan_label/cycle_resets_at
 * are optional backend fields (see creditsController.js) — plan_label/
 * cycle_resets_at stay null by default since real per-plan credit allocation
 * is still deferred; monthly_quota always has a value (falls back to the
 * account's real defaultCredits grant server-side) so the progress bar always
 * renders with real numbers instead of disappearing.
 */
const CreditsDropdown = ({ onClose, onViewAll, onViewMySpace, onUpgrade, anchorRef }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Shared with the header's own indicator and every ad card's Recreate
  // button — refreshing it here (not just this dropdown's own local fetch)
  // keeps them in sync with whatever is actually shown in this popup.
  const { balance: ctxBalance, summary: ctxSummary, refresh: refreshCtxBalance } = useImageGenCredits();
  const { refs, floatingStyles, context, isPositioned, x, y } = useFloating({
    open: true,
    onOpenChange: (nextOpen) => { if (!nextOpen) onClose?.(); },
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(10), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
  const { getFloatingProps } = useInteractions([dismiss]);
  const positioned = typeof isPositioned === 'boolean' ? isPositioned : x != null && y != null;

  useEffect(() => {
    if (anchorRef?.current) refs.setReference(anchorRef.current);
  }, [anchorRef, refs]);

  useEffect(() => {
    let cancelled = false;
    refreshCtxBalance();
    getImageGenCredits(5)
      .then((res) => { if (!cancelled) setData(res?.data || null); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live shared summary wins over this popup's own snapshot, so the numbers
  // update in place while it's open (reserve, refund, top-up, other tab).
  const live = ctxSummary ? { ...data, ...ctxSummary } : data;
  const displayBalance = typeof ctxBalance === 'number' ? ctxBalance : live?.balance;
  const cost = live?.cost_per_generation ?? 1;
  const quota = typeof live?.monthly_quota === 'number' ? live.monthly_quota : null;
  const used = typeof live?.used_this_cycle === 'number' ? live.used_this_cycle : null;
  const hasQuota = quota !== null && quota > 0 && used !== null;
  // Fill tracks USED fraction (reference mockup: 44 of 140 used ⇒ bar ~31%
  // filled), not remaining — filling by remaining was backwards.
  const pctUsed = hasQuota ? Math.max(0, Math.min(100, Math.round((used / quota) * 100))) : 0;

  let daysUntilReset = null;
  if (live?.cycle_resets_at) {
    const diff = new Date(live.cycle_resets_at).getTime() - Date.now();
    daysUntilReset = Math.max(0, Math.ceil(diff / DAY_MS));
  }

  return <FloatingPortal>
    <div
      ref={refs.setFloating}
      {...getFloatingProps({ className: 'w-80 max-w-[calc(100vw-24px)] z-[2147483500]' })}
      style={{ ...floatingStyles, visibility: positioned ? 'visible' : 'hidden' }}
    >
      <div className={`rounded-2xl shadow-2xl bg-theme-card border border-theme-border overflow-hidden floating-popover-motion ${positioned ? 'is-positioned' : ''}`}>
      {loading && !ctxSummary ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={18} className="animate-spin text-theme-text-muted" />
        </div>
      ) : (
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-theme-text-muted uppercase tracking-wider">
              Image Credits
            </span>
            {live?.plan_label && (
              <span
                className="text-[11px] font-bold rounded-full px-2.5 py-0.5"
                style={{ backgroundColor: BADGE_BG, color: BRAND_PURPLE }}
              >
                {live.plan_label}
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-1.5">
            <span className="text-[34px] font-extrabold leading-none" style={{ color: NUMBER_DARK }}>
              {displayBalance ?? '—'}
            </span>
            <span className="text-[15px] font-medium text-theme-text-muted">credits left</span>
          </div>
          <p className="text-[13px] text-theme-text-muted mt-1.5">
            You can create{' '}
            <span className="font-bold" style={{ color: NUMBER_DARK }}>
              {displayBalance ?? '—'} more image{displayBalance === 1 ? '' : 's'}
            </span>
          </p>

          {hasQuota ? (
            <>
              <div className="mt-4 h-2 w-full rounded-full overflow-hidden" style={{ backgroundColor: BAR_TRACK }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pctUsed}%`, backgroundColor: BAR_FILL }}
                />
              </div>
              <div className="flex items-center justify-between mt-2 text-[12px] text-theme-text-muted">
                <span>
                  <span className="font-bold" style={{ color: NUMBER_DARK }}>{used}</span> of {quota} used this cycle
                </span>
                <span>{cost} credit = 1 image</span>
              </div>
            </>
          ) : (
            <p className="mt-4 text-[12px] text-theme-text-muted">
              {cost} credit{cost === 1 ? '' : 's'} = 1 image
            </p>
          )}

          {live?.cycle_resets_at && (
            <div
              className="mt-3 flex items-center justify-between rounded-xl px-3 py-2.5"
              style={{ backgroundColor: REFRESH_BG }}
            >
              <div className="flex items-center gap-2 text-[12px] text-theme-text-muted">
                <RotateCw size={13} style={{ color: REFRESH_ICON }} />
                <span>
                  Refreshes on{' '}
                  <span className="font-bold" style={{ color: NUMBER_DARK }}>
                    {new Date(live.cycle_resets_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </span>
              </div>
              {daysUntilReset !== null && (
                <span className="text-[11px] text-theme-text-muted shrink-0">in {daysUntilReset} days</span>
              )}
            </div>
          )}
          {!live?.cycle_resets_at && live?.ends_on && (
            <div
              className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[12px] text-theme-text-muted"
              style={{ backgroundColor: REFRESH_BG }}
            >
              <span>
                {live.is_trial ? 'Trial ends on' : 'Plan credits end on'}{' '}
                <span className="font-bold" style={{ color: NUMBER_DARK }}>
                  {new Date(live.ends_on).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </span>
            </div>
          )}

          <div className="flex items-center gap-2.5 mt-4">
            <button
              onClick={() => { onViewMySpace ? onViewMySpace() : onViewAll?.(); onClose?.(); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-theme-card hover:bg-theme-text/[0.04] transition-colors"
              style={{ color: BRAND_PURPLE, border: `1px solid ${GO_BORDER}` }}
            >
              Go to MySpace
            </button>
            <button
              onClick={() => { onUpgrade?.(); onClose?.(); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-bold hover:opacity-90 transition-opacity"
              style={{ backgroundColor: BRAND_PURPLE, color: 'var(--ps-btn-text)' }}
            >
              Upgrade plan
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  </FloatingPortal>;
};

export default CreditsDropdown;

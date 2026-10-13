import React, { useState, useEffect, useRef } from 'react';
import { Sparkle, X, Loader2 } from 'lucide-react';
import { useImageGenCredits } from '../../hooks/useImageGenCredits';

// Packs and prices come from the backend (config.json → imageGen.topup, priced
// from pricePerCredit). Payment happens entirely in aMember — "Continue to
// payment" opens that pack's aMember checkout in a new tab. When the user comes
// back to this tab, we ask the backend to re-read aMember, which credits the
// purchase exactly once.

function formatPrice(pack) {
  const amount = Number(pack.price).toFixed(2);
  return pack.currency_symbol ? `${pack.currency_symbol}${amount}` : `${amount} ${pack.currency}`;
}

export default function BuyTopUpModal({ topup, onClose, onCreditsSynced }) {
  const packs = topup?.packs || [];
  const firstAvailable = packs.findIndex((p) => p.available);
  const [selected, setSelected] = useState(firstAvailable >= 0 ? firstAvailable : 0);
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [checking, setChecking] = useState(false);
  const [creditedMsg, setCreditedMsg] = useState(null);
  const startBalanceRef = useRef(null);
  const { sync: syncCredits, balance } = useImageGenCredits();

  useEffect(() => {
    if (!awaitingReturn) return undefined;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      setChecking(true);
      try {
        // Shared context sync — header, MySpace, Profile all update from it.
        const data = await syncCredits();
        onCreditsSynced?.(data);
        if (typeof data?.balance === 'number' && typeof startBalanceRef.current === 'number'
          && data.balance > startBalanceRef.current) {
          setCreditedMsg(`${data.balance - startBalanceRef.current} credits added to your balance.`);
          setAwaitingReturn(false);
        }
      } catch { /* try again on next focus */ } finally {
        setChecking(false);
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [awaitingReturn, onCreditsSynced, syncCredits]);

  const pack = packs[selected];

  const handleContinue = () => {
    if (!pack?.available || !pack.checkout_url) return;
    startBalanceRef.current = typeof balance === 'number' ? balance : null;
    window.open(pack.checkout_url, '_blank', 'noopener');
    setAwaitingReturn(true);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,20,33,.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div
        style={{ width: 480, maxWidth: '100%', background: 'var(--ps-surface)', borderRadius: 16, overflow: 'hidden', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--ps-border)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800, color: 'var(--ps-text)' }}>
            <Sparkle size={16} fill="var(--ps-accent-strong)" color="var(--ps-accent-strong)" /> Buy credit top-up
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--ps-text-subtle)' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!topup?.enabled || !packs.length ? (
            <p style={{ fontSize: 13.5, color: 'var(--ps-text-subtle)', margin: 0 }}>Top-ups aren't available right now.</p>
          ) : packs.map((p, idx) => (
            <button
              key={p.credits}
              onClick={() => p.available && setSelected(idx)}
              disabled={!p.available}
              style={{
                textAlign: 'left', border: `1px solid ${selected === idx ? 'var(--ps-accent-strong)' : 'var(--ps-border-strong)'}`,
                background: selected === idx ? 'var(--ps-accent-softer)' : 'var(--ps-surface)', borderRadius: 12, padding: '14px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: p.available ? 'pointer' : 'not-allowed', opacity: p.available ? 1 : 0.5,
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: 'var(--ps-text)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: '50%', border: `2px solid ${selected === idx ? 'var(--ps-accent-strong)' : 'var(--ps-outline-accent-border)'}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selected === idx && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ps-accent-strong)' }} />}
                </span>
                {p.credits} credits
                {p.discount_percent > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ps-success)', background: 'var(--ps-success-bg)', borderRadius: 6, padding: '2px 6px' }}>
                    Save {p.discount_percent}%
                  </span>
                )}
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                {p.discount_percent > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ps-text-faint)', textDecoration: 'line-through' }}>
                    {formatPrice({ ...p, price: p.original_price })}
                  </span>
                )}
                <span>{p.available ? formatPrice(p) : 'Unavailable'}</span>
              </span>
            </button>
          ))}
          <p style={{ fontSize: 12, color: 'var(--ps-text-subtle)', margin: '4px 0 0' }}>
            Top-up credits never expire and are used after your plan's monthly credits run out. Payment and invoice are handled on your PowerAdSpy account page.
          </p>
          {awaitingReturn && (
            <p style={{ fontSize: 12.5, color: 'var(--ps-accent)', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              {checking && <Loader2 size={13} className="animate-spin" />}
              Finish payment in the new tab — your credits will appear here once it's confirmed.
            </p>
          )}
          {creditedMsg && <p style={{ fontSize: 12.5, color: 'var(--ps-success)', fontWeight: 700, margin: '4px 0 0' }}>{creditedMsg}</p>}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '14px 22px', borderTop: '1px solid var(--ps-border)' }}>
          <button
            onClick={onClose}
            style={{ height: 44, padding: '0 18px', borderRadius: 10, fontWeight: 700, fontSize: 14, border: '1px solid var(--ps-border-strong)', background: 'var(--ps-surface)', color: 'var(--ps-text)', cursor: 'pointer' }}
          >
            {creditedMsg ? 'Done' : 'Cancel'}
          </button>
          <button
            onClick={handleContinue}
            disabled={!pack?.available}
            style={{ height: 44, padding: '0 18px', borderRadius: 10, fontWeight: 700, fontSize: 14, border: 0, background: pack?.available ? 'var(--ps-btn)' : 'var(--ps-btn-disabled-bg)', color: pack?.available ? 'var(--ps-surface)' : 'var(--ps-btn-disabled-text)', cursor: pack?.available ? 'pointer' : 'not-allowed' }}
          >
            Continue to payment{pack?.available ? ` · ${formatPrice(pack)}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { getMyNotificationPreferences, updateMyNotificationPreferences } from '../../../services/api';

// In-app/push only — email/SendGrid delivery is untouched by this tab entirely
// (explicit instruction). Rows come from the backend (notificationPrefsController.js's
// KEYS) — only real, already-firing notifications are listed, never a mock toggle
// that doesn't actually gate anything.

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 0, cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? 'var(--ps-accent-strong)' : 'var(--ps-surface-3)', position: 'relative', transition: 'background .15s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%',
        background: on ? 'var(--ps-btn-text)' : 'var(--ps-text-disabled)', transition: 'left .15s, background .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

export default function NotificationsTab({ onShowToast }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getMyNotificationPreferences()
      .then((res) => setItems(res?.data?.items || []))
      .catch((err) => setError(err.message || 'Failed to load preferences.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (key, value) => {
    const prevItems = items;
    setItems((list) => list.map((row) => (row.key === key ? { ...row, enabled: value } : row)));
    setSavingKey(key);
    try {
      await updateMyNotificationPreferences({ [key]: value });
      onShowToast?.('Preferences saved', 'success');
    } catch (err) {
      setItems(prevItems); // revert on error
      onShowToast?.(err.message || 'Could not save preferences.', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <div className="card" style={{ padding: '18px 22px' }}><div className="skel" style={{ height: 160 }} /></div>;
  if (error) return <div className="err-banner"><span>{error}</span><button onClick={load}>Retry</button></div>;

  return (
    <div className="card" style={{ padding: '4px 22px' }}>
      {items.map((row, i) => (
        <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '14px 0', borderTop: i ? '1px solid var(--ps-divider)' : 0 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ps-text)', margin: 0 }}>{row.title}</p>
            <p style={{ fontSize: 13, color: 'var(--ps-text-subtle)', margin: '2px 0 0' }}>{row.description}</p>
          </div>
          <Toggle on={row.enabled} disabled={savingKey === row.key} onChange={(v) => handleToggle(row.key, v)} />
        </div>
      ))}
    </div>
  );
}

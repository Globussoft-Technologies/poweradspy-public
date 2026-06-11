'use strict';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { guestSearchAds, mapAdToCard } from '../../services/api';
import AdCard from '../ads/AdCard';

const PAS_API_BASE = (import.meta.env.VITE_PAS_NODE_API || '').replace(/\/$/, '');

const PLATFORMS = [
  { key: 'all',       label: 'ALL',       icon: null },
  { key: 'facebook',  label: 'Facebook',  icon: '🔵' },
  { key: 'instagram', label: 'Instagram', icon: '🟣' },
  { key: 'youtube',   label: 'YouTube',   icon: '🔴' },
  { key: 'google',    label: 'Google',    icon: '🟢' },
  { key: 'gdn',       label: 'GDN',       icon: '🔷' },
  { key: 'native',    label: 'Native',    icon: '🟠' },
  { key: 'linkedin',  label: 'LinkedIn',  icon: '🔹' },
  { key: 'reddit',    label: 'Reddit',    icon: '🟥' },
  { key: 'quora',     label: 'Quora',     icon: '🔴' },
  { key: 'pinterest', label: 'Pinterest', icon: '🔴' },
  { key: 'tiktok',    label: 'TikTok',    icon: '⬛' },
];

const PLATFORM_LOGOS = {
  facebook:  'https://cdn.poweradspy.com/images/fb-icon.png',
  instagram: 'https://cdn.poweradspy.com/images/insta-icon.png',
  youtube:   'https://cdn.poweradspy.com/images/yt-icon.png',
  google:    'https://cdn.poweradspy.com/images/google-icon.png',
  gdn:       'https://cdn.poweradspy.com/images/gdn-icon.png',
  native:    'https://cdn.poweradspy.com/images/native-icon.png',
  linkedin:  'https://cdn.poweradspy.com/images/linkedin-icon.png',
  reddit:    'https://cdn.poweradspy.com/images/reddit-icon.png',
  quora:     'https://cdn.poweradspy.com/images/quora-icon.png',
  pinterest: 'https://cdn.poweradspy.com/images/pinterest-icon.png',
  tiktok:    'https://cdn.poweradspy.com/images/tiktok-icon.png',
};

function PlatformTab({ platform, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '6px 12px', borderRadius: '8px', border: 'none',
        background: active ? '#6366f1' : 'transparent',
        color: active ? '#fff' : '#374151',
        fontWeight: active ? 700 : 500,
        fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {platform.key === 'all' ? (
        <span style={{ fontWeight: 700 }}>ALL</span>
      ) : (
        PLATFORM_LOGOS[platform.key]
          ? <img src={PLATFORM_LOGOS[platform.key]} alt={platform.label} style={{ width: 18, height: 18, borderRadius: '50%' }} onError={e => { e.target.style.display = 'none'; }} />
          : <span style={{ fontSize: 14 }}>{platform.icon}</span>
      )}
      {platform.key !== 'all' && <span>{platform.label}</span>}
    </button>
  );
}

export default function GuestPage({ token }) {
  const [activePlatform, setActivePlatform] = useState('all');
  const [adsByPlatform, setAdsByPlatform]   = useState({});
  const [pageByPlatform, setPageByPlatform] = useState({});
  const [hasMoreByPlatform, setHasMoreByPlatform] = useState({});
  const [loading, setLoading]   = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [totalAds, setTotalAds] = useState(null);
  const loaderRef = useRef(null);
  const fetchingRef = useRef(false);

  const currentPage = pageByPlatform[activePlatform] ?? 0;
  const currentAds  = adsByPlatform[activePlatform]  ?? [];
  const hasMore     = hasMoreByPlatform[activePlatform] ?? true;

  const loadAds = useCallback(async (platform, page) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const data = await guestSearchAds(token, page);
      const ads  = (data.ads || []).filter(ad =>
        platform === 'all' || (ad.network || '').toLowerCase() === platform
      );

      setAdsByPlatform(prev => ({
        ...prev,
        [platform]: page === 0 ? ads : [...(prev[platform] || []), ...ads],
      }));
      setPageByPlatform(prev => ({ ...prev, [platform]: page + 1 }));
      setHasMoreByPlatform(prev => ({
        ...prev,
        [platform]: !data.guestLimitReached && ads.length > 0,
      }));
      if (page === 0 && data.meta?.total) {
        const t = data.meta.total;
        const sum = typeof t === 'object'
          ? Object.values(t).reduce((a, b) => a + (Number(b) || 0), 0)
          : Number(t) || 0;
        setTotalAds(sum);
      }
    } catch (e) {
      console.error('[GuestPage] loadAds error', e);
    } finally {
      setLoading(false);
      setInitialLoad(false);
      fetchingRef.current = false;
    }
  }, [token]);

  // Load on platform switch
  useEffect(() => {
    if (adsByPlatform[activePlatform] == null) {
      loadAds(activePlatform, 0);
    }
  }, [activePlatform]);

  // Initial load
  useEffect(() => {
    loadAds('all', 0);
  }, []);

  // Infinite scroll observer
  useEffect(() => {
    if (!loaderRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && hasMore) {
        loadAds(activePlatform, pageByPlatform[activePlatform] ?? 0);
      }
    }, { threshold: 0.1 });
    obs.observe(loaderRef.current);
    return () => obs.disconnect();
  }, [activePlatform, loading, hasMore, pageByPlatform]);

  function formatNumber(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src="/logo.png" alt="PowerAdSpy" style={{ height: 32 }} onError={e => { e.target.style.display = 'none'; }} />
          <span style={{ fontWeight: 800, fontSize: '18px', color: '#6366f1' }}>PowerAdSpy</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f3f4f6', borderRadius: '8px', padding: '6px 12px', color: '#9ca3af', fontSize: '13px', minWidth: 280, cursor: 'not-allowed' }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span>Search keyword, advertiser, or domain...</span>
        </div>
        <a
          href="https://app.poweradspy.com/amember/member"
          style={{ background: '#6366f1', color: '#fff', padding: '8px 20px', borderRadius: '8px', fontWeight: 600, fontSize: '14px', textDecoration: 'none' }}
        >
          Login
        </a>
      </header>

      <div style={{ display: 'flex' }}>

        {/* Sidebar — filters disabled */}
        <aside style={{ width: 220, minWidth: 220, background: '#fff', borderRight: '1px solid #e5e7eb', minHeight: 'calc(100vh - 56px)', padding: '16px 0', position: 'sticky', top: 56, height: 'calc(100vh - 56px)', overflowY: 'auto' }}>
          <div style={{ padding: '0 16px 12px', fontWeight: 700, fontSize: '15px', color: '#111827' }}>Filters</div>
          {['Engagement', 'Category', 'Call To Action', 'Language', 'Gender', 'Age', 'Meta Ads Library', 'Verified Only', 'Country', 'Ecommerce Platform'].map(f => (
            <div key={f} style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#6b7280', fontSize: '14px', cursor: 'not-allowed', opacity: 0.6 }}>
              <span>{f}</span>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
            </div>
          ))}
          <div style={{ margin: '16px', padding: '10px', background: '#f3f4f6', borderRadius: '8px', textAlign: 'center', fontSize: '12px', color: '#9ca3af' }}>
            Login to use filters
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, padding: '16px 20px', minWidth: 0 }}>

          {/* Platform tabs */}
          <div style={{ background: '#fff', borderRadius: '10px', padding: '8px 12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', border: '1px solid #e5e7eb' }}>
            {PLATFORMS.map(p => (
              <PlatformTab
                key={p.key}
                platform={p}
                active={activePlatform === p.key}
                onClick={() => setActivePlatform(p.key)}
              />
            ))}
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', color: '#374151', fontWeight: 500 }}>
              Total Ads: {totalAds != null ? formatNumber(totalAds) : '—'}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['Newest', 'Impressions', 'Popularity'].map(s => (
                <button key={s} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff', fontSize: '13px', color: '#6b7280', cursor: 'not-allowed', opacity: 0.6 }}>{s}</button>
              ))}
            </div>
          </div>

          {/* Ad grid */}
          {initialLoad ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} style={{ height: 320, background: '#e5e7eb', borderRadius: '12px', animation: 'pulse 1.5s infinite' }} />
              ))}
            </div>
          ) : currentAds.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af' }}>No ads found for this platform.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {currentAds.map((ad, i) => (
                <AdCard key={`${ad.id}-${i}`} ad={ad} isGuest={true} />
              ))}
            </div>
          )}

          {/* Loader / limit reached */}
          <div ref={loaderRef} style={{ textAlign: 'center', padding: '24px', color: '#9ca3af', fontSize: '14px' }}>
            {loading && !initialLoad && <span>Loading more ads...</span>}
            {!loading && !hasMore && currentAds.length > 0 && (
              <div style={{ background: '#f3f4f6', borderRadius: '12px', padding: '24px', maxWidth: 400, margin: '0 auto' }}>
                <p style={{ fontWeight: 600, color: '#374151', marginBottom: '12px' }}>You've reached the guest limit</p>
                <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '16px' }}>Login to see all {totalAds ? formatNumber(totalAds) : ''} ads and use filters</p>
                <a href="https://app.poweradspy.com/amember/member" style={{ background: '#6366f1', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontWeight: 600, fontSize: '14px', textDecoration: 'none', display: 'inline-block' }}>
                  Login to Continue
                </a>
              </div>
            )}
          </div>

        </main>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}

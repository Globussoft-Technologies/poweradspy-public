import React, { useState, useEffect, useRef, useCallback } from 'react';
import { publicSearchAds } from '../../services/api';
import MasonryCard from '../ads/MasonryCard';
import logo from '../../assets/poweradspy-logo.png';
import fbIcon from '../../assets/fb.png';
import igIcon from '../../assets/ig.png';
import ytIcon from '../../assets/yt.png';
import gIcon from '../../assets/g.png';
import gdnIcon from '../../assets/gdn.png';
import linkedinIcon from '../../assets/linkedin.png';
import nativeIcon from '../../assets/native.png';
import rdIcon from '../../assets/rd.png';
import quoraIcon from '../../assets/quora.png';
import pinterestIcon from '../../assets/pinterest.png';
import tiktokIcon from '../../assets/tiktoklogo.jpg';

const PLATFORMS = [
  { key: 'all',       label: 'ALL',       icon: null },
  { key: 'facebook',  label: 'Facebook',  icon: fbIcon },
  { key: 'instagram', label: 'Instagram', icon: igIcon },
  { key: 'youtube',   label: 'YouTube',   icon: ytIcon },
  { key: 'google',    label: 'Google',    icon: gIcon },
  { key: 'gdn',       label: 'GDN',       icon: gdnIcon },
  { key: 'native',    label: 'Native',    icon: nativeIcon },
  { key: 'linkedin',  label: 'LinkedIn',  icon: linkedinIcon },
  { key: 'reddit',    label: 'Reddit',    icon: rdIcon },
  { key: 'quora',     label: 'Quora',     icon: quoraIcon },
  { key: 'pinterest', label: 'Pinterest', icon: pinterestIcon },
  { key: 'tiktok',    label: 'TikTok',    icon: tiktokIcon },
];

const FILTERS = [
  'Engagement', 'Category', 'Call To Action', 'Language',
  'Gender', 'Age', 'Meta Ads Library', 'Verified Only',
  'Country', 'Ecommerce Platform',
];

const AMEMBER_LOGIN_URL =
  import.meta.env.VITE_AMEMBER_LOGIN_URL ||
  'https://app-dev.poweradspy.com/amember/member';

function formatNumber(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

export default function GuestLandingPage() {
  const [activePlatform, setActivePlatform] = useState('all');
  const [allAds, setAllAds]                 = useState([]);
  const [page, setPage]                     = useState(0);
  const [hasMore, setHasMore]               = useState(true);
  const [loading, setLoading]               = useState(false);
  const [initialLoad, setInitialLoad]       = useState(true);
  const [totalAds, setTotalAds]             = useState(null);
  const [limitReached, setLimitReached]     = useState(false);
  const fetchingRef = useRef(false);
  const loaderRef   = useRef(null);

  const loadAds = useCallback(async (pageNum) => {
    if (fetchingRef.current || limitReached) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const data = await publicSearchAds(pageNum);
      const newAds = data.ads || [];
      setAllAds(prev => pageNum === 0 ? newAds : [...prev, ...newAds]);
      setPage(pageNum + 1);
      if (data.guestLimitReached) {
        setHasMore(false);
        setLimitReached(true);
      } else {
        setHasMore(newAds.length > 0);
      }
      if (pageNum === 0 && data.meta?.total) {
        const t = data.meta.total;
        const sum = typeof t === 'object'
          ? Object.values(t).reduce((a, b) => a + (Number(b) || 0), 0)
          : Number(t) || 0;
        setTotalAds(sum);
      }
    } catch (e) {
      console.error('[GuestLandingPage] loadAds error', e);
    } finally {
      setLoading(false);
      setInitialLoad(false);
      fetchingRef.current = false;
    }
  }, [limitReached]);

  // Initial load
  useEffect(() => {
    loadAds(0);
  }, []);

  // Infinite scroll
  useEffect(() => {
    if (!loaderRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && hasMore && !limitReached) {
        loadAds(page);
      }
    }, { threshold: 0.1 });
    obs.observe(loaderRef.current);
    return () => obs.disconnect();
  }, [loading, hasMore, limitReached, page, loadAds]);

  // Filter ads by active platform
  const visibleAds = activePlatform === 'all'
    ? allAds
    : allAds.filter(ad => (ad.network || '').toLowerCase() === activePlatform);

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Header ── */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '0 24px', height: '56px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src={logo} alt="PowerAdSpy" style={{ height: 32 }} />
        </div>

        {/* Search bar — disabled */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: '#f3f4f6', borderRadius: '8px', padding: '8px 14px',
          color: '#9ca3af', fontSize: '13px', width: 320, cursor: 'not-allowed',
        }}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <span>Search keyword, advertiser, or domain...</span>
        </div>

        <a href={AMEMBER_LOGIN_URL} style={{
          background: '#6366f1', color: '#fff',
          padding: '8px 20px', borderRadius: '8px',
          fontWeight: 600, fontSize: '14px', textDecoration: 'none',
        }}>
          → Login
        </a>
      </header>

      <div style={{ display: 'flex' }}>

        {/* ── Sidebar ── */}
        <aside style={{
          width: 200, minWidth: 200, background: '#fff',
          borderRight: '1px solid #e5e7eb',
          minHeight: 'calc(100vh - 56px)',
          padding: '16px 0',
          position: 'sticky', top: 56,
          height: 'calc(100vh - 56px)', overflowY: 'auto',
        }}>
          <div style={{ padding: '4px 16px 12px', fontWeight: 700, fontSize: '15px', color: '#111827' }}>
            Filters
          </div>
          {FILTERS.map(f => (
            <div key={f} title="Login to use filters" style={{
              padding: '10px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              color: '#6b7280', fontSize: '14px',
              cursor: 'not-allowed', opacity: 0.55,
              borderBottom: '1px solid #f3f4f6',
            }}>
              <span>{f}</span>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </div>
          ))}
          <div style={{
            margin: '16px 12px', padding: '10px 12px',
            background: '#f0f0ff', borderRadius: '8px',
            textAlign: 'center', fontSize: '12px', color: '#6366f1', fontWeight: 500,
          }}>
            Login to use filters
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ flex: 1, padding: '12px 16px', minWidth: 0 }}>

          {/* Platform tabs */}
          <div style={{
            background: '#fff', borderRadius: '10px',
            padding: '6px 10px', marginBottom: '12px',
            display: 'flex', alignItems: 'center', gap: '2px',
            flexWrap: 'wrap', border: '1px solid #e5e7eb',
          }}>
            {PLATFORMS.map(p => {
              const active = activePlatform === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => setActivePlatform(p.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '6px 12px', borderRadius: '8px', border: 'none',
                    background: active ? '#6366f1' : 'transparent',
                    color: active ? '#fff' : '#374151',
                    fontWeight: active ? 700 : 500,
                    fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  {p.key === 'all' ? (
                    <span>ALL</span>
                  ) : (
                    <>
                      <img src={p.icon} alt={p.label} style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />
                      <span>{p.label}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', color: '#374151', fontWeight: 500 }}>
              Total Ads: <strong>{totalAds != null ? formatNumber(totalAds) : '—'}</strong>
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['Newest', 'Impressions', 'Popularity'].map(s => (
                <button key={s} title="Login to sort" style={{
                  padding: '6px 14px', borderRadius: '8px',
                  border: '1px solid #e5e7eb', background: '#fff',
                  fontSize: '13px', color: '#9ca3af',
                  cursor: 'not-allowed',
                }}>{s}</button>
              ))}
            </div>
          </div>

          {/* Ad grid */}
          {initialLoad ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} style={{
                  height: 320, background: '#e5e7eb', borderRadius: '12px',
                  animation: 'guestPulse 1.5s ease-in-out infinite',
                }} />
              ))}
            </div>
          ) : visibleAds.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', fontSize: '15px' }}>
              No ads found for this platform.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {visibleAds.map((ad, i) => (
                <MasonryCard
                  key={`${ad.id}-${i}`}
                  ad={ad}
                  isFavourite={false}
                  onToggleFavourite={() => {}}
                  onHideAd={() => {}}
                  onHideAdvertiser={() => {}}
                  onClick={() => {}}
                  onSearch={() => {}}
                  guest={true}
                />
              ))}
            </div>
          )}

          {/* Loader sentinel */}
          <div ref={loaderRef} style={{ textAlign: 'center', padding: '32px 0' }}>
            {loading && !initialLoad && (
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>Loading more ads...</span>
            )}
            {!loading && limitReached && visibleAds.length > 0 && (
              <div style={{
                background: '#fff', borderRadius: '16px', padding: '28px 24px',
                maxWidth: 420, margin: '0 auto', boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                border: '1px solid #e5e7eb',
              }}>
                <p style={{ fontWeight: 700, color: '#111827', fontSize: '16px', marginBottom: '8px' }}>
                  You've reached the guest limit
                </p>
                <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '20px' }}>
                  Login to view all {totalAds ? formatNumber(totalAds) : ''} ads and use advanced filters
                </p>
                <a href={AMEMBER_LOGIN_URL} style={{
                  display: 'inline-block',
                  background: '#6366f1', color: '#fff',
                  padding: '10px 28px', borderRadius: '8px',
                  fontWeight: 600, fontSize: '14px', textDecoration: 'none',
                }}>
                  Login to Continue
                </a>
              </div>
            )}
          </div>

        </main>
      </div>

      <style>{`
        @keyframes guestPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

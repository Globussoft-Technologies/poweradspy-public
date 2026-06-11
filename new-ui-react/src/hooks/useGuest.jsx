import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchDashboardState, fetchSharedAd, trackEvent } from '../services/api';

const GuestContext = createContext(null);

const LOGIN_URL =
  import.meta.env.VITE_AMEMBER_LOGIN_URL ||
  "https://app-dev.poweradspy.com/amember/login";

const SIGNUP_URL = import.meta.env.VITE_AMEMBER_SIGNUP_URL || '';

const ALL_PLATFORMS = [
  'facebook','instagram','youtube','google','gdn','native','linkedin','reddit','quora','pinterest','tiktok',
];

/**
 * GuestProvider — Wraps the app for guest/share routes.
 *
 * Three modes:
 * 1. guestToken     — dashboard share (multiple ads, stored filters)
 * 2. shareToken     — single ad share (one ad card)
 * 3. publicLanding  — no token, default ads for /guest-landing page
 *
 * All modes apply guest restrictions (toasters, no filter changes, etc.)
 */
export function GuestProvider({ guestToken, shareToken, publicLanding, children }) {
  const [uiState, setUiState] = useState(null);
  const [sharedAds, setSharedAds] = useState(null); // pre-loaded ads for share mode
  const [loading, setLoading] = useState(!publicLanding); // public landing needs no async fetch
  const [toastMessage, setToastMessage] = useState(null);
  const [showLoginPopup, setShowLoginPopup] = useState(false);

  // Check if user is already logged in (real token, not env fallback)
  const storedToken = localStorage.getItem('authToken');
  const envToken = import.meta.env.VITE_PAS_API_TOKEN;
  const isLoggedIn = !!storedToken && storedToken !== envToken;

  // Mode 3: Public landing — no token fetch, set all-platforms uiState immediately
  useEffect(() => {
    if (!publicLanding) return;
    setUiState({
      searchQuery: '',
      searchIn: 'keyword',
      exactSearch: false,
      filterValues: {},
      activePlatforms: ALL_PLATFORMS,
      specificPlatforms: [],
      sortBy: 'newest',
      activeTab: 'Newest',
    });
  }, [publicLanding]);

  // Mode 1: Dashboard guest share
  useEffect(() => {
    if (!guestToken) return;
    const load = async () => {
      setLoading(true);
      try {
        const result = await fetchDashboardState(guestToken);
        if (result.expired) {
          window.location.href = LOGIN_URL;
          return;
        }
        setUiState(result.uiState);
        trackEvent('guestView', { user_id: 'guest', network: 'NA' });
      } catch (err) {
        // Only redirect for expired (410) or not found (404)
        if (err.status === 410 || err.status === 404) {
          window.location.href = LOGIN_URL;
          return;
        }
        // Other errors (network, server down) — still show the page, just no data
        console.error('Guest dashboard load error:', err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [guestToken]);

  // Mode 2: Single ad share
  useEffect(() => {
    if (!shareToken) return;
    const load = async () => {
      setLoading(true);
      try {
        const result = await fetchSharedAd(shareToken);
        if (result.expired) {
          window.location.href = LOGIN_URL;
          return;
        }
        const ad = result.ad;
        const network = ad?.network || 'facebook';
        // Set UI state to select the right platform
        setUiState({
          searchQuery: '',
          searchIn: 'keyword',
          exactSearch: false,
          filterValues: {},
          activePlatforms: [network],
          specificPlatforms: [network],
          sortBy: 'newest',
          activeTab: 'Newest',
        });
        // Pre-load the single ad
        setSharedAds([ad]);
        trackEvent('guestView', { user_id: 'guest', ad_id: ad?.adId ?? ad?.id ?? 'NA', network });
      } catch (err) {
        if (err.status === 410 || err.status === 404) {
          window.location.href = LOGIN_URL;
          return;
        }
        console.error('Shared ad load error:', err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shareToken]);

  const showGuestWarning = useCallback((message) => {
    if (isLoggedIn) return false;
    setToastMessage(message || 'Please login to access this feature');
    setShowLoginPopup(true);
    return true;
  }, [isLoggedIn]);

  const closeLoginPopup = useCallback(() => {
    setShowLoginPopup(false);
    setToastMessage(null);
  }, []);

  /**
   * For logged-in users on guest/share pages:
   * Redirect to dashboard with the current interaction preserved.
   * Stores state in sessionStorage so dashboard can pick it up.
   */
  const redirectToDashboard = useCallback((stateOverrides = {}) => {
    sessionStorage.setItem('guestToDashboard', JSON.stringify(stateOverrides));
    window.location.href = '/';
  }, []);

  const isRestricted = isLoggedIn ? false : true;

  return (
    <GuestContext.Provider
      value={{
        isGuest: true,
        isPublicLanding: !!publicLanding,
        guestToken: guestToken || null,
        shareToken: shareToken || null,
        uiState,
        sharedAds,
        loading,
        isLoggedIn,
        isRestricted,
        showGuestWarning,
        redirectToDashboard,
        toastMessage,
        showLoginPopup,
        closeLoginPopup,
        loginUrl: LOGIN_URL,
        signupUrl: SIGNUP_URL,
      }}
    >
      {children}
    </GuestContext.Provider>
  );
}

/**
 * useGuest — Access guest context from any component.
 * Returns null when NOT in guest mode (normal app usage).
 */
export function useGuest() {
  return useContext(GuestContext);
}

import { useState, useEffect, useRef } from 'react';
import { getAuthToken } from '../hooks/useAuth';

const PAS_API_BASE = import.meta.env.VITE_PAS_API_BASE_URL || '';
const PAS_API_TOKEN = getAuthToken()  || import.meta.env.VITE_PAS_API_TOKEN;

// Maps network name → the ad ID field name expected by the backend
const NETWORK_AD_ID_FIELD = {
  facebook:  'facebook_ad_id',
  instagram: 'instagram_ad_id',
  youtube:   'youtube_ad_id',
  google:    'google_text_ad_id',
  gdn:       'gdn_ad_id',
  native:    'native_ad_id',
  linkedin:  'linkedin_ad_id',
  reddit:    'reddit_ad_id',
  quora:     'quora_ad_id',
  pinterest: 'pinterest_ad_id',
  tiktok:    'tiktok_ad_id',
};

/**
 * Custom hook to fetch ad insights via SSE streaming.
 * Sends the ad's network in the payload so the backend routes to the correct handler.
 * Returns progressively loaded data as each event arrives.
 */
export function useAdInsights(adId, network = 'facebook', userId = 281, language = 'en', postOwnerId = null) {
  const [insights, setInsights] = useState({
    adDetails: null,
    analytics: null,
    lcs: null,
    advertiserLCSData: null,
    outgoingLinks: null,
    userData: null,
    advertiserUserData: null,
    country: null,
    advertiserCountryData: null,
    pageDetails: null,
    targetSite: null,
  });
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [notFoundForId, setNotFoundForId] = useState(null);
  const [errors, setErrors] = useState({});
  const abortRef = useRef(null);

  useEffect(() => {
    if (!adId) return;

    // Reset state for new ad
    setInsights({
      adDetails: null,
      analytics: null,
      lcs: null,
      advertiserLCSData: null,
      outgoingLinks: null,
      userData: null,
      advertiserUserData: null,
      country: null,
      advertiserCountryData: null,
      pageDetails: null,
      targetSite: null,
    });
    setErrors({});
    setNotFound(false);
    setNotFoundForId(null);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch(`${PAS_API_BASE}/api/v1/common/ads/getAdInsights`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${PAS_API_TOKEN}`,
          },
          body: JSON.stringify({
            network: (network || 'facebook').toLowerCase(),
            [NETWORK_AD_ID_FIELD[(network || 'facebook').toLowerCase()] || 'facebook_ad_id']: adId,
            user_id: userId,
            language,
            // ...(postOwnerId ? { post_owner_id: postOwnerId } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          setLoading(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop(); // keep incomplete chunk

          for (const part of parts) {
            const lines = part.split('\n');
            const eventLine = lines.find(l => l.startsWith('event:'));
            const dataLine = lines.find(l => l.startsWith('data:'));
            if (!eventLine || !dataLine) continue;

            const event = eventLine.slice(7).trim();
            const data = dataLine.slice(6).trim();

            if (event === 'done') {
              setLoading(false);
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              // Map backend event names that differ from our state keys
              // Instagram sends "adsLibUserData" for advertiser-level demographics
              const stateKey = event === 'adsLibUserData' ? 'advertiserUserData' : event;

              if (parsed.code === 200 && parsed.data != null) {
                setInsights(prev => ({
                  ...prev,
                  [stateKey]: parsed.data,
                  [`${stateKey}Meta`]: parsed,
                }));
              } else {
                if (stateKey === 'adDetails') { setNotFound(true); setNotFoundForId(adId); }
                // Set empty array/object so components show "No data" instead of stuck on "Loading..."
                setInsights(prev => ({ ...prev, [stateKey]: Array.isArray(parsed.data) ? [] : (parsed.data === null ? [] : parsed.data) }));
                setErrors(prev => ({ ...prev, [stateKey]: parsed.message || 'No data' }));
              }
            } catch {
              // ignore parse errors
            }
          }
        }

        setLoading(false);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [adId, network, userId, language]);

  return { insights, loading, notFound, notFoundForId, errors };
}

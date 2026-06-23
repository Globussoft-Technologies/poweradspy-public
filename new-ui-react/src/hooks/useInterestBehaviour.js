import { useState, useEffect, useRef } from 'react';
import { getAuthToken } from './useAuth';

// External targeting service — called DIRECTLY from the browser so the request is
// visible in the Network tab. CORS is open on this service and it expects the
// user's JWT in the `token` header (same token the app already holds).
const TARGETING_BASE = import.meta.env.VITE_INTEREST_BEHAVIOUR_URL || 'https://ad-intnbeh.poweradspy.ai';
const PAS_API_BASE = import.meta.env.VITE_PAS_API_BASE_URL || '';

const SUPPORTED = ['facebook', 'instagram'];

// platform header tells the targeting service which backend to query.
// Override with VITE_INTEREST_BEHAVIOUR_ENV=prod|dev, else infer from the build.
function platformTag(network) {
  const net = (network || '').toLowerCase();
  if (!SUPPORTED.includes(net)) return null;
  const override = import.meta.env.VITE_INTEREST_BEHAVIOUR_ENV;
  const isProd = override ? override === 'prod' : import.meta.env.PROD;
  return `${net}_${isProd ? 'prod' : 'dev'}`;
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  return [v];
}

/**
 * Resolve an ad's interests/behaviours for the Target Audience panel.
 *
 * 1. ES cache hit — if `adDetails` already carries interests/behaviours, use them
 *    directly (no external call).
 * 2. Cache miss — once `adDetails` has loaded without them, call the targeting API
 *    DIRECTLY from the browser (visible in the Network tab), then fire-and-forget
 *    cache the result back into ES via the backend `store-bahaviour-data` endpoint
 *    (so the next open is a cache hit — same behaviour as the old server-side flow).
 *
 * Returns { interests, behaviours, confidenceScore, loading, source }.
 */
export function useInterestBehaviour({ adId, network, adDetails }) {
  const [state, setState] = useState({
    interests: [], behaviours: [], confidenceScore: null, loading: false, source: null,
  });
  const abortRef = useRef(null);

  const esInterests = toArray(adDetails?.interests);
  const esBehaviours = toArray(adDetails?.behaviours);
  const adDetailsLoaded = adDetails != null;

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    setState({ interests: [], behaviours: [], confidenceScore: null, loading: false, source: null });

    if (!adId) return;
    const platform = platformTag(network);
    if (!platform) return; // unsupported network — section won't render anyway

    // 1. ES cache hit
    if (esInterests.length || esBehaviours.length) {
      setState({
        interests: esInterests,
        behaviours: esBehaviours,
        confidenceScore: adDetails?.confidence_score ?? null,
        loading: false,
        source: 'es',
      });
      return;
    }

    // Don't decide "miss" until adDetails has actually arrived.
    if (!adDetailsLoaded) return;

    // 2. Cache miss → call the targeting API directly from the browser.
    const controller = new AbortController();
    abortRef.current = controller;
    setState((s) => ({ ...s, loading: true }));

    const token = getAuthToken() || import.meta.env.VITE_PAS_API_TOKEN;

    (async () => {
      try {
        const res = await fetch(`${TARGETING_BASE}/targeting/get-data`, {
          method: 'GET',
          headers: { accept: 'application/json', ad_id: String(adId), platform, token },
          signal: controller.signal,
        });
        const body = await res.json().catch(() => ({}));

        // Auth / no-data → show nothing (mirrors the server-side classification).
        const msg = String(body?.message || '').toLowerCase();
        const authFailed = res.status === 401 || res.status === 403 || msg.includes('auth') || msg.includes('token');
        if (authFailed || body?.success === false || (body?.status_code && body.status_code !== 200)) {
          setState({ interests: [], behaviours: [], confidenceScore: null, loading: false, source: 'none' });
          return;
        }

        const d = body?.data || {};
        const interests = toArray(d.interests);
        const behaviours = toArray(d.behaviors);
        const confidenceScore = d.confidence_score ?? null;

        setState({
          interests, behaviours, confidenceScore, loading: false,
          source: (interests.length || behaviours.length) ? 'api' : 'none',
        });

        // 3. Fire-and-forget cache back to ES (write-once on the backend).
        if (interests.length || behaviours.length) {
          fetch(`${PAS_API_BASE}/api/v1/common/store-bahaviour-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              adId,
              network: (network || '').toLowerCase(),
              interestBehaviour: { interests, behaviors: behaviours, confidence_score: confidenceScore },
            }),
          }).catch(() => {});
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setState({ interests: [], behaviours: [], confidenceScore: null, loading: false, source: 'error' });
        }
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adId, network, adDetailsLoaded, esInterests.length, esBehaviours.length]);

  return state;
}

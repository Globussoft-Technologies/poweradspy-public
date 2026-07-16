// ─── AI Search service ──────────────────────────────────────────────────────
// Thin client for the node API's AI-search proxy (/api/v1/ai-search/*), which in
// turn fronts the DS team's payload-generation service. We deliberately talk to
// OUR backend (behind JWT), never the DS endpoint directly — so this reuses the
// same PAS API base + bearer-token convention as services/api.js.

import { getAuthToken } from '../hooks/useAuth';
import { handle401 } from './api';

const PAS_API_BASE = import.meta.env.VITE_PAS_API_BASE_URL || '';
const getPASToken = () => getAuthToken() || import.meta.env.VITE_PAS_API_TOKEN;
const authHeaders = () => (getPASToken() ? { Authorization: `Bearer ${getPASToken()}` } : {});

/**
 * Plan a natural-language prompt into a fallback payload set.
 * The backend performs the DS two-step (init → fetch) and returns the full set.
 *
 * @param {string} prompt
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ ref_id: string, prompt: string, payloads: Array<{label: string, args: object}>, model: string, usage: object }>}
 * @throws {Error} on non-200 (message carries the backend's reason)
 */
export async function planAiSearch(prompt, { signal } = {}) {
  const res = await fetch(`${PAS_API_BASE}/api/v1/ai-search/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (res.status === 401) {
    handle401();
    throw new Error('Unauthorized');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.code !== 200 || !json.data) {
    throw new Error(json?.message || `AI search failed (${res.status})`);
  }
  return json.data;
}

/**
 * Check whether the AI-search upstream is healthy. NEVER throws — resolves to
 * { ok:false } on any error so the caller can simply hide the feature.
 *
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ ok: boolean, status?: string }>}
 */
export async function checkAiSearchHealth({ signal } = {}) {
  try {
    const res = await fetch(`${PAS_API_BASE}/api/v1/ai-search/health`, {
      headers: { ...authHeaders() },
      signal,
    });
    if (!res.ok) return { ok: false };
    const json = await res.json().catch(() => null);
    return json?.data || { ok: false };
  } catch {
    return { ok: false };
  }
}

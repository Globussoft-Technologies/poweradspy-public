import { useEffect, useState } from 'react';
import { getImageGenJob } from '../services/api';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const POLL_MS = 2500;

/**
 * Polls GET /api/v1/imageGen/jobs/:id every POLL_MS until the job reaches a
 * terminal status, then stops. Unlike useSDUIPolling.js (which polls forever
 * on a fixed version-check), a Recreate job has a natural end — the backend's
 * own poll-until-terminal design (see pas_node_api/docs/imageGen/MANIFEST.md)
 * mirrors directly into this hook's stop condition.
 *
 * @param {string|null} jobId - pass null/undefined to stop polling (modal closed).
 * @returns {{status: 'idle'|'loading'|'queued'|'running'|'succeeded'|'failed'|'cancelled', job: Object|null, error: string|null}}
 */
export function useImageGenJobPoll(jobId) {
  const [state, setState] = useState({ status: 'idle', job: null, error: null });

  useEffect(() => {
    if (!jobId) {
      setState({ status: 'idle', job: null, error: null });
      return undefined;
    }

    let cancelled = false;
    let intervalId = null;
    setState({ status: 'loading', job: null, error: null });

    const poll = async () => {
      try {
        const res = await getImageGenJob(jobId);
        if (cancelled) return;
        const job = res?.data;
        if (!job) return;
        setState({ status: job.status, job, error: null });
        if (TERMINAL.has(job.status) && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } catch (err) {
        if (cancelled) return;
        // A transient poll failure shouldn't kill the UI — keep the last known
        // state, just surface the error; the next tick tries again.
        setState((prev) => ({ ...prev, error: err.message }));
      }
    };

    poll(); // immediate first check, don't wait a full interval to show "queued"
    intervalId = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [jobId]);

  return state;
}

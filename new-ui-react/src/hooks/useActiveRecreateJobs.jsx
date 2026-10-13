import { useRef, useCallback } from 'react';
import { getImageGenJob } from '../services/api';
import { useImageGenCredits } from './useImageGenCredits';

const POLL_MS = 2500;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * Tracks Recreate jobs' completion toast INDEPENDENTLY of any single
 * RecreateModal instance's lifecycle. Mounted once at the App root (not
 * inside RecreateModal), so its tracking survives the exact thing that broke
 * the in-modal toast: closing the modal and then reopening it for a
 * different ad — RecreateModal.jsx's own "reset on open" effect wipes its
 * `jobId` state every time it opens for a (possibly different) ad, which
 * silently killed the first job's poll-and-toast if the user started a
 * second Recreate before the first one finished. The bell notification
 * (separate backend-driven feed) and MySpace itself were never affected —
 * only this in-app toast was, because it was the only thing actually living
 * inside the component instance that gets reset.
 *
 * RecreateModal calls `trackJob(jobId)` (via its existing `onJobStarted`
 * prop) the moment a generation starts; this hook polls that job to a
 * terminal status on its own and fires the toast, same copy as before.
 */
export function useActiveRecreateJobs({ onShowToast, onViewMySpace }) {
  const trackedRef = useRef(new Set());
  const { refresh: refreshCredits } = useImageGenCredits();

  const trackJob = useCallback((jobId) => {
    if (!jobId || trackedRef.current.has(jobId)) return;
    trackedRef.current.add(jobId);

    let cancelled = false;
    let intervalId = null;

    const stop = () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      trackedRef.current.delete(jobId);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await getImageGenJob(jobId);
        if (cancelled) return;
        const job = res?.data;
        if (!job || !TERMINAL.has(job.status)) return;
        stop();
        refreshCredits(); // reconcile the shared balance with the server's finalized/refunded value

        if (job.status === 'succeeded') {
          onShowToast?.(
            <span className="flex items-center gap-2">
              Image added to MySpace
              <button onClick={() => onViewMySpace?.()} className="underline font-bold hover:opacity-80">
                View
              </button>
            </span>,
            'success',
          );
        } else {
          onShowToast?.(
            <span className="flex items-center gap-2">
              {job?.error?.user_message || 'Could not generate image.'} Credit refunded.
              <button onClick={() => onViewMySpace?.()} className="underline font-bold hover:opacity-80">
                View
              </button>
            </span>,
            'error',
          );
        }
      } catch {
        // transient poll failure — next tick retries, same posture as useImageGenJobPoll.js
      }
    };

    poll(); // immediate first check
    intervalId = setInterval(poll, POLL_MS);
  }, [onShowToast, onViewMySpace, refreshCredits]);

  return { trackJob };
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  useFloating, offset, flip, shift, size, autoUpdate,
  FloatingPortal, useClick, useDismiss, useInteractions,
} from '@floating-ui/react';
import {
  X, Loader2, Sparkle, RefreshCw, AlertCircle, Download,
  Upload, Link2, ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2, Check, Lock,
} from 'lucide-react';
import he from 'he';
import { recreateImage, uploadImageGenProductImage, deleteImageGenUpload } from '../../services/api';
import { useImageGenJobPoll } from '../../hooks/useImageGenJobPoll';
import { useImageGenCredits } from '../../hooks/useImageGenCredits';
import { AD_TYPE_BADGES } from '../../constants';
import '../shared/floating-popover.css';

// Matches pas_node_api config.json's imageGen.aspectRatios (Ad Studio's supported set).
const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
// Display order + hints — the 8 from the design spec, plus 5:4/21:9 (both
// real config-supported ratios, see ASPECT_RATIOS) given the same style of
// hint rather than rendering with none, each placed next to its closest
// sibling ratio: 5:4 by 4:3 (both near-square landscape stills), 21:9 by
// 16:9 (both widescreen).
const ASPECT_ORDER = ['1:1', '4:5', '9:16', '16:9', '21:9', '3:4', '4:3', '5:4', '2:3', '3:2'];
const ASPECT_HINTS = {
  '1:1': 'Square · Feed',
  '4:5': 'Portrait · Feed',
  '9:16': 'Stories · Reels',
  '16:9': 'Landscape · YouTube',
  '21:9': 'Cinematic · Ultra-wide',
  '3:4': 'Portrait',
  '4:3': 'Landscape',
  '5:4': 'Landscape · Classic photo',
  '2:3': 'Pinterest',
  '3:2': 'Landscape',
};
const MAX_UPLOAD_MB = 10;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_EXTRA_IMAGES = 3;
const MAX_PROMPT_LEN = 1000;

const QUICK_PROMPTS = [
  { label: 'New headline', text: 'Give it a fresh, attention-grabbing headline.' },
  { label: 'Use my brand colors', text: 'Use my brand colors throughout the creative.' },
  { label: 'Swap background', text: 'Swap the background for something more eye-catching.' },
  { label: 'Add a price tag', text: 'Add a price tag or discount badge.' },
];

/** Reads a local image File's pixel dimensions via a throwaway <img>. */
function readImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Finds the ASPECT_RATIOS entry closest to a measured width/height — used to
 * label the reference ad's own ratio as "Original (…)" instead of guessing. */
function closestAspectRatio(width, height) {
  if (!width || !height) return null;
  const target = width / height;
  let best = null;
  let bestDiff = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const diff = Math.abs(w / h - target);
    if (diff < bestDiff) { bestDiff = diff; best = ratio; }
  }
  return best;
}

/** Fits a W:H ratio inside a 352×440 box without stretching/cropping it —
 * the real size for the .stage's inner .img, so the loader/result/error box
 * is only ever as big as the actual image it's framing (never the full
 * 460px-tall .stage, which is what let the loader overlay bleed outside its
 * box and overlap the reference ad). */
function computeStageImgSize(ratio, maxW = 352, maxH = 440) {
  const [w, h] = (ratio || '1:1').split(':').map(Number);
  let width = maxW;
  let height = (maxW * h) / w;
  if (height > maxH) {
    height = maxH;
    width = (maxH * w) / h;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** A small rectangle outline shaped to the actual W:H ratio — matches the
 * design's per-ratio icon sizing (1:1 is a special-cased 16×16 square; every
 * other ratio's longest side is 18px, per the spec's icon size table). */
function AspectRatioIcon({ ratio, className }) {
  const [w, h] = (ratio || '1:1').split(':').map(Number);
  let width, height;
  if (w === h) { width = 16; height = 16; } else {
    const box = 18;
    width = w >= h ? box : Math.max(6, Math.round(box * (w / h)));
    height = h >= w ? box : Math.max(6, Math.round(box * (h / w)));
  }
  return <span className={`rcp-rb ${className || ''}`} style={{ width, height }} />;
}

/**
 * AI Recreate modal — full state machine per the design spec:
 *   idle (3a empty / 3b filled / 3f no-credits) --Generate--> generating (3c)
 *   generating --success--> done (3d) / --error--> failed (3e, credit auto-refunded)
 *   failed --Try again--> generating (same inputs) / --Edit inputs--> idle (inputs kept)
 *   done --Regenerate--> generating (same inputs) / --Open in MySpace--> navigate
 *   generating --Close--> modal hides, job keeps running (component never unmounts —
 *     see App.jsx, isOpen only toggles the returned body), toast fires on completion.
 *
 * @param {boolean} isOpen
 * @param {Object|null} ad - the ad being recreated; needs `network` + `adId` (or `id`).
 * @param {() => void} onClose
 * @param {(message:React.ReactNode, type?:string) => void} [onShowToast] - App.jsx's showToast.
 * @param {() => void} [onViewMySpace] - navigates to /my-space.
 * @param {() => void} [onUpgrade] - opens the plan-upgrade flow (3f banner).
 */
const RecreateModal = ({ isOpen, ad, onClose, onShowToast, onViewMySpace, onUpgrade, onJobStarted }) => {
  const [originalRatio, setOriginalRatio] = useState(null); // measured from the reference ad's own image
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [aspectOpen, setAspectOpen] = useState(false);
  const [aspectFocusIndex, setAspectFocusIndex] = useState(0);
  const aspectListRef = useRef(null); // scrolls the selected option into view when the menu opens
  // true once the reference ad's real ratio has been auto-applied to aspectRatio
  // this modal session — guards against re-applying it (and clobbering a manual
  // pick) every time the reference <img> re-renders in a different state.
  const originalRatioAppliedRef = useRef(false);

  // Portals the aspect-ratio menu to document.body, position:fixed, positioned
  // from the trigger's real rect — flips above when there's no room below,
  // tracks the trigger on any scroll/resize (autoUpdate), and its own size()
  // middleware caps maxHeight to whatever space is actually available instead
  // of ever growing the modal/page. This is what stopped the dropdown from
  // making the whole modal scroll.
  const { refs: aspectRefs, floatingStyles: aspectFloatingStyles, context: aspectFloatingContext, isPositioned: aspectIsPositioned, x: aspectX, y: aspectY } = useFloating({
    open: aspectOpen,
    onOpenChange: setAspectOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, rects, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.min(360, availableHeight)}px`,
            width: `${rects.reference.width}px`,
          });
        },
      }),
    ],
  });
  // useClick is what actually toggles `open` on click — useDismiss alone only
  // handles closing (outside click / Escape), it was never wired to opening.
  const aspectClick = useClick(aspectFloatingContext);
  const aspectDismiss = useDismiss(aspectFloatingContext);
  const { getReferenceProps: getAspectReferenceProps, getFloatingProps: getAspectFloatingProps } = useInteractions([aspectClick, aspectDismiss]);
  const aspectPositioned = typeof aspectIsPositioned === 'boolean' ? aspectIsPositioned : aspectX != null && aspectY != null;

  const [productImage, setProductImage] = useState(null); // { previewUrl, url, uploading, error, name, sizeLabel, dims }
  const [extraImages, setExtraImages] = useState([]); // [{ previewUrl, url, uploading }]
  const [brandWebsite, setBrandWebsite] = useState('');
  const [prompt, setPrompt] = useState('');
  // Which carousel slide is the reference image, when `ad.carouselImages` (set by
  // MasonryCard.jsx when Recreate is clicked on a carousel ad) has more than one.
  const [slideIndex, setSlideIndex] = useState(0);

  const [jobId, setJobId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // { used, total, left, refreshDate } — only for the 3f banner's real numbers;
  // the shared balance (header/cards) still comes from useImageGenCredits().
  const [creditsDetail, setCreditsDetail] = useState(null);

  const productInputRef = useRef(null);
  const extraInputRef = useRef(null);
  const promptRef = useRef(null);

  // Lock page scroll behind the modal while it's open — restores whatever the
  // body's own overflow value was before (not a blind reset to ''), in case
  // something else on the page also manages it.
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [isOpen]);

  const { status: pollStatus, job } = useImageGenJobPoll(jobId);
  const { balance, summary: creditsSummary, decrementOptimistic, restore, refresh } = useImageGenCredits();
  // Guards the terminal-status toast/refresh from firing more than once per job —
  // reset to false every time a NEW job starts (Try again/Regenerate reuse this
  // same component instance), not just once on modal open.
  const notifiedTerminalRef = useRef(false);
  const reservedBalanceRef = useRef(undefined); // balance to restore to if this job fails

  // Detail line (used/total/refresh date) follows the shared summary, so it
  // moves together with the header and every other credits view.
  useEffect(() => {
    if (!creditsSummary) return;
    setCreditsDetail({ used: creditsSummary.used_this_cycle, total: creditsSummary.monthly_quota, left: creditsSummary.balance, refreshDate: creditsSummary.cycle_resets_at });
  }, [creditsSummary]);
  const refreshCreditsDetail = useCallback(() => { refresh(); }, [refresh]);

  // Reset all in-modal state whenever it's opened for a (possibly different) ad.
  useEffect(() => {
    if (isOpen) {
      // Clean up an abandoned, never-submitted upload from whatever was in the
      // form before this reset (e.g. user uploaded a product image, then opened
      // Recreate for a different ad without generating). Once jobId was set,
      // these urls are referenced by a job doc instead and must NOT be deleted.
      if (!jobId) {
        if (productImage?.isFreshUpload && productImage?.url) deleteImageGenUpload(productImage.url).catch(() => {});
        extraImages.forEach((img) => { if (img.isFreshUpload && img.url) deleteImageGenUpload(img.url).catch(() => {}); });
      }
      setOriginalRatio(null);
      setAspectRatio(ad?.recreateDefaults?.aspectRatio || '1:1');
      setAspectOpen(false);
      const defaults = ad?.recreateDefaults;
      setProductImage(defaults?.productImageUrl ? {
        previewUrl: defaults.productImageUrl,
        url: defaults.productImageUrl,
        uploading: false,
        error: null,
        name: defaults.productImage?.name || 'Product image',
        fileSize: defaults.productImage?.size_bytes || null,
        sizeLabel: formatFileSize(defaults.productImage?.size_bytes),
        dims: defaults.productImage?.width && defaults.productImage?.height
          ? { width: defaults.productImage.width, height: defaults.productImage.height }
          : null,
      } : null);
      setExtraImages((defaults?.extraImageUrls || []).map((url) => ({ previewUrl: url, url, uploading: false, error: null })));
      setBrandWebsite(defaults?.brandWebsite || '');
      setPrompt(defaults?.prompt || '');
      // Start on whichever slide the user was actually viewing in the masonry
      // card (ad.carouselIndex), falling back to 0 (e.g. a MySpace "Recreate
      // again" doesn't carry carousel info at all).
      setSlideIndex(Math.max(0, ad?.carouselIndex || 0));
      setJobId(null);
      setSubmitting(false);
      setSubmitError(null);
      notifiedTerminalRef.current = false;
      // A MySpace "Recreate again" carries its saved output ratio. Do not let
      // the reference thumbnail's natural ratio overwrite that prefill on load.
      originalRatioAppliedRef.current = !!defaults?.aspectRatio;
      refreshCreditsDetail();
    }
  }, [isOpen, ad, refreshCreditsDetail]);

  // Auto-grow the prompt textarea with its content instead of scrolling inside
  // a fixed-height box.
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt, isOpen]);

  // Measures the reference ad's real ratio off the actual <img> that's on
  // screen (via its onLoad, wired below) — NOT a separate throwaway
  // `new Image()` fetching the same URL a second time. That side-channel
  // version was the bug: a second fetch of the same resource is unreliable
  // (can race, get throttled, or silently never fire its own onload independent
  // of whether the real <img> rendered fine), which is why the ratio kept
  // falling back to the unmeasured '1:1' default — correct in isolation, wrong
  // for almost every real (non-square) ad creative, and why `object-cover`
  // then visibly cropped the image into that wrong box. Sets originalRatio on
  // every load (safe/idempotent — referenceAdImg renders in multiple states)
  // but only auto-applies it to `aspectRatio` once per modal-open session, so
  // it never overwrites the user's own ratio pick.
  const handleReferenceImageLoad = useCallback((e) => {
    const ratio = closestAspectRatio(e.target.naturalWidth, e.target.naturalHeight);
    if (!ratio) return;
    setOriginalRatio(ratio);
    if (!originalRatioAppliedRef.current) {
      originalRatioAppliedRef.current = true;
      setAspectRatio(ratio);
    }
  }, []);

  // Scrolls the currently-selected ratio into view the moment the menu opens
  // (keyboard users and anyone with >8 options shouldn't have to hunt for it).
  useEffect(() => {
    if (!aspectOpen) return;
    const id = requestAnimationFrame(() => {
      aspectListRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [aspectOpen]);

  // Settle the optimistic credit exactly once per job, when THIS modal's own
  // poll reaches a terminal status while it's still watching this jobId.
  //
  // The completion TOAST itself is intentionally NOT fired here anymore — it
  // moved to useActiveRecreateJobs (mounted once in App.jsx). Reason: the
  // effect right above this one resets `jobId` to null every time the modal
  // opens (`isOpen` flips true), including reopening it for a different ad
  // while an earlier job is still generating. That silently killed this job's
  // own poll (useImageGenJobPoll(null) stops immediately), so its completion
  // toast never fired even though the backend — and the header bell, which is
  // driven independently — handled it correctly. The app-level tracker has no
  // such reset, so it survives exactly that scenario.
  useEffect(() => {
    if (!jobId || notifiedTerminalRef.current) return;
    if (pollStatus === 'succeeded') {
      notifiedTerminalRef.current = true;
      refresh(); // reconcile with the server's real (finalized) balance
      refreshCreditsDetail();
    } else if (pollStatus === 'failed' || pollStatus === 'cancelled') {
      notifiedTerminalRef.current = true;
      restore(reservedBalanceRef.current);
      refreshCreditsDetail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollStatus, jobId]);

  // Revoke local object URLs on unmount/reset so they don't leak.
  useEffect(() => () => {
    if (productImage?.previewUrl) URL.revokeObjectURL(productImage.previewUrl);
    extraImages.forEach((img) => img.previewUrl && URL.revokeObjectURL(img.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const validateFile = (file) => {
    if (!ALLOWED_TYPES.includes(file.type)) return 'Please upload a JPG, PNG, or WEBP image.';
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `Image exceeds the ${MAX_UPLOAD_MB}MB limit.`;
    return null;
  };

  const handleProductFile = useCallback(async (file) => {
    if (!file) return;
    const error = validateFile(file);
    if (error) { setProductImage({ previewUrl: null, url: null, uploading: false, error }); return; }
    const previewUrl = URL.createObjectURL(file);
    const dims = await readImageDimensions(file);
    setProductImage((prev) => {
      // Replacing an already-uploaded (and never-submitted) image — queue its
      // NAS cleanup same as an explicit remove, so "Replace" doesn't leak it.
      if (prev?.isFreshUpload && prev?.url) deleteImageGenUpload(prev.url).catch(() => {});
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return {
        previewUrl, url: null, uploading: true, error: null,
        name: file.name, fileSize: file.size, sizeLabel: formatFileSize(file.size), dims, isFreshUpload: true,
      };
    });
    try {
      const res = await uploadImageGenProductImage(file);
      setProductImage((prev) => (prev?.previewUrl === previewUrl
        ? { ...prev, url: res?.data?.url || null, uploading: false, error: res?.data?.url ? null : 'Upload failed. Please try again.' }
        : prev));
    } catch (err) {
      setProductImage((prev) => (prev?.previewUrl === previewUrl
        ? { ...prev, url: null, uploading: false, error: err.message || 'Upload failed. Please try again.' }
        : prev));
    }
  }, []);

  const handleExtraFiles = useCallback(async (files) => {
    const room = MAX_EXTRA_IMAGES - extraImages.length;
    const toAdd = Array.from(files).slice(0, room);
    for (const file of toAdd) {
      const error = validateFile(file);
      const previewUrl = error ? null : URL.createObjectURL(file);
      const entry = { previewUrl, url: null, uploading: !error, error, isFreshUpload: true };
      setExtraImages((prev) => [...prev, entry]);
      if (error) continue;
      try {
        const res = await uploadImageGenProductImage(file);
        setExtraImages((prev) => prev.map((img) => (
          img === entry ? { ...img, uploading: false, url: res?.data?.url || null, error: res?.data?.url ? null : 'Upload failed.' } : img
        )));
      } catch (err) {
        setExtraImages((prev) => prev.map((img) => (
          img === entry ? { ...img, uploading: false, error: err.message || 'Upload failed.' } : img
        )));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraImages.length]);

  // Pasting a screenshot/copied image into the prompt box attaches it as an
  // extra reference image (same upload path as the "+" picker) instead of
  // doing nothing — clipboard image items have no filename, just raw bytes.
  const handlePromptPaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = Array.from(items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      handleExtraFiles(files);
    }
  }, [handleExtraFiles]);

  const removeExtraImage = (idx) => {
    setExtraImages((prev) => {
      const target = prev[idx];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (target?.isFreshUpload && target?.url) deleteImageGenUpload(target.url).catch(() => {});
      return prev.filter((_, i) => i !== idx);
    });
  };

  const appendQuickPrompt = (text) => {
    setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text).slice(0, MAX_PROMPT_LEN));
  };

  if (!isOpen || !ad) return null;

  const noCreditsAvailable = typeof balance === 'number' && balance <= 0;
  const cost = 1; // imageGen.creditCostPerGeneration — displayed only, enforced server-side
  const productReady = !!productImage?.url && !productImage?.uploading;
  const promptReady = prompt.trim().length > 0;
  const canGenerate = productReady && promptReady && !submitting && !noCreditsAvailable;

  const handleGenerate = async () => {
    if (submitting || !canGenerate) return; // guards a double-click / incomplete form from firing
    setSubmitting(true);
    setSubmitError(null);
    reservedBalanceRef.current = decrementOptimistic(1);
    try {
      const res = await recreateImage({
        network: ad.network,
        adId: ad.adId ?? ad.id,
        aspectRatio,
        prompt: prompt.trim(),
        productImageUrl: productImage.url,
        productImage: {
          name: productImage.name,
          size_bytes: productImage.fileSize || null,
          width: productImage.dims?.width || null,
          height: productImage.dims?.height || null,
        },
        extraImageUrls: extraImages.map((img) => img.url).filter(Boolean),
        brandWebsite: brandWebsite.trim() || undefined,
        sourceAdvertiser: ad.advertiser || undefined,
        sourceRunningDays: ad.runningDays,
        // Only set for carousel ads (carouselSlides.length > 1) — a plain image
        // ad has nothing to pick between, so the backend just uses its default.
        sourceImageUrl: carouselSlides.length > 1 ? referenceImageUrl : undefined,
      });
      if (res.httpStatus === 402 || res.status === 'no_credits') {
        restore(reservedBalanceRef.current);
        refreshCreditsDetail();
        setSubmitError(res.message || 'Not enough credits.');
        onShowToast?.(res.message || 'Not enough credits.', 'error');
        return;
      }
      if (res.httpStatus >= 400 || res.status === 'rejected' || res.status === 'server_error') {
        restore(reservedBalanceRef.current);
        setSubmitError(res.message || 'Could not start generation.');
        onShowToast?.(res.message || 'Could not start generation.', 'error');
        return;
      }
      notifiedTerminalRef.current = false; // this is a fresh job — allow its own terminal toast
      const newJobId = res.data?.job_id || null;
      setJobId(newJobId);
      if (newJobId) onJobStarted?.(newJobId);
    } catch (err) {
      restore(reservedBalanceRef.current);
      setSubmitError(err.message || 'Could not start generation.');
      onShowToast?.(err.message || 'Could not start generation.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // failed --Try again--> generating (same inputs, fresh submission + credit spend)
  const handleTryAgain = () => handleGenerate();
  // done --Regenerate--> generating (same inputs)
  const handleRegenerate = () => handleGenerate();
  // failed --Edit inputs--> idle (inputs kept, NOT resubmitted)
  const handleEditInputs = () => { setJobId(null); setSubmitError(null); };

  const isGenerating = jobId && (pollStatus === 'loading' || pollStatus === 'queued' || pollStatus === 'running');
  const isDone = jobId && pollStatus === 'succeeded';
  const isFailed = jobId && (pollStatus === 'failed' || pollStatus === 'cancelled');
  const isForm = !isGenerating && !isDone && !isFailed;

  // Closing while a job is still generating: the job keeps running in the
  // background (component never unmounts, poll keeps going — see the class
  // comment above), but closing is otherwise silent, so confirm it with an
  // immediate toast rather than leaving the user wondering if anything's
  // still happening. The real completion toast (success/fail, with its own
  // "View" link) fires separately when the poll actually reaches a terminal
  // status — this one is just the "we've got it" acknowledgement.
  const handleCloseModal = () => {
    if (isGenerating) {
      onShowToast?.("Still generating — we'll notify you when it's ready.", 'info');
    } else if (!jobId) {
      // Closing without ever submitting — any fresh uploads in the form right
      // now are otherwise unreferenced (no job doc points at them), so queue
      // their NAS cleanup instead of leaking them until/unless this modal
      // happens to reopen for another ad later.
      if (productImage?.isFreshUpload && productImage?.url) deleteImageGenUpload(productImage.url).catch(() => {});
      extraImages.forEach((img) => { if (img.isFreshUpload && img.url) deleteImageGenUpload(img.url).catch(() => {}); });
    }
    onClose();
  };
  const resultImage = job?.result?.images?.[0];
  const durationSec = (isDone && job?.created_at && job?.updated_at)
    ? Math.max(1, Math.round((new Date(job.updated_at) - new Date(job.created_at)) / 1000))
    : null;

  const adTypeLabel = AD_TYPE_BADGES[(ad.adType || 'image').toLowerCase()]?.label || 'Image';
  const decodedTitle = he.decode((ad.title || '').replace(/^,|,$/g, '').trim());
  const handle = ad.advertiser ? `@${String(ad.advertiser).replace(/\s+/g, '').toLowerCase()}` : null;
  const hasPromptContent = prompt.trim().length > 0 || extraImages.length > 0;
  const effectiveRatioLabel = aspectRatio === originalRatio ? `Original (${originalRatio})` : aspectRatio;

  // Plain computation, not useMemo — this runs after the `if (!isOpen || !ad)
  // return null` early return above, so it can never be a hook (conditionally
  // calling a hook broke React's "same hooks every render" rule and crashed
  // the modal the instant it opened). The list is tiny; memoizing it isn't
  // worth the extra hook here anyway.
  const aspectOptions = (() => {
    const opts = [];
    if (originalRatio) opts.push({ value: originalRatio, label: `Original (${originalRatio})`, isOriginal: true });
    const ordered = [...ASPECT_ORDER.filter((r) => ASPECT_RATIOS.includes(r)), ...ASPECT_RATIOS.filter((r) => !ASPECT_ORDER.includes(r))];
    for (const r of ordered) {
      if (r === originalRatio) continue;
      opts.push({ value: r, label: r, isOriginal: false });
    }
    return opts;
  })();

  const handleAspectTriggerKeyDown = (e) => {
    if (!aspectOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setAspectFocusIndex(Math.max(0, aspectOptions.findIndex((o) => o.value === aspectRatio)));
        setAspectOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setAspectFocusIndex((i) => Math.min(aspectOptions.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAspectFocusIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = aspectOptions[aspectFocusIndex];
      if (opt) { setAspectRatio(opt.value); setAspectOpen(false); }
    }
  };

  // Carousel ads pass their full slide list (MasonryCard.jsx, set when Recreate
  // is clicked) — switching slides here only matters before a job is submitted;
  // once generating/done/failed, the source image is already locked in.
  const carouselSlides = Array.isArray(ad.carouselImages) ? ad.carouselImages : [];
  const canSwitchSlide = carouselSlides.length > 1 && !jobId;
  const referenceImageUrl = carouselSlides.length > 1 ? (carouselSlides[slideIndex] || carouselSlides[0]) : ad.thumbnail;

  // Reused by the form (3a/3b, left column) and the result layouts (3c/3d/3e,
  // left column's "Reference ad" stage) — same card either way.
  const referenceAdImg = (
    <>
      {referenceImageUrl && (
        <img
          src={referenceImageUrl}
          alt=""
          onLoad={handleReferenceImageLoad}
          className="w-full h-full object-contain bg-black/20"
        />
      )}
      {canSwitchSlide && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSlideIndex((i) => (i > 0 ? i - 1 : carouselSlides.length - 1)); }}
            aria-label="Previous slide"
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-black/50 backdrop-blur-md text-white border border-white/20 shadow-lg hover:bg-black/70"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSlideIndex((i) => (i < carouselSlides.length - 1 ? i + 1 : 0)); }}
            aria-label="Next slide"
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-black/50 backdrop-blur-md text-white border border-white/20 shadow-lg hover:bg-black/70"
          >
            <ChevronRight size={16} />
          </button>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-bold">
            {slideIndex + 1} / {carouselSlides.length}
          </span>
        </>
      )}
      <span className="rcp-chipd">{adTypeLabel}{originalRatio ? ` · ${originalRatio}` : ''}</span>
      {decodedTitle && (
        <div className="absolute inset-x-0 bottom-0 pt-10 pb-3 px-3 bg-gradient-to-t from-black/80 to-transparent">
          <p className="text-white font-bold text-[13px] leading-snug line-clamp-2">{decodedTitle}</p>
        </div>
      )}
    </>
  );

  const lockedInputsSummary = ({ label = 'Inputs locked', icon = true, showEditLink = false } = {}) => (
    <div className="rcp-sum">
      <span className="rcp-sum-label flex items-center gap-1.5">{icon && <Lock size={11} />} {label}</span>
      {productImage?.previewUrl && (
        <span className="rcp-lc">
          <img src={productImage.previewUrl} alt="" className="w-4 h-5 rounded-[3px] object-cover shrink-0" />
          <span>{productImage.name}</span>
        </span>
      )}
      {brandWebsite.trim() && <span className="rcp-lc"><Link2 size={11} className="shrink-0" /><span>{brandWebsite.trim()}</span></span>}
      {prompt.trim() && <span className="rcp-lc"><span>{prompt.trim()}</span></span>}
      {extraImages.length > 0 && <span className="rcp-lc">{extraImages.length} reference image{extraImages.length === 1 ? '' : 's'}</span>}
      <span className="rcp-lc"><AspectRatioIcon ratio={aspectRatio} />{effectiveRatioLabel}</span>
      {showEditLink && (
        <button onClick={handleEditInputs} className="ml-auto" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ps-accent)' }}>
          Edit inputs
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="rcp-m">
        <style>{`
          .rcp-m{box-sizing:border-box;width:min(880px, calc(100vw - 32px));height:auto;max-height:calc(100vh - 32px);
              background:var(--ps-surface);border-radius:16px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;
              color:var(--ps-text);display:flex;flex-direction:column;overflow:hidden;font-size:14px;line-height:1.4;font-weight:400}
          .rcp-m *{font-weight:inherit}
          .rcp-mh{display:flex;align-items:flex-start;gap:12px;padding:20px 24px 16px;border-bottom:1px solid var(--ps-border);flex:0 0 auto}
          .rcp-mi{width:38px;height:38px;border-radius:10px;background:var(--ps-accent-soft);color:var(--ps-accent-strong);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
          .rcp-title{margin:0;font-size:18px;font-weight:800}
          .rcp-subtitle{margin:2px 0 0;font-size:13px;font-weight:400;color:var(--ps-text-muted)}
          .rcp-x{margin-left:auto;width:36px;height:36px;border-radius:9px;border:0;background:transparent;color:var(--ps-text-muted);
              display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;flex:0 0 auto}
          .rcp-x:hover{background:rgba(0,0,0,.04)}
          .rcp-lbl{font-size:11px;font-weight:700;letter-spacing:1px;color:var(--ps-text-subtle);text-transform:uppercase;display:flex;align-items:center;gap:8px}

          .rcp-mf{display:flex;align-items:center;gap:10px;padding:16px 24px;border-top:1px solid var(--ps-border);background:var(--ps-surface-2);flex:0 0 auto}
          .rcp-cost{display:flex;flex-direction:column;gap:2px;font-size:13px;color:var(--ps-text-2)}
          .rcp-btn{height:44px;padding:0 18px;border-radius:10px;font-weight:700;font-size:14px;font-family:inherit;
              display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;cursor:pointer}
          .rcp-b2{border:1px solid var(--ps-border-strong);background:var(--ps-surface);color:var(--ps-text)}
          .rcp-b1{border:0;background:var(--ps-btn);color:var(--ps-btn-text);box-shadow:0 6px 16px rgba(64,74,148,.3)}
          .rcp-b1:disabled{background:var(--ps-btn-disabled-bg);color:var(--ps-btn-disabled-text);box-shadow:none;cursor:not-allowed}

          .rcp-mb{flex:1 1 auto;display:flex;gap:24px;padding:20px 24px;min-height:0;overflow-y:auto;overscroll-behavior:contain}
          .rcp-ref{width:300px;flex:0 0 300px;display:flex;flex-direction:column;gap:10px}
          .rcp-refimg{width:300px;height:375px;border-radius:12px;position:relative;overflow:hidden;background:var(--ps-media-bg)}
          .rcp-chipd{position:absolute;top:10px;right:10px;font-size:11px;font-weight:700;background:rgba(24,22,40,.72);
              color:var(--ps-btn-text);border-radius:8px;padding:3px 8px}
          .rcp-adv{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--ps-border);border-radius:10px}
          .rcp-av{width:34px;height:34px;border-radius:50%;background:var(--ps-border);color:var(--ps-accent-strong);font-weight:700;
              display:flex;align-items:center;justify-content:center;flex:0 0 auto}
          .rcp-advname{display:block;font-size:14px;font-weight:700}
          .rcp-advhandle{font-size:11.5px;font-weight:400;color:var(--ps-text-subtle)}

          .rcp-form{flex:1 1 0%;display:flex;flex-direction:column;gap:18px;min-width:0}
          .rcp-fld{display:flex;flex-direction:column;gap:7px}
          .rcp-fll{font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;color:var(--ps-text)}
          .rcp-req{color:var(--ps-danger-icon)}
          .rcp-opt{font-weight:500;color:var(--ps-text-subtle)}

          .rcp-drop{border:1.5px dashed var(--ps-accent-border);border-radius:12px;background:var(--ps-accent-softer);height:150px;cursor:pointer;
              display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center}
          .rcp-up{display:flex;align-items:center;gap:14px;border:1px solid var(--ps-border-strong);border-radius:12px;padding:12px;background:var(--ps-surface)}
          .rcp-jar{position:relative;border-radius:8px;background:var(--ps-surface-3);overflow:hidden;flex:0 0 auto;width:60px;height:72px}

          .rcp-inp{height:44px;border:1px solid var(--ps-border-strong);border-radius:10px;padding:0 14px;display:flex;align-items:center;gap:10px;
              font-size:14px;font-weight:400;color:var(--ps-text);font-family:inherit;box-sizing:border-box;width:100%;background:var(--ps-surface);cursor:pointer}
          .rcp-inp:focus-within{border-color:var(--ps-accent-strong);box-shadow:var(--ps-focus-ring)}
          .rcp-inp.open{border:1.5px solid var(--ps-accent-strong) !important;box-shadow:var(--ps-focus-ring)}
          .rcp-ph::placeholder{color:var(--ps-text-faint)}

          .rcp-ta{border:1px solid var(--ps-border);border-radius:18px;display:flex;flex-direction:column;background:var(--ps-surface);
              box-shadow:0 1px 2px rgba(24,28,60,.04),0 8px 24px rgba(24,28,60,.06)}
          .rcp-ta:focus-within,.rcp-ta.filled{border-color:var(--ps-accent-border);box-shadow:var(--ps-focus-ring),0 8px 24px rgba(90,75,218,.10)}
          .rcp-tat{padding:14px 16px 4px;min-height:52px;font-size:14.5px;font-weight:400 !important;line-height:1.55;color:var(--ps-text);
              border:0;outline:0;resize:none;background:transparent;font-family:inherit;width:100%;display:block}
          .rcp-tat::placeholder{color:var(--ps-text-faint);font-weight:400 !important}
          .rcp-tab{display:flex;align-items:center;gap:6px;padding:8px 10px 10px}
          .rcp-addref{width:32px;height:32px;border-radius:50%;border:1px solid var(--ps-border-strong);background:var(--ps-surface);
              display:inline-flex;align-items:center;justify-content:center;padding:0;color:var(--ps-text-2);flex:0 0 auto;cursor:pointer}
          .rcp-addref:disabled{opacity:.4;cursor:default}
          .rcp-imgs{font-size:11.5px;font-weight:400;color:var(--ps-text-faint)}
          .rcp-cnt{margin-left:auto;font-size:11.5px;font-weight:400;color:var(--ps-text-faint);font-variant-numeric:tabular-nums;padding-right:6px}
          .rcp-att{display:flex;gap:10px;padding:14px 14px 0;flex-wrap:wrap}
          .rcp-rt{width:52px;height:52px;border-radius:12px;position:relative;flex:0 0 auto;border:1px solid rgba(0,0,0,.06);box-sizing:border-box}
          .rcp-rt img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
          .rcp-rx{position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;background:var(--ps-text);color:var(--ps-surface);
              border:2px solid var(--ps-surface);display:flex;align-items:center;justify-content:center;padding:0;box-sizing:border-box;cursor:pointer}
          .rcp-rslot{width:52px;height:52px;border-radius:12px;border:1.5px dashed var(--ps-accent-border);display:flex;align-items:center;
              justify-content:center;color:var(--ps-text-faint);background:var(--ps-accent-softer);padding:0;box-sizing:border-box;cursor:pointer;flex:0 0 auto}

          .rcp-sugg{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
          .rcp-sg{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:14px;border:1px solid var(--ps-border);
              background:var(--ps-surface);font-size:12px;font-weight:500;color:var(--ps-text-2);font-family:inherit;cursor:pointer}
          .rcp-sg .rcp-i{width:13px;height:13px;color:var(--ps-violet)}

          .rcp-menu{background:var(--ps-surface);border:1px solid var(--ps-border);border-radius:12px;box-shadow:0 16px 40px rgba(24,28,60,.14);
              padding:6px;display:flex;flex-direction:column;gap:1px}
          .rcp-menu-motion{display:flex;flex-direction:column;gap:1px}
          .rcp-optn{display:flex;align-items:center;gap:12px;height:36px;padding:0 10px;border-radius:8px;font-size:13.5px;
              color:var(--ps-text);width:100%;border:0;background:transparent;text-align:left;cursor:pointer;font-family:inherit}
          .rcp-optn:hover{background:var(--ps-hover)}
          .rcp-optn.on{background:var(--ps-accent-soft);color:var(--ps-accent);font-weight:700}
          .rcp-box{display:flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 auto}
          .rcp-rb{border:1.6px solid currentColor;border-radius:3px;box-sizing:border-box;color:var(--ps-text-muted);display:inline-block}
          .rcp-hint{margin-left:auto;font-size:12px;color:var(--ps-text-subtle);font-weight:500}
          .rcp-divider{height:1px;background:var(--ps-divider);margin:4px 6px}

          .rcp-warn{display:flex;align-items:center;gap:14px;margin:0 24px 16px;padding:14px 16px;border-radius:12px;
              background:var(--ps-warn-bg);border:1px solid var(--ps-warn-border);flex:0 0 auto}

          .rcp-cols{display:flex;gap:24px}
          .rcp-col{flex:1 1 0%;display:flex;flex-direction:column;gap:10px;min-width:0}
          .rcp-stage{height:460px;border-radius:12px;background:var(--ps-hover);display:flex;align-items:center;justify-content:center;border:1px solid var(--ps-divider);overflow:hidden}
          .rcp-img{max-width:352px;max-height:440px;border-radius:10px;position:relative;overflow:hidden;box-sizing:border-box}
          .rcp-sum{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--ps-border);border-radius:12px;background:var(--ps-surface-2)}
          .rcp-lc{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:8px;background:var(--ps-surface);
              border:1px solid var(--ps-border);font-size:12.5px;font-weight:400;color:var(--ps-text-2);max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .rcp-sum-label{font-size:12px;font-weight:700;color:var(--ps-text-muted);margin-right:4px}

          /* Generating shimmer — goes straight on .stage (no separate sized
             .img box for this state, per spec: the loading area is the full
             stage, not shaped to the eventual output's aspect ratio). A
             seamless repeating-stripe loop: 88.27px = 80px / sin(115deg), the
             stripe pattern's exact horizontal period, so the translateX loop
             never visibly jumps. */
          .rcp-stage.rcp-gen{position:relative;overflow:hidden;border-radius:12px;border:1px solid var(--ps-accent-border);background:var(--ps-shim-b)}
          .rcp-stage.rcp-gen::before{
            content:"";position:absolute;top:0;bottom:0;left:-89px;right:0;
            background:repeating-linear-gradient(115deg,var(--ps-shim-a) 0 40px,var(--ps-shim-b) 40px 80px);
            animation:rcp-stripe-move 1.2s linear infinite;will-change:transform;
          }
          @keyframes rcp-stripe-move{from{transform:translateX(0)}to{transform:translateX(88.27px)}}
          .rcp-load{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:0 36px}
          .rcp-ring{width:48px;height:48px;border-radius:50%;border:4px solid var(--ps-track);border-top-color:var(--ps-accent-strong);box-sizing:border-box;animation:rcp-spin .9s linear infinite}
          @keyframes rcp-spin{to{transform:rotate(360deg)}}
          @keyframes rcp-progress{from{width:6%}to{width:92%}}
          .rcp-progress-fill{animation:rcp-progress 25s ease-out forwards;transition:width .4s ease}
          @media (prefers-reduced-motion: reduce){
            .rcp-stage.rcp-gen::before{animation:none}
            .rcp-ring{animation:none;border-top-color:var(--ps-accent-strong)}
            .rcp-progress-fill{animation:none;width:45%}
          }

          @media (max-width: 820px){
            .rcp-mb{flex-direction:column}
            .rcp-cols{flex-direction:column}
            .rcp-ref{width:100%;flex:0 0 auto}
            .rcp-refimg{width:100%;max-width:300px;margin:0 auto}
            .rcp-col{width:100%}
            .rcp-stage{height:auto;min-height:280px}
            .rcp-stage.rcp-gen{height:300px}
          }
          @media (max-height: 700px){
            .rcp-stage{height:360px}
          }
        `}</style>

        <div className="rcp-mh">
          <div className="rcp-mi"><Sparkle size={16} fill="currentColor" /></div>
          <div className="min-w-0">
            <h3 className="rcp-title">Recreate this ad</h3>
            <p className="rcp-subtitle truncate">
              {isGenerating
                ? 'Generating your version — this usually takes under a minute.'
                : isDone ? `Generated in ${durationSec ?? '—'} seconds · saved to MySpace`
                : isFailed ? "Generation didn't finish. Your inputs are kept, so you can try again."
                : 'Generate your own version of this ad using your product image.'}
            </p>
          </div>
          <button onClick={handleCloseModal} className="rcp-x"><X size={16} /></button>
        </div>

        {/* 3f — No credits: a banner inside the (still editable) form, not a dead-end screen */}
        {isForm && noCreditsAvailable && creditsDetail && (
          <div className="rcp-warn">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--ps-warn-bg)', color: 'var(--ps-warn)' }}>
              <Sparkle size={16} fill="currentColor" />
            </div>
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--ps-text)' }}>You've used all your credits for this cycle</p>
              <p className="mt-0.5" style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--ps-text-2)' }}>
                {creditsDetail.used ?? 0} of {creditsDetail.total ?? '—'} used
                {creditsDetail.refreshDate ? ` · credits refresh on ${new Date(creditsDetail.refreshDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}. Upgrade to keep creating now.
              </p>
            </div>
            <button onClick={onUpgrade} className="rcp-btn rcp-b1 shrink-0" style={{ height: 40 }}>
              <Sparkle size={13} fill="currentColor" /> Upgrade plan
            </button>
          </div>
        )}

        {isForm ? (
          <div className="rcp-mb">
            {/* Left: reference ad */}
            <div className="rcp-ref">
              <span className="rcp-lbl">Reference ad</span>
              <div className="rcp-refimg">{referenceAdImg}</div>
              {ad.advertiser && (
                <div className="rcp-adv">
                  {ad.advertiserImage && !ad.advertiserImage.includes('DefaultImage.jpg') ? (
                    <img src={ad.advertiserImage} alt="" className="w-[34px] h-[34px] rounded-full object-cover" />
                  ) : (
                    <div className="rcp-av">{(ad.advertiser || '?')[0].toUpperCase()}</div>
                  )}
                  <div className="min-w-0">
                    <b className="rcp-advname truncate">{ad.advertiser}</b>
                    <span className="rcp-advhandle truncate block">{handle}{ad.runningDays ? ` · ${ad.runningDays}d running` : ''}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: form */}
            <div className="rcp-form">
              <div className="rcp-fld">
                <label className="rcp-fll">Product image <span className="rcp-req">*</span></label>
                {!productImage?.previewUrl ? (
                  <div
                    onClick={() => productInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleProductFile(e.dataTransfer.files?.[0]); }}
                    className="rcp-drop"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--ps-accent-soft)', color: 'var(--ps-accent-strong)' }}>
                      <Upload size={15} />
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ps-text)' }}>Upload your product image</p>
                    <p style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--ps-text-muted)' }}>
                      Drag &amp; drop or <span style={{ fontWeight: 700, color: 'var(--ps-accent)' }}>browse</span> · JPG, PNG, WEBP up to {MAX_UPLOAD_MB}MB
                    </p>
                  </div>
                ) : (
                  <div className="rcp-up">
                    <div className="rcp-jar">
                      <img src={productImage.previewUrl} alt="Product" className="w-full h-full object-cover" />
                      {productImage.uploading && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <Loader2 size={14} className="animate-spin text-white" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ps-text)' }}>{productImage.name}</p>
                      <p className="truncate" style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--ps-text-subtle)' }}>
                        {productImage.sizeLabel}{productImage.dims ? ` · ${productImage.dims.width} × ${productImage.dims.height}` : ''}
                      </p>
                      {!productImage.uploading && (
                        <p className="flex items-center gap-1 mt-0.5" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ps-success)' }}>
                          <Check size={11} /> Uploaded
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => productInputRef.current?.click()}
                        style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ps-accent)' }}
                      >
                        Replace
                      </button>
                      <button
                        onClick={() => {
                          if (productImage.previewUrl) URL.revokeObjectURL(productImage.previewUrl);
                          if (productImage.isFreshUpload && productImage.url) deleteImageGenUpload(productImage.url).catch(() => {});
                          setProductImage(null);
                        }}
                        className="w-8 h-8 flex items-center justify-center"
                        style={{ border: '1px solid var(--ps-border-strong)', borderRadius: 8, color: 'var(--ps-text-muted)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
                {productImage?.error && <p className="text-[11px] mt-1" style={{ color: 'var(--ps-danger-icon)' }}>{productImage.error}</p>}
                <input
                  ref={productInputRef}
                  type="file"
                  accept={ALLOWED_TYPES.join(',')}
                  className="hidden"
                  onChange={(e) => { handleProductFile(e.target.files?.[0]); e.target.value = ''; }}
                />
              </div>

              <div className="rcp-fld">
                <label className="rcp-fll">Brand website <span className="rcp-opt">(optional)</span></label>
                <div className="rcp-inp" style={{ cursor: 'text' }}>
                  <Link2 size={13} style={{ color: 'var(--ps-text-faint)' }} className="shrink-0" />
                  <input
                    value={brandWebsite}
                    onChange={(e) => setBrandWebsite(e.target.value)}
                    placeholder="https://yourbrand.com"
                    className="rcp-ph flex-1 min-w-0 bg-transparent focus:outline-none"
                    style={{ fontSize: 14, fontWeight: 400, color: 'var(--ps-text)', fontFamily: 'inherit' }}
                  />
                </div>
              </div>

              <div className="rcp-fld">
                <label className="rcp-fll" htmlFor="prompt">Prompt <span className="rcp-req">*</span></label>
                <div className={`rcp-ta${hasPromptContent ? ' filled' : ''}`}>
                  {extraImages.length > 0 && (
                    <div className="rcp-att">
                      {extraImages.map((img, idx) => (
                        <div key={idx} className="rcp-rt">
                          {img.previewUrl && <img src={img.previewUrl} alt="" />}
                          {img.uploading && (
                            <div className="absolute inset-0 rounded-[inherit] bg-black/40 flex items-center justify-center">
                              <Loader2 size={12} className="animate-spin text-white" />
                            </div>
                          )}
                          <button onClick={() => removeExtraImage(idx)} className="rcp-rx"><X size={11} /></button>
                        </div>
                      ))}
                      {extraImages.length < MAX_EXTRA_IMAGES && (
                        <button onClick={() => extraInputRef.current?.click()} className="rcp-rslot"><Plus size={18} /></button>
                      )}
                    </div>
                  )}
                  <textarea
                    ref={promptRef}
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_LEN))}
                    onPaste={handlePromptPaste}
                    placeholder="What should change? e.g. use blue tones, change the headline to…"
                    maxLength={MAX_PROMPT_LEN}
                    required
                    aria-required="true"
                    rows={1}
                    className="rcp-tat"
                  />
                  <div className="rcp-tab">
                    <button
                      onClick={() => extraInputRef.current?.click()}
                      disabled={extraImages.length >= MAX_EXTRA_IMAGES}
                      className="rcp-addref"
                    >
                      <Plus size={14} />
                    </button>
                    <span className="rcp-imgs">{extraImages.length}/{MAX_EXTRA_IMAGES} images</span>
                    <span className="rcp-cnt">{prompt.length}/{MAX_PROMPT_LEN}</span>
                  </div>
                </div>
                <input
                  ref={extraInputRef}
                  type="file"
                  accept={ALLOWED_TYPES.join(',')}
                  multiple
                  className="hidden"
                  onChange={(e) => { handleExtraFiles(e.target.files); e.target.value = ''; }}
                />
              </div>

              {/* Always shown — each chip appends to whatever the user has typed. */}
              <div className="rcp-sugg">
                {QUICK_PROMPTS.map((q) => (
                  <button key={q.label} onClick={() => appendQuickPrompt(q.text)} className="rcp-sg">
                    <Plus size={11} className="rcp-i" /> {q.label}
                  </button>
                ))}
              </div>

              <div className="rcp-fld relative">
                <label className="rcp-fll">Aspect ratio</label>
                <button
                  ref={aspectRefs.setReference}
                  {...getAspectReferenceProps({
                    onClick: () => setAspectFocusIndex(Math.max(0, aspectOptions.findIndex((o) => o.value === aspectRatio))),
                    onKeyDown: handleAspectTriggerKeyDown,
                  })}
                  className={`rcp-inp${aspectOpen ? ' open' : ''}`}
                  style={{ justifyContent: 'space-between' }}
                  aria-haspopup="listbox"
                  aria-expanded={aspectOpen}
                >
                  <span className="flex items-center gap-2.5">
                    <AspectRatioIcon ratio={aspectRatio} />
                    {effectiveRatioLabel}
                  </span>
                  <ChevronDown size={14} style={{ color: 'var(--ps-text-muted)' }} className={`transition-transform ${aspectOpen ? 'rotate-180' : ''}`} />
                </button>
                {aspectOpen && (
                  <FloatingPortal>
                    <div
                      ref={(node) => { aspectRefs.setFloating(node); aspectListRef.current = node; }}
                      {...getAspectFloatingProps({ onKeyDown: handleAspectTriggerKeyDown })}
                      className="rcp-menu"
                      role="listbox"
                      aria-label="Aspect ratio"
                      style={{ ...aspectFloatingStyles, overflowY: 'auto', overscrollBehavior: 'contain', visibility: aspectPositioned ? 'visible' : 'hidden', zIndex: 2147483300 }}
                    >
                      <div className={`rcp-menu-motion floating-popover-motion ${aspectPositioned ? 'is-positioned' : ''}`}>
                      {aspectOptions.map((opt, idx) => {
                        const selected = aspectRatio === opt.value;
                        // The Original row never shows a hint — only a real ratio
                        // (not "Original") gets the "Square · Feed" style label.
                        const hint = !opt.isOriginal ? ASPECT_HINTS[opt.value] : null;
                        return (
                          <React.Fragment key={opt.value}>
                            <button
                              role="option"
                              aria-selected={selected}
                              onMouseEnter={() => setAspectFocusIndex(idx)}
                              onClick={() => { setAspectRatio(opt.value); setAspectOpen(false); }}
                              className={`rcp-optn${selected ? ' on' : ''}`}
                              style={idx === aspectFocusIndex && !selected ? { background: 'var(--ps-hover)' } : undefined}
                            >
                              <span className="rcp-box"><AspectRatioIcon ratio={opt.value} /></span>
                              <span>{opt.label}</span>
                              {selected ? (
                                <Check size={14} style={{ marginLeft: 'auto', color: 'var(--ps-accent)' }} />
                              ) : hint ? (
                                <span className="rcp-hint">{hint}</span>
                              ) : null}
                            </button>
                            {opt.isOriginal && <div className="rcp-divider" />}
                          </React.Fragment>
                        );
                      })}
                      </div>
                    </div>
                  </FloatingPortal>
                )}
              </div>

              {submitError && <p className="text-xs" style={{ color: 'var(--ps-danger-icon)' }}>{submitError}</p>}
            </div>
          </div>
        ) : (
          <div className="rcp-mb" style={{ flexDirection: 'column' }}>
            <div className="rcp-cols">
              <div className="rcp-col">
                <span className="rcp-lbl">Reference ad{ad.advertiser ? ` · ${ad.advertiser}` : ''}</span>
                <div className="rcp-stage">
                  <div className="rcp-img" style={computeStageImgSize(originalRatio || aspectRatio)}>{referenceAdImg}</div>
                </div>
              </div>

              <div className="rcp-col">
                {isGenerating && (
                  <>
                    <span className="rcp-lbl" style={{ color: 'var(--ps-accent)' }}><Sparkle size={11} fill="currentColor" /> Your version</span>
                    <div className="rcp-stage rcp-gen">
                      <div className="rcp-load">
                        <div className="rcp-ring" />
                        <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--ps-text)' }}>Generating your ad…</p>
                        <p style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--ps-text-muted)', maxWidth: '100%' }}>
                          Usually takes 15–40 seconds. You can close this — we'll notify you when it's ready.
                        </p>
                        <div className="rounded-full overflow-hidden" style={{ width: 146, maxWidth: '100%', height: 6, backgroundColor: 'var(--ps-track)' }}>
                          <div className="rcp-progress-fill h-full rounded-full" style={{ backgroundColor: 'var(--ps-accent-strong)' }} />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {isDone && resultImage && (
                  <>
                    <span className="rcp-lbl" style={{ color: 'var(--ps-accent)' }}><Sparkle size={11} fill="currentColor" /> Your version</span>
                    <div className="rcp-stage" style={{ backgroundColor: 'var(--ps-accent-soft)', borderColor: 'var(--ps-accent-border)' }}>
                      <div className="rcp-img" style={computeStageImgSize(aspectRatio)}>
                        <img src={resultImage.url} alt="Recreated ad" className="w-full h-full object-contain" style={{ boxShadow: '0 10px 28px rgba(40,20,10,.25)' }} />
                        <span className="rcp-chipd" style={{ backgroundColor: 'var(--ps-success-bg)', color: 'var(--ps-success)' }}>Saved</span>
                      </div>
                    </div>
                  </>
                )}

                {isFailed && (
                  <>
                    <span className="rcp-lbl">Your version</span>
                    <div className="rcp-stage" style={{ backgroundColor: 'var(--ps-danger-surface)', borderColor: 'var(--ps-danger-border)' }}>
                      <div
                        role="alert"
                        className="rcp-img flex flex-col items-center justify-center gap-3 text-center px-10"
                        style={{ ...computeStageImgSize(aspectRatio), border: '1.5px dashed var(--ps-danger-dash)' }}
                      >
                        <div className="w-14 h-14 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--ps-danger-bg)', color: 'var(--ps-danger-icon)' }}>
                          <AlertCircle size={24} />
                        </div>
                        <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--ps-text)' }}>Something went wrong.</p>
                        <p style={{ fontSize: 13.5, fontWeight: 400, color: 'var(--ps-text-2)', maxWidth: '100%' }}>Your credit has been refunded.</p>
                        <span className="flex items-center gap-1 shrink-0" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ps-success)', backgroundColor: 'var(--ps-success-bg)', borderRadius: 10, padding: '4px 10px' }}>
                          <Check size={12} /> +1 credit refunded
                        </span>
                        <button onClick={handleTryAgain} className="rcp-btn rcp-b1 shrink-0" style={{ marginTop: 6 }}>
                          <RefreshCw size={14} /> Try again
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {isGenerating && lockedInputsSummary({ label: 'Inputs locked' })}
            {isFailed && lockedInputsSummary({ label: 'Your inputs', icon: false, showEditLink: true })}
            {isDone && lockedInputsSummary({ label: 'Made with', icon: false })}
          </div>
        )}

        {/* Footer — one per state */}
        {isForm && (
          <div className="rcp-mf">
            <div className="rcp-cost min-w-0">
              <p className="flex items-center gap-1">
                <Sparkle size={11} fill="var(--ps-accent-strong)" style={{ color: 'var(--ps-accent-strong)' }} />
                <span style={{ fontWeight: 400 }}>Uses</span>
                <span style={{ fontWeight: 700 }}>{cost} credit</span>
                <span style={{ fontWeight: 400 }}>
                  · {noCreditsAvailable ? <b style={{ color: 'var(--ps-danger-icon)', fontWeight: 700 }}>0 left</b> : `${typeof balance === 'number' ? balance : '—'} left`}
                </span>
              </p>
              <p style={{ fontSize: 12, fontWeight: 400, color: 'var(--ps-text-subtle)' }}>
                {!productReady ? 'Add a product image to continue' : !promptReady ? 'Add a prompt to continue' : 'Saved to MySpace automatically'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <button onClick={handleCloseModal} className="rcp-btn rcp-b2">Cancel</button>
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                title={noCreditsAvailable ? 'No credits left' : !productReady ? 'Add a product image to continue' : !promptReady ? 'Add a prompt to continue' : '1 credit per AI Recreate'}
                className="rcp-btn rcp-b1"
              >
                {submitting ? <Loader2 className="animate-spin" size={14} /> : <Sparkle size={14} fill="currentColor" />}
                {submitting ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        )}

        {isGenerating && (
          <div className="rcp-mf">
            <p className="flex items-center gap-1" style={{ fontSize: 13, fontWeight: 400, color: 'var(--ps-text-2)' }}>
              <Sparkle size={11} fill="var(--ps-accent-strong)" style={{ color: 'var(--ps-accent-strong)' }} />
              <span style={{ fontWeight: 400 }}>Uses</span> <b style={{ fontWeight: 700 }}>1 credit</b> in use · refunded automatically if it fails
            </p>
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <button onClick={handleCloseModal} className="rcp-btn rcp-b2">Close</button>
              <button disabled className="rcp-btn rcp-b1">
                <Loader2 className="animate-spin" size={14} /> Generating…
              </button>
            </div>
          </div>
        )}

        {isDone && (
          <div className="rcp-mf">
            <p className="flex items-center gap-1" style={{ fontSize: 13, fontWeight: 400, color: 'var(--ps-text-2)' }}>
              <Sparkle size={11} fill="var(--ps-accent-strong)" style={{ color: 'var(--ps-accent-strong)' }} />
              {typeof balance === 'number' ? balance : '—'} credits left
            </p>
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {resultImage?.url && (
                <a href={resultImage.url} download target="_blank" rel="noreferrer" className="rcp-btn rcp-b2">
                  <Download size={14} /> Download
                </a>
              )}
              <button onClick={handleRegenerate} disabled={noCreditsAvailable} className="rcp-btn rcp-b2" style={noCreditsAvailable ? { opacity: .5, cursor: 'not-allowed' } : undefined}>
                <RefreshCw size={14} /> Regenerate (1 credit)
              </button>
              <button onClick={() => { onViewMySpace?.(); onClose(); }} className="rcp-btn rcp-b1">
                Open in MySpace <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {isFailed && (
          <div className="rcp-mf">
            <p className="flex items-center gap-1" style={{ fontSize: 13, color: 'var(--ps-text-2)' }}>
              <Sparkle size={11} fill="var(--ps-accent-strong)" style={{ color: 'var(--ps-accent-strong)' }} />
              <span style={{ fontWeight: 400 }}>Uses</span>
              <span style={{ fontWeight: 700 }}>1 credit</span>
              <span style={{ fontWeight: 400 }}>· {typeof balance === 'number' ? balance : '—'} left</span>
            </p>
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <button onClick={handleCloseModal} className="rcp-btn rcp-b2">Cancel</button>
              <button onClick={handleTryAgain} disabled={noCreditsAvailable} className="rcp-btn rcp-b1">
                <RefreshCw size={14} /> Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecreateModal;

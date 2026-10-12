import { useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Check, Info, SearchX, Sparkles, X } from "lucide-react";

const FAILURE_TITLE = "Couldn't apply your prompt";

// Every AI notice uses the app's AI accent. A failed prompt is shown by its
// icon and title rather than a warning colour.
const AI_TONE = {
  panel: "border-[#8b5cf6]/35 bg-[#8b5cf6]/[0.06]",
  badge: "bg-[#8b5cf6]/15 text-[#7c3aed] dark:text-[#c4b5fd]",
  accent: "text-[#7c3aed] dark:text-[#c4b5fd]",
  chip: "hover:border-[#8b5cf6]/45 hover:bg-[#8b5cf6]/10",
};

// Toasts stay quiet: a neutral surface, with only the icon coloured.
const TOAST_TONES = {
  unapplied: { icon: "text-[#7c3aed] dark:text-[#c4b5fd]", Icon: SearchX },
  success: { icon: "text-green-600 dark:text-green-400", Icon: Check },
  notice: { icon: "text-blue-600 dark:text-blue-400", Icon: Info },
  error: { icon: "text-red-600 dark:text-red-400", Icon: AlertCircle },
};

/**
 * Compact explanation under the search bar. `failureMessage` means the prompt
 * was not applied and the feed below is the unfiltered library; otherwise
 * `summary`/`note` describe the planner tier that was actually executed. The
 * "Did you mean" chips sit on their own line under the text.
 */
export const AiSearchExplanation = ({
  failureMessage = null,
  summary = "",
  note = "",
  suggestions = [],
  onDismiss,
  onSuggestionSelect,
  onSuggestionsDismiss,
}) => {
  const isFailure = Boolean(failureMessage);
  const headline = isFailure ? failureMessage : summary;
  const hasSuggestions = suggestions.length > 0;
  if (!headline && !note && !hasSuggestions) return null;

  const Icon = isFailure ? SearchX : Sparkles;
  const canDismiss = Boolean(onDismiss) && Boolean(headline || note);

  return (
    <section
      className={`relative mb-3 flex items-start gap-3 rounded-xl border py-2.5 pl-2.5 ${
        canDismiss ? "pr-10" : "pr-3"
      } ${AI_TONE.panel}`}
      role="region"
      aria-label={isFailure ? "AI prompt not applied" : "AI search explanation"}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${AI_TONE.badge}`}
        aria-hidden="true"
      >
        <Icon size={15} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {(headline || note) && (
          <p className="text-[13px] leading-5 text-theme-text">
            {isFailure ? (
              <>
                <span className="font-semibold">{FAILURE_TITLE}</span>
                <span className="text-theme-text-muted"> — </span>
                <span>{failureMessage}</span>
              </>
            ) : (
              headline && <span className="font-semibold">{headline}</span>
            )}
            {note && (
              <>
                <span className="text-theme-text-muted" aria-hidden="true"> · </span>
                <span className="text-theme-text-muted">{note}</span>
              </>
            )}
          </p>
        )}
        {hasSuggestions && (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Did you mean suggestions"
          >
            <span className={`text-[10px] font-extrabold uppercase tracking-[0.12em] ${AI_TONE.accent}`}>
              Did you mean:
            </span>
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.prompt}-${index}`}
                type="button"
                onClick={() => {
                  onSuggestionsDismiss?.();
                  onSuggestionSelect?.(suggestion.prompt);
                }}
                className={`group flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-theme-border bg-theme-surface px-2.5 py-1 text-left text-[11px] font-medium text-theme-text transition-colors ${AI_TONE.chip}`}
                aria-label={`Run suggested search: ${suggestion.prompt}`}
              >
                <Sparkles
                  size={11}
                  className={`shrink-0 transition-transform group-hover:scale-110 ${AI_TONE.accent}`}
                />
                <span className="min-w-0 whitespace-normal">{suggestion.prompt}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {canDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full text-theme-text-muted transition-colors hover:bg-theme-text/[0.08] hover:text-theme-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]/50"
          aria-label="Dismiss AI search explanation"
          title="Dismiss AI search explanation"
        >
          <X size={14} />
        </button>
      )}
    </section>
  );
};

const TOAST_SIDEBAR_GAP_PX = 8;
const TOAST_MIN_WIDTH_PX = 160;

// The notice belongs to the feed column, but it should centre on the screen the
// way the search bar does. The column moves when the sidebar opens or closes, so
// measure how far its centre sits from the viewport centre. The width is capped
// to the room on either side of that centre. If there is not enough room to
// centre without covering the sidebar, it centres within the feed column instead.
const useViewportCentring = (overlayRef, active) => {
  const [placement, setPlacement] = useState({ shift: 0, maxWidth: undefined });

  useLayoutEffect(() => {
    // The feed area's edges are the sidebar edge, so measure against it when marked.
    const bounds = overlayRef.current?.closest("[data-ai-notice-bounds]") ?? overlayRef.current?.parentElement;
    if (!active || !bounds) return undefined;

    const measure = () => {
      const viewportCentre = document.documentElement.clientWidth / 2;
      const { left, right } = bounds.getBoundingClientRect();
      // Room on the narrower side of the viewport centre, measured from the feed area's edges.
      const centredWidth = Math.min(viewportCentre - left, right - viewportCentre) * 2 - TOAST_SIDEBAR_GAP_PX * 2;
      if (centredWidth >= TOAST_MIN_WIDTH_PX) {
        setPlacement({ shift: viewportCentre - (left + right) / 2, maxWidth: centredWidth });
      } else {
        setPlacement({
          shift: 0,
          maxWidth: Math.max(TOAST_MIN_WIDTH_PX, right - left - TOAST_SIDEBAR_GAP_PX * 2),
        });
      }
    };

    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(bounds);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [overlayRef, active]);

  return placement;
};

/**
 * Quiet notice that floats directly under the filter block (Quick Filters, or
 * the platform row while Quick Filters are not loaded). It overlays the results
 * rather than pushing them down, is centred on the viewport, and can be dismissed.
 */
export const AiSearchToast = ({ toast, onDismiss }) => {
  const overlayRef = useRef(null);
  const placement = useViewportCentring(overlayRef, Boolean(toast?.message));
  if (!toast?.message) return null;
  const tone = TOAST_TONES[toast.type] || TOAST_TONES.notice;
  const { Icon } = tone;

  return (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute inset-x-0 top-full z-40 mt-2 flex justify-center"
      style={{ transform: `translateX(${placement.shift}px)` }}
    >
      <div
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-lg border border-theme-border bg-theme-card py-1.5 pl-2.5 pr-1.5 text-[13px] font-medium text-theme-text shadow-md"
        style={{ maxWidth: placement.maxWidth }}
      >
        <Icon size={14} className={`shrink-0 ${tone.icon}`} />
        <span className="min-w-0">{toast.message}</span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-theme-text-muted transition-colors hover:bg-theme-text/[0.08] hover:text-theme-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]/50"
            aria-label="Dismiss notice"
            title="Dismiss notice"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

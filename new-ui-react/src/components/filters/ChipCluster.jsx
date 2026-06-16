import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronDown, ChevronRight } from "lucide-react";

const INLINE_CHILDREN_LIMIT = 3;

/**
 * ChipCluster — represents one parent category and its selected children.
 *
 * Expanded form: a wider pill containing the parent label, an X to remove
 * the parent, a divider, and inline child chips. Overflow opens a popover.
 *
 * Collapsed form: a single chip showing parent + selected-child count badge.
 * Clicking the body promotes this cluster to expanded (the caller is
 * responsible for collapsing whichever other cluster was expanded).
 *
 * Children-less parents render as a plain chip regardless of expanded state
 * — there is nothing to fold open, so the visual distinction is wasted.
 */
const ChipCluster = ({
  parent,
  items = [],
  isExpanded,
  onExpand,
  onCollapse,
  onRemoveParent,
  onRemoveChild,
}) => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const popoverRef = useRef(null);
  const anchorRef = useRef(null);

  // The popover is rendered in a portal on document.body (so it escapes the
  // scrollable, overflow-clipped chip row) and positioned with `fixed`
  // coordinates derived from the anchor button's viewport rect.
  const POPOVER_MAX_W = 320;
  const reposition = useCallback(() => {
    const el = anchorRef.current;
    /* v8 ignore next -- defensive: anchorRef is always attached when reposition runs */
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - POPOVER_MAX_W - 8),
    );
    setCoords({ top: rect.bottom + 6, left });
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;
    reposition();
    const onDown = (e) => {
      if (
        popoverRef.current?.contains(e.target) ||
        anchorRef.current?.contains(e.target)
      )
        return;
      setPopoverOpen(false);
    };
    // `true` capture catches scrolling inside the chip row's overflow
    // container, not just window scroll, so the popover stays anchored.
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [popoverOpen, reposition]);

  useEffect(() => {
    if (!isExpanded) setPopoverOpen(false);
  }, [isExpanded]);

  const childCount = items.length;
  const showAsCollapsed = !isExpanded || childCount === 0;

  if (showAsCollapsed) {
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap pl-1.5 pr-1.5 py-0.5 rounded-full text-[10px] 2xl:text-xs font-semibold transition-colors ${
          childCount > 0
            ? "bg-[#3762c1]/10 border border-[#3759a3]/30 text-[#6b99ff] cursor-pointer hover:border-[#3759a3]/60 hover:bg-[#3762c1]/15"
            : "bg-[#3762c1]/10 border border-[#3759a3]/20 text-[#6b99ff]"
        }`}
        onClick={childCount > 0 ? onExpand : undefined}
        role={childCount > 0 ? "button" : undefined}
        title={childCount > 0 ? "Show subcategories" : undefined}
      >
        {childCount > 0 && (
          <ChevronRight size={10} className="opacity-70 -ml-0.5" />
        )}
        <span>{parent.label}</span>
        {childCount > 0 && (
          <span className="ml-0.5 px-1 py-px bg-[#3759a3]/40 text-[#cfd9f0] rounded-full text-[9px] font-bold tabular-nums">
            +{childCount}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemoveParent();
          }}
          className="hover:text-red-400 transition-colors ml-0.5"
          aria-label={`Remove ${parent.label}`}
        >
          <X size={9} />
        </button>
      </span>
    );
  }

  const visible = items.slice(0, INLINE_CHILDREN_LIMIT);
  const overflow = items.slice(INLINE_CHILDREN_LIMIT);

  return (
    <span className="relative inline-flex items-center gap-1 whitespace-nowrap pl-1.5 pr-1.5 py-0.5 bg-[#3762c1]/15 border border-[#3759a3]/55 rounded-full text-[10px] 2xl:text-xs font-semibold text-[#6b99ff] shadow-[0_0_0_1px_rgba(55,89,163,0.15)]">
      <button
        onClick={onCollapse}
        className="flex items-center gap-1 hover:text-white transition-colors"
        title="Collapse"
      >
        <ChevronDown size={10} className="opacity-80" />
        <span className="font-bold">{parent.label}</span>
      </button>
      <button
        onClick={onRemoveParent}
        className="hover:text-red-400 transition-colors"
        aria-label={`Remove ${parent.label}`}
      >
        <X size={9} />
      </button>

      <span className="h-3 w-px bg-[#3759a3]/50 mx-0.5" aria-hidden="true" />

      {visible.map((ch) => (
        <span
          key={ch.value}
          className="inline-flex items-center gap-0.5 pl-1.5 pr-1 py-px bg-[#3762c1]/25 border border-[#3759a3]/30 rounded-full text-[10px] font-medium text-[#cfd9f0]"
        >
          <span className="truncate max-w-[120px]">{ch.label}</span>
          <button
            onClick={() => onRemoveChild(ch.value)}
            className="hover:text-red-400 transition-colors"
            aria-label={`Remove ${ch.label}`}
          >
            <X size={8} />
          </button>
        </span>
      ))}

      {overflow.length > 0 && (
        <>
          <button
            ref={anchorRef}
            onClick={(e) => {
              e.stopPropagation();
              setPopoverOpen((p) => !p);
            }}
            className="px-1.5 py-px text-[10px] font-semibold text-[#cfd9f0]/80 hover:text-white transition-colors rounded"
          >
            +{overflow.length} more
          </button>
          {popoverOpen &&
            createPortal(
            <div
              ref={popoverRef}
              style={{ position: "fixed", top: coords.top, left: coords.left }}
              className="z-[60] bg-theme-card border border-[#3759a3]/60 rounded-lg shadow-[0_8px_20px_rgba(0,0,0,0.45)] py-2 px-2.5 min-w-[220px] max-w-[320px]"
            >
              <p className="text-[9px] font-bold uppercase tracking-wider text-[#6b99ff] mb-1.5">
                More in {parent.label}
              </p>
              <div className="flex flex-wrap gap-1 max-h-[200px] overflow-y-auto">
                {overflow.map((ch) => (
                  <span
                    key={ch.value}
                    className="inline-flex items-center gap-0.5 pl-1.5 pr-1 py-0.5 bg-[#3762c1]/20 border border-[#3759a3]/30 rounded-full text-[10px] font-medium text-[#cfd9f0]"
                  >
                    <span className="truncate max-w-[150px]">{ch.label}</span>
                    <button
                      onClick={() => onRemoveChild(ch.value)}
                      className="hover:text-red-400 transition-colors ml-0.5"
                      aria-label={`Remove ${ch.label}`}
                    >
                      <X size={8} />
                    </button>
                  </span>
                ))}
              </div>
            </div>,
            document.body,
          )}
        </>
      )}
    </span>
  );
};

export default ChipCluster;

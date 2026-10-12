import React, { useEffect, useRef, useState } from "react";
import { useInstalledMobile } from "../../hooks/useInstalledMobile";

// Inline chevrons (not lucide): rows using this are tested with partial
// lucide-react mocks, which would fail on an unknown icon import.
const Chevron = ({ dir }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
  </svg>
);

/**
 * Installed phone app only: slider controls for a horizontally scrolling row
 * (platform tabs, AI quick filters) — ‹ › arrows at the edges that page the
 * row, and a small position indicator under it that can be dragged. Renders
 * nothing on the website or when the row already fits.
 *
 * Place it inside a `relative` box that wraps the row. `deps` re-attach it
 * when the row element is (re)created.
 */
// `indicator`: "bar" (draggable position bar), "dots" (one dot per screenful,
// Myntra-style; tap a dot to jump there) or "none".
const RowSlider = ({ rowRef, deps = [], indicator = "bar" }) => {
  const showIndicator = indicator === "bar";
  const installed = useInstalledMobile();
  const [m, setM] = useState({ ratio: 1, pos: 0, canL: false, canR: false, pages: 1, page: 0 });
  const trackRef = useRef(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!installed || !row) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const max = row.scrollWidth - row.clientWidth;
      const pages = row.clientWidth ? Math.max(1, Math.ceil((row.scrollWidth - 2) / row.clientWidth)) : 1;
      const next = {
        ratio: row.scrollWidth ? Math.min(1, row.clientWidth / row.scrollWidth) : 1,
        pos: max > 0 ? row.scrollLeft / max : 0,
        canL: row.scrollLeft > 4,
        canR: row.scrollLeft < max - 4,
        pages,
        // The last dot lights up once the end is reached.
        page: row.scrollLeft >= max - 4 ? pages - 1 : Math.min(pages - 1, Math.round(row.scrollLeft / row.clientWidth)),
      };
      // Skip re-renders for sub-pixel changes while the row is scrolling.
      setM((p) => (Math.abs(p.pos - next.pos) < 0.004 && p.ratio === next.ratio && p.canL === next.canL && p.canR === next.canR && p.pages === next.pages && p.page === next.page ? p : next));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    row.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(row);
    if (row.firstElementChild) ro?.observe(row.firstElementChild);
    return () => {
      row.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed, rowRef, ...deps]);

  if (!installed || m.ratio >= 0.98) return null;

  const step = (dir) => {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: dir * row.clientWidth * 0.75, behavior: "smooth" });
  };

  // Drag (or tap) the indicator to jump through the row.
  const seek = (e) => {
    const row = rowRef.current;
    const track = trackRef.current;
    if (!row || !track) return;
    const r = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    row.scrollLeft = f * (row.scrollWidth - row.clientWidth);
  };

  // Centred on the items, not on the extra bottom room left for the indicator.
  // Centred on the items, not on the room under them for the indicator.
  const arrowTop = showIndicator ? "top-[calc(50%-6px)]" : indicator === "dots" && m.pages > 1 ? "top-[calc(50%-7px)]" : "top-1/2";
  const arrow = `absolute ${arrowTop} z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-theme-border bg-theme-card text-theme-text shadow-md transition-opacity duration-200 active:scale-90`;

  // Dots mode is Myntra-style: swipe + dots, no arrows over the items.
  const showArrows = indicator !== "dots";

  return (
    <>
      {showArrows && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => step(-1)}
          className={`${arrow} left-1 ${m.canL ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <Chevron dir="left" />
        </button>
      )}
      {showArrows && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => step(1)}
          className={`${arrow} right-1 ${m.canR ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <Chevron dir="right" />
        </button>
      )}
      {/* Position indicator: the padded wrapper is the touch target. */}
      {showIndicator && <div
        className="absolute bottom-0 left-1/2 z-10 -translate-x-1/2 px-2 py-1"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); seek(e); }}
        onPointerMove={(e) => { if (e.buttons || e.pressure) seek(e); }}
        role="presentation"
      >
        <div ref={trackRef} className="relative h-1 w-14 overflow-hidden rounded-full bg-theme-text/15">
          <div
            className="absolute inset-y-0 rounded-full bg-[#335296] dark:bg-[#6b99ff]"
            style={{ width: `${m.ratio * 100}%`, left: `${m.pos * (1 - m.ratio) * 100}%` }}
          />
        </div>
      </div>}
      {indicator === "dots" && m.pages > 1 && (
        // In normal flow under the row (not overlaid), centred.
        <div className="flex items-center justify-center gap-1.5 pt-2" role="tablist" aria-label="Pages">
          {Array.from({ length: m.pages }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === m.page}
              aria-label={`Page ${i + 1}`}
              onClick={() => {
                const row = rowRef.current;
                row?.scrollTo({ left: Math.min(i * row.clientWidth, row.scrollWidth - row.clientWidth), behavior: "smooth" });
              }}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === m.page ? "w-4 bg-[#335296] dark:bg-[#6b99ff]" : "w-1.5 bg-slate-300 dark:bg-zinc-600"
              }`}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default RowSlider;

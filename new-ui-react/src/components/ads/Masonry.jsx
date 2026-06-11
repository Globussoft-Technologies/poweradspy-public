import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Loader2 } from 'lucide-react';

import './Masonry.css';

// Keep GSAP in 3D mode permanently. Default is "auto" — GSAP reverts to 2D
// translate() after a tween settles, which drops the element off its GPU
// layer and re-rasterises it with sub-pixel anti-aliasing. Cards at non-zero
// translate values then look blurry while the card at translate(0,0) stays
// sharp. force3D: true keeps translate3d() applied → stable GPU layer.
gsap.defaults({ force3D: true });

const useMedia = (queries, values, defaultValue) => {
    const get = () => values[queries.findIndex(q => matchMedia(q).matches)] ?? defaultValue;
    const [value, setValue] = useState(get);

    useEffect(() => {
        const handler = () => setValue(get);
        queries.forEach(q => matchMedia(q).addEventListener('change', handler));
        return () => queries.forEach(q => matchMedia(q).removeEventListener('change', handler));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queries]);

    return value;
};

const useMeasure = () => {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        if (!ref.current) return;
        const ro = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setSize({ width, height });
        });
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, []);

    return [ref, size];
};

/**
 * AutoHeightItem — wraps a masonry item and observes its real rendered height.
 * Reports height whenever the card resizes (image load, text reflow, window resize).
 */
const AutoHeightItem = ({ id, children, onMeasure }) => {
    const innerRef = useRef(null);

    useLayoutEffect(() => {
        const el = innerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            const h = entry.contentRect.height;
            if (h > 0) onMeasure(id, h);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [id, onMeasure]);

    return <div ref={innerRef}>{children}</div>;
};

/**
 * Masonry — Pinterest-style responsive masonry grid with GSAP animations.
 *
 * Accepts `items` array where each item has an `id` and `height` (estimated card height).
 * When `autoHeight` is true, heights are taken from `measuredHeights` map (id → px) instead.
 * Uses `renderItem` prop to render each card.
 */
const Masonry = ({
    items,
    renderItem,
    ease = 'power3.out',
    duration = 0.6,
    stagger = 0.05,
    scaleOnHover = true,
    hoverScale = 0.97,
    blurToFocus = true,
    columnConfig = null,
    gap = 10,
    autoHeight = false,
    measuredHeights = {},
    onItemMeasure,
    loading = false,
}) => {
    const defaultColumns = useMedia(
        ['(min-width:1280px)', '(min-width:1024px)', '(min-width:768px)', '(min-width:640px)'],
        [4, 3, 2, 1],
        1
    );
    const overrideColumns = useMedia(
        ['(min-width:1280px)', '(min-width:1024px)', '(min-width:768px)', '(min-width:640px)'],
        columnConfig ? columnConfig.values : [4, 3, 2, 1],
        columnConfig ? columnConfig.default : 1
    );
    const columns = columnConfig ? overrideColumns : defaultColumns;

    const [containerRef, { width }] = useMeasure();

    const colAssignments = useRef({});
    const prevColumns = useRef(columns);
    if (prevColumns.current !== columns) {
        colAssignments.current = {};
        prevColumns.current = columns;
    }

    const grid = useMemo(() => {
        if (!width) return [];

      const colHeights = new Array(columns).fill(0);
      const columnWidth = width / columns;
      // Snap to integer DEVICE pixels (not CSS pixels). Under fractional
      // OS scaling (e.g. 110% / 125% / 150%), CSS pixels don't map 1-to-1
      // to physical pixels, so an integer CSS position can still land on a
      // sub-pixel physical position and trigger anti-aliasing on text.
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const snap = (v) => Math.round(v * dpr) / dpr;

      return items.map((child) => {
        const stringId = String(child.id);
        let col = colAssignments.current[stringId];

        // Assign to the shortest column if it doesn't have an assignment yet
        if (typeof col !== 'number' || col >= columns) {
           let minCol = 0;
           for(let i = 1; i < columns; i++) {
               if (colHeights[i] < colHeights[minCol]) minCol = i;
           }
           col = minCol;
           // Cache the assignment so it doesn't switch columns upon image load
           colAssignments.current[stringId] = col;
        }

        const x = snap(columnWidth * col);
        const rawHeight = autoHeight
          ? measuredHeights[child.id] || child.height || 300
          : child.height || 300;
        const height = rawHeight + gap * 2;
        const y = snap(colHeights[col]);

        colHeights[col] += height;

        return { ...child, x, y, w: snap(columnWidth), h: height };
      });
    }, [columns, items, width, gap, autoHeight, measuredHeights]);

    useEffect(() => {
       const currentIds = new Set(items.map(i => String(i.id)));
       for(const id of Object.keys(colAssignments.current)) {
           if (!currentIds.has(id)) {
               delete colAssignments.current[id];
           }
       }
    }, [items]);

    const containerHeight = useMemo(() => {
        if (grid.length === 0) return 0;
        return Math.max(...grid.map(item => item.y + item.h));
    }, [grid]);

    // Real painted bottom of the tallest column — measured from the DOM after each
    // layout pass. We rely on this (not just the estimated `containerHeight`) so the
    // container is guaranteed to be tall enough even when `child.height` estimates
    // underestimate the true content height — otherwise items overflow the masonry
    // box and paint over anything (like the load-more spinner) rendered beneath it.
    const [domMaxBottom, setDomMaxBottom] = useState(0);

    const remeasureDomBottom = () => {
      const containerEl = containerRef.current;
      if (!containerEl) return;
      const containerTop = containerEl.getBoundingClientRect().top;
      let measuredMax = 0;
      const itemEls = containerEl.querySelectorAll('[data-masonry-key]');
      itemEls.forEach((el) => {
        const r = el.getBoundingClientRect();
        const bottom = r.bottom - containerTop;
        if (bottom > measuredMax) measuredMax = bottom;
      });
      setDomMaxBottom((prev) => (Math.abs(prev - measuredMax) > 0.5 ? measuredMax : prev));
    };

    const hasMounted = useRef(false);
    // Track positioned items: id -> { x, y, w, h }
    const positionedItems = useRef(new Map());

     useLayoutEffect(() => {
      if (!grid.length) return;

      let newItemIndex = 0;

      grid.forEach((item) => {
        const selector = `[data-masonry-key="${item.id}"]`;
        // Position cards with CSS `left`/`top` instead of GSAP transforms.
        // Transforms put each card on its own compositor layer where
        // Chromium picks raster-scale and text-AA mode per-layer using
        // heuristics we can't reliably override — producing inconsistent
        // text crispness across cards regardless of will-change, contain,
        // force3D, integer rounding, or font-smoothing hints. CSS
        // left/top positioning keeps every card on the main render
        // surface so text renders identically on all of them.
        // Trade-off: position animations cause layout, but for one-time
        // entry on a small set of cards that cost is negligible.
        const animationProps = autoHeight
          ? { left: item.x, top: item.y, width: item.w }
          : { left: item.x, top: item.y, width: item.w, height: item.h };

        const prev = positionedItems.current.get(item.id);

        if (!prev) {
          // Immediately place the item at its correct position so items don't stack at 0,0
          gsap.set(selector, { ...animationProps, opacity: 0 });
          // Brand-new item — animate in
          if (!hasMounted.current) {
            // First mount: all cards slide up together
            gsap.fromTo(
              selector,
              {
                opacity: 0,
                left: item.x,
                top: item.y + 30,
                width: item.w,
                ...(autoHeight ? {} : { height: item.h }),
              },
              {
                opacity: 1,
                ...animationProps,
                duration: 0.35,
                ease: "power2.out",
                delay: newItemIndex * 0.01,
              },
            );
          } else {
            // Appended later (infinite scroll) — quick fade in
            gsap.fromTo(
              selector,
              {
                opacity: 0,
                top: item.y + 25,
                left: item.x,
                width: item.w,
                ...(autoHeight ? {} : { height: item.h }),
              },
              {
                opacity: 1,
                ...animationProps,
                duration: 0.3,
                ease: "power2.out",
                delay: newItemIndex * 0.015,
              },
            );
          }
          newItemIndex++;
        } else if (
          prev.x !== item.x ||
          prev.y !== item.y ||
          prev.w !== item.w ||
          prev.h !== item.h
        ) {
          // Existing item whose position changed — smooth move within column
          gsap.to(selector, {
            ...animationProps,
            opacity: 1,
            duration: 0.45,
            ease: "power2.inOut",
            overwrite: true,
          });
        }
        // else: position unchanged — do nothing, no flicker

        // Record current position
        positionedItems.current.set(item.id, {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        });
      });

      // Clean up removed items from the map
      const currentIds = new Set(grid.map((item) => item.id));
      for (const id of positionedItems.current.keys()) {
        if (!currentIds.has(id)) positionedItems.current.delete(id);
      }

      // Read each item's actual painted bottom from the DOM and track the max.
      // `getBoundingClientRect` reflects GSAP's transform and the natural content
      // height in autoHeight mode, so this captures any overflow past the
      // estimated `item.y + item.h` used for `containerHeight`.
      remeasureDomBottom();

      hasMounted.current = true;
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, stagger, blurToFocus, duration, ease, autoHeight]);

    // Continuously track each item's painted bottom — covers the case where the
    // grid hasn't changed but an item resized (e.g. image finished loading and
    // expanded the card). Without this the masonry's minHeight lags behind real
    // content and any sibling rendered below (like the load-more spinner) gets
    // visually overlapped by the still-growing cards.
    useEffect(() => {
      const containerEl = containerRef.current;
      if (!containerEl) return;
      const itemEls = containerEl.querySelectorAll('[data-masonry-key]');
      if (itemEls.length === 0) return;
      const ro = new ResizeObserver(() => remeasureDomBottom());
      itemEls.forEach((el) => ro.observe(el));
      // Also observe nested image elements directly — some browsers don't fire
      // ResizeObserver on the wrapper when only an inner <img> reflows.
      const imgEls = containerEl.querySelectorAll('[data-masonry-key] img');
      imgEls.forEach((el) => ro.observe(el));
      return () => ro.disconnect();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [grid]);


    const handleMouseEnter = (item) => {
        if (scaleOnHover) {
            gsap.to(`[data-masonry-key="${item.id}"]`, {
                scale: hoverScale,
                duration: 0.3,
                ease: 'power2.out',
            });
        }
    };

    const handleMouseLeave = (item) => {
        if (scaleOnHover) {
            gsap.to(`[data-masonry-key="${item.id}"]`, {
                scale: 1,
                duration: 0.3,
                ease: 'power2.out',
            });
        }
    };

    const effectiveHeight = Math.max(containerHeight, domMaxBottom);

    return (
        <>
            <div ref={containerRef} className="masonry-list" style={autoHeight ? { minHeight: effectiveHeight } : { height: effectiveHeight }}>
                {grid.map(item => (
                    <div
                        key={item.id}
                        data-masonry-key={item.id}
                        className={`masonry-item${autoHeight ? ' masonry-item--auto' : ''}`}
                        style={autoHeight ? { padding: gap } : { padding: gap, height: item.h }}
                        onMouseEnter={() => handleMouseEnter(item)}
                        onMouseLeave={() => handleMouseLeave(item)}
                    >
                        <div className="masonry-item-inner" style={autoHeight ? { height: 'auto' } : undefined}>
                            {autoHeight && onItemMeasure ? (
                                <AutoHeightItem id={item.id} onMeasure={onItemMeasure}>
                                    {renderItem(item)}
                                </AutoHeightItem>
                            ) : (
                                renderItem(item)
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {loading && (
                <div
                    className="flex justify-center items-center w-full py-6 relative isolate"
                    style={{ zIndex: 50 }}
                >
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0f111a]/90 border border-white/10 backdrop-blur-sm shadow-lg">
                        <Loader2 className="animate-spin text-[#6b99ff]" size={16} strokeWidth={2.5} />
                        <span className="text-[12px] font-semibold text-white/80 tracking-wide">
                            Loading more ads…
                        </span>
                    </div>
                </div>
            )}
        </>
    );
};

export default Masonry;

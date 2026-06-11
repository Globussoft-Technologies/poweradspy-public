import React, { useState, useRef, useId, useEffect } from "react";

/**
 * SliderFilter — Configurable range slider driven by SDUI.
 *
 * SDUI fields:
 *   slider_scale  "exponential" | "linear"     — value mapping curve
 *   pin_mode      "single" | "double"          — one thumb or two
 *   loose_ends    "none"|"left"|"right"|"both"  — unbounded endpoints
 *   min, max, step, unit                        — range config
 */
const SliderFilter = ({
  label,
  min = 0,
  max = 1000000,
  step,
  unit,
  looseEnds = "none",
  sliderScale = "exponential",
  pinMode = "single",
  value,
  onChange,
}) => {
  const uid = useId();
  const safeMin = min ?? 0;
  const safeMax = max || 1000000;
  const isLinear = sliderScale === "linear";
  const isDouble = pinMode === "double";
  const looseLeft = looseEnds === "left" || looseEnds === "both";
  const looseRight = looseEnds === "right" || looseEnds === "both";

  // Convert a real value back to a 0-100 percent position
  const valueToPct = (v) => {
    if (isLinear) {
      return Math.min(100, Math.max(0, ((v - safeMin) / (safeMax - safeMin)) * 100));
    }
    const effMin = safeMin || 1;
    if (v <= effMin) return 0;
    if (v >= safeMax) return 100;
    return Math.min(100, Math.max(0, (Math.log(v / effMin) / Math.log(safeMax / effMin)) * 100));
  };

  // Initialize from persisted value on mount
  const initFromValue = (v) => {
    if (!v || !Array.isArray(v) || v.length < 2) return [0, 100];
    return [valueToPct(Number(v[0])), valueToPct(Number(v[1]))];
  };

  const [initLow, initHigh] = initFromValue(value);
  // State: 0–100 percent positions for each thumb
  const [lowPct, setLowPct] = useState(initLow);
  const [highPct, setHighPct] = useState(initHigh);
  // In-progress text while the user is typing in the header inputs.
  // null = not editing (show formatted display value).
  const [editingLow, setEditingLow] = useState(null);
  const [editingHigh, setEditingHigh] = useState(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Reset thumbs when value is cleared externally (e.g. "Clear all filters",
  // or removing the chip — `removeChip` sets the value to `false`).
  useEffect(() => {
    if (
      value === undefined ||
      value === null ||
      value === false ||
      (Array.isArray(value) && value.length === 0)
    ) {
      setLowPct(0);
      setHighPct(100);
    }
  }, [value]);

  // ── Value mapping ───────────────────────────────────────────────────
  const pctToValue = (pct) => {
    const p = pct / 100;
    if (isLinear) {
      return Math.round(safeMin + (safeMax - safeMin) * p);
    }
    // Exponential: good for large ranges (0–10M)
    const effMin = safeMin || 1;
    return Math.round(effMin * Math.pow(safeMax / effMin, p));
  };

  const lowValue = pctToValue(lowPct);
  const highValue = pctToValue(highPct);

  // ── Loose-end detection ─────────────────────────────────────────────
  const isAtLooseLeft = lowPct === 0 && looseLeft;
  const isAtLooseRight = highPct === 100 && looseRight;

  // ── Formatting ──────────────────────────────────────────────────────
  // Compact denotation: 5624 → "5.6K", 1234567 → "1.2M", 12000000 → "12M".
  // Sub-1000 values stay exact. Trailing ".0" is dropped so round numbers
  // don't read as "10.0K".
  const fmt = (v) => {
    const abs = Math.abs(v);
    let s;
    if (abs >= 1_000_000_000) {
      s = (v / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
    } else if (abs >= 1_000_000) {
      s = (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    } else if (abs >= 1_000) {
      s = (v / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    } else {
      s = String(v);
    }
    return unit ? `${s} ${unit}` : s;
  };

  const displayLow = isAtLooseLeft ? "Any" : fmt(isDouble ? lowValue : safeMin);
  const displayHigh = isAtLooseRight ? `${fmt(safeMax)}+` : fmt(highValue);

  // ── Emit changes ────────────────────────────────────────────────────
  const emit = (newLowPct, newHighPct) => {
    if (!onChangeRef.current) return;
    // Use safeMin/safeMax instead of null — API always needs a real number
    const lo = newLowPct === 0 && looseLeft ? safeMin : pctToValue(newLowPct);
    const hi =
      newHighPct === 100 && looseRight ? safeMax : pctToValue(newHighPct);
    onChangeRef.current([isDouble ? lo : safeMin, hi]);
  };

  // ── Single-pin handler ──────────────────────────────────────────────
  const handleSingleChange = (e) => {
    const v = parseFloat(e.target.value);
    setHighPct(v);
    emit(0, v);
  };

  // Minimum gap between thumbs (in % of track). Small enough to allow
  // tight ranges at the low end of an exponential scale, but non-zero so
  // the two thumbs remain independently grabbable.
  const MIN_GAP_PCT = 0.1;

  // ── Double-pin handlers ─────────────────────────────────────────────
  const handleLowChange = (e) => {
    const v = Math.min(parseFloat(e.target.value), highPct - MIN_GAP_PCT);
    setLowPct(v);
    emit(v, highPct);
  };

  const handleHighChange = (e) => {
    const v = Math.max(parseFloat(e.target.value), lowPct + MIN_GAP_PCT);
    setHighPct(v);
    emit(lowPct, v);
  };

  // ── Header input commit handlers ────────────────────────────────────
  // Parse a user-typed string into a numeric value, ignoring commas/units.
  const parseTyped = (raw) => {
    const cleaned = String(raw).replace(/[^\d.]/g, "");
    if (cleaned === "") return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const commitLow = (raw) => {
    setEditingLow(null);
    const trimmed = String(raw).trim();
    // Empty input or "any" → snap to loose edge (or safeMin)
    if (trimmed === "" || /^any$/i.test(trimmed)) {
      setLowPct(0);
      emit(0, highPct);
      return;
    }
    const n = parseTyped(trimmed);
    if (n === null) return;
    // Clamp: [safeMin, current highValue]
    const clamped = Math.max(safeMin, Math.min(n, pctToValue(highPct)));
    const newPct = valueToPct(clamped);
    setLowPct(newPct);
    emit(newPct, highPct);
  };

  const commitHigh = (raw) => {
    setEditingHigh(null);
    const trimmed = String(raw).trim();
    // Empty input → snap to loose edge (or safeMax)
    if (trimmed === "") {
      setHighPct(100);
      emit(lowPct, 100);
      return;
    }
    const n = parseTyped(trimmed);
    if (n === null) return;
    // Clamp: [current lowValue (or safeMin for single pin), safeMax]
    const floor = isDouble ? pctToValue(lowPct) : safeMin;
    const clamped = Math.max(floor, Math.min(n, safeMax));
    const newPct = valueToPct(clamped);
    setHighPct(newPct);
    emit(lowPct, newPct);
  };

  const onInputKeyDown = (commit) => (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(e.currentTarget.value);
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditingLow(null);
      setEditingHigh(null);
      e.currentTarget.blur();
    }
  };

  // ── Track fill gradient ─────────────────────────────────────────────
  const trackLeft = isDouble ? lowPct : 0;
  const trackRight = highPct;
  const trackGradient = `linear-gradient(to right, #333 ${trackLeft}%, #335296 ${trackLeft}%, #335296 ${trackRight}%, #333 ${trackRight}%)`;

  const stepAttr = step ? String((step / safeMax) * 100) : "any";

  // When the two thumbs collide at the LEFT edge (both near 0), the low thumb
  // sits on top by default and traps input — handleLowChange clamps to
  // `highPct - MIN_GAP`, which is negative, so neither thumb can move. Promote
  // the high thumb in that case so the user can grab it and drag right.
  const stuckAtLeft = isDouble && highPct < 1;
  const lowThumbZ = stuckAtLeft ? 1 : 3;
  const highThumbZ = stuckAtLeft ? 4 : 2;

  return (
    <div className="px-3 py-2">
      {label && (
        <div className="text-[10px] font-bold text-theme-text-secondary uppercase tracking-widest mb-1.5">
          {label}
        </div>
      )}
      <div className="flex items-center justify-end gap-1 text-[9px] text-theme-text-muted mb-2">
        {isDouble ? (
            <input
              type="text"
              inputMode="numeric"
              aria-label={`${label || "range"} minimum`}
              value={editingLow ?? displayLow}
              onFocus={(e) => {
                // Enter edit mode with the raw numeric value (no unit / "Any")
                setEditingLow(isAtLooseLeft ? "" : String(lowValue));
                requestAnimationFrame(() => e.target.select?.());
              }}
              onChange={(e) => setEditingLow(e.target.value)}
              onBlur={(e) => commitLow(e.target.value)}
              onKeyDown={onInputKeyDown(commitLow)}
              style={{
                width: `${Math.max(3, (editingLow ?? displayLow).length) + 3.5}ch`,
              }}
              className="slider-header-input bg-[#2a2f3d] border border-[#525a70] rounded pl-1.5 pr-2 py-[2px] text-right tabular-nums text-theme-text outline-none transition-colors hover:border-[#7a8499] hover:bg-[#323848] focus:border-[#5a82d6] focus:bg-[#3759a3]/20 focus:text-white"
            />
          ) : (
            <span>{displayLow}</span>
          )}
          <span aria-hidden="true">–</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label={`${label || "range"} maximum`}
            value={editingHigh ?? displayHigh}
            onFocus={(e) => {
              setEditingHigh(isAtLooseRight ? "" : String(highValue));
              requestAnimationFrame(() => e.target.select?.());
            }}
            onChange={(e) => setEditingHigh(e.target.value)}
            onBlur={(e) => commitHigh(e.target.value)}
            onKeyDown={onInputKeyDown(commitHigh)}
            style={{
              width: `${Math.max(3, (editingHigh ?? displayHigh).length) + 3.5}ch`,
            }}
            className="slider-header-input bg-[#2a2f3d] border border-[#525a70] rounded pl-1.5 pr-2 py-[2px] text-right tabular-nums text-theme-text outline-none transition-colors hover:border-[#7a8499] hover:bg-[#323848] focus:border-[#5a82d6] focus:bg-[#3759a3]/20 focus:text-white"
          />
      </div>

      {/* Slider track with overlaid thumbs */}
      <div className="relative h-4 flex items-center">
        {/* Styled track background */}
        <div
          className="absolute left-0 right-0 h-[3px] rounded-full pointer-events-none"
          style={{ background: trackGradient }}
        />

        {isDouble ? (
          <>
            {/* Low thumb */}
            <input
              type="range"
              min="0"
              max="100"
              step={stepAttr}
              value={lowPct}
              onChange={handleLowChange}
              className={`slider-thumb slider-thumb--low ${uid}`}
              style={{ "--thumb-z": lowThumbZ }}
            />
            {/* High thumb */}
            <input
              type="range"
              min="0"
              max="100"
              step={stepAttr}
              value={highPct}
              onChange={handleHighChange}
              className={`slider-thumb slider-thumb--high ${uid}`}
              style={{ "--thumb-z": highThumbZ }}
            />
          </>
        ) : (
          <input
            type="range"
            min="0"
            max="100"
            step={stepAttr}
            value={highPct}
            onChange={handleSingleChange}
            className={`slider-thumb slider-thumb--single ${uid}`}
          />
        )}
      </div>

      {/* Scale labels */}
      <div className="flex justify-between text-[8px] text-theme-text-muted mt-1">
        <span>{looseLeft ? "Any" : fmt(safeMin)}</span>
        {isLinear && (
          <span className="text-[7px] text-theme-text-muted uppercase tracking-widest">
            linear
          </span>
        )}
        <span>{looseRight ? `${fmt(safeMax)}+` : fmt(safeMax)}</span>
      </div>

      {/* Loose-end indicator badges */}
      {(isAtLooseLeft || isAtLooseRight) && (
        <div className="mt-1 flex gap-1">
          {isAtLooseLeft && (
            <span className="text-[8px] px-1.5 py-0.5 bg-[#3762c1]/10 text-[#6b99ff] rounded font-medium">
              No minimum
            </span>
          )}
          {isAtLooseRight && (
            <span className="text-[8px] px-1.5 py-0.5 bg-[#3762c1]/10 text-[#6b99ff] rounded font-medium">
              No maximum
            </span>
          )}
        </div>
      )}

      <style>{`
                .slider-header-input {
                    line-height: 1.2;
                    min-width: 3ch;
                    max-width: 14ch;
                    cursor: text;
                    font-feature-settings: "tnum";
                    /* Modern Chrome/Edge: auto-fit width to typed content.
                       Older browsers fall back to the inline width style. */
                    field-sizing: content;
                }
                .slider-header-input::selection {
                    background: rgba(55, 89, 163, 0.45);
                }
                .slider-thumb {
                    position: absolute;
                    top: -4px;
                    left: 0;
                    width: 100%;
                    appearance: none;
                    -webkit-appearance: none;
                    background: transparent;
                    pointer-events: none;
                    height: 16px;
                    margin: 0;
                    padding: 0;
                    outline: none;
                }
                .slider-thumb::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    height: 12px;
                    width: 12px;
                    border-radius: 50%;
                    background: #335296;
                    cursor: pointer;
                    border: 2px solid var(--color-border);
                    pointer-events: all;
                    position: relative;
                    z-index: var(--thumb-z, 2);
                    box-shadow: 0 0 4px rgba(99,102,241,0.4);
                }
                .slider-thumb::-moz-range-thumb {
                    height: 14px;
                    width: 14px;
                    border-radius: 50%;
                    background: #335296;
                    cursor: pointer;
                    border: 2px solid var(--color-border);
                    pointer-events: all;
                    position: relative;
                    z-index: var(--thumb-z, 2);
                    box-shadow: 0 0 4px rgba(99,102,241,0.4);
                }
                .slider-thumb::-webkit-slider-runnable-track {
                    background: transparent;
                    height: 4px;
                }
                .slider-thumb::-moz-range-track {
                    background: transparent;
                    height: 4px;
                }
            `}</style>
    </div>
  );
};

export default SliderFilter;

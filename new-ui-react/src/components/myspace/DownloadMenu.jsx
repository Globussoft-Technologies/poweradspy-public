import { useEffect, useState } from 'react';
import { Check, ChevronDown, Download } from 'lucide-react';
import {
  useFloating, offset, flip, shift, autoUpdate, FloatingPortal, useClick, useDismiss, useInteractions,
} from '@floating-ui/react';

// Converted server-side (GET /imageGen/jobs/:id/download?format=…).
export const DOWNLOAD_FORMATS = [
  { value: 'png', label: 'PNG', hint: 'Best quality · lossless' },
  { value: 'jpeg', label: 'JPEG', hint: 'Smaller file · no transparency' },
  { value: 'webp', label: 'WEBP', hint: 'Smallest file · modern apps' },
  { value: 'svg', label: 'SVG', hint: 'For design tools · embeds the image' },
];

const STORAGE_KEY = 'pas.imagegen.downloadFormat';
const CHANGE_EVENT = 'pas-imagegen-download-format';

export function getLastDownloadFormat() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return DOWNLOAD_FORMATS.some((f) => f.value === value) ? value : 'png';
  } catch {
    return 'png';
  }
}

function rememberFormat(value) {
  try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode etc. */ }
  // Keep every mounted menu (card, drawer, lightbox) showing the same choice.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }));
}

const stop = (e) => e.stopPropagation();

/**
 * variant="split": "Download PNG" + ▾ format menu (drawer footer).
 * variant="icon":  a single button that opens the format menu (card hover,
 *                  drawer image hover, lightbox). Children render inside it.
 * Clicks never bubble to the card/drawer behind it (React bubbles through portals).
 */
export default function DownloadMenu({ variant = 'icon', onDownload, className = '', ariaLabel = 'Download', placement, children }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState(getLastDownloadFormat);

  useEffect(() => {
    const sync = (e) => setFormat(e.detail);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: placement || (variant === 'split' ? 'top-end' : 'bottom-end'),
    middleware: [offset(6), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);

  const pick = (value) => {
    setFormat(value);
    rememberFormat(value);
    setOpen(false);
    onDownload?.(value);
  };
  const current = DOWNLOAD_FORMATS.find((f) => f.value === format) || DOWNLOAD_FORMATS[0];

  const menu = open ? (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
        {...getFloatingProps({ onClick: stop, onMouseDown: stop, onPointerDown: stop })}
        className="dl-menu"
        role="menu"
      >
        <div className="dl-menu-title">Download as</div>
        {DOWNLOAD_FORMATS.map((f) => (
          <button
            key={f.value}
            role="menuitemradio"
            aria-checked={f.value === format}
            className={`dl-opt ${f.value === format ? 'on' : ''}`}
            onClick={() => pick(f.value)}
          >
            <span><b>{f.label}</b><small>{f.hint}</small></span>
            {f.value === format ? <Check /> : null}
          </button>
        ))}
      </div>
    </FloatingPortal>
  ) : null;

  if (variant === 'split') {
    return (
      <div className={`dl-split ${className}`} onClick={stop}>
        <button className="dl-main" onClick={() => onDownload?.(format)}><Download /> Download {current.label}</button>
        <button ref={refs.setReference} {...getReferenceProps()} className="dl-caret" aria-label="Choose download format" aria-haspopup="menu" aria-expanded={open}>
          <ChevronDown />
        </button>
        {menu}
      </div>
    );
  }

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps({ onClick: stop })}
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {children || <Download />}
      </button>
      {menu}
    </>
  );
}

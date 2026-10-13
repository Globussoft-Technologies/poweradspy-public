import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from 'lucide-react';
import DownloadMenu from './DownloadMenu';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
const imageUrl = (item) => { const image = item?.result?.images?.[0]; return typeof image === 'string' ? image : image?.url; };
const nameOf = (item) => item?.source?.advertiser || `${String(item?.source?.network || 'Ad').replace(/^./, (c) => c.toUpperCase())} ad`;

/**
 * Full-screen preview: dark overlay, image at full size, zoom 1x–4x (wheel,
 * +/−, double-click) with drag-to-pan, ←/→ between images, Esc to close.
 * Keys are caught in the capture phase so the drawer underneath never sees them.
 */
export default function ImageLightbox({ items, startIndex = 0, onClose, onDownload }) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const zoomRef = useRef(1);

  const item = items[index];
  const url = imageUrl(item);
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => { zoomRef.current = 1; setZoom(1); setPan({ x: 0, y: 0 }); }, [index]);

  // Keep the pan inside the zoomed image's overflow.
  const clampPan = useCallback((p, z) => {
    const img = imgRef.current;
    if (!img || z <= 1) return { x: 0, y: 0 };
    const maxX = (img.offsetWidth * (z - 1)) / 2;
    const maxY = (img.offsetHeight * (z - 1)) / 2;
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
  }, []);

  const applyZoom = useCallback((next) => {
    const current = zoomRef.current;
    const z = clampZoom(typeof next === 'function' ? next(current) : next);
    if (z === current) return;
    zoomRef.current = z;
    setZoom(z);
    setPan((p) => clampPan(z === 1 ? { x: 0, y: 0 } : { x: (p.x * z) / current, y: (p.y * z) / current }, z));
  }, [clampPan]);

  const go = useCallback((step) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + step))), [items.length]);

  useEffect(() => {
    const onKey = (e) => {
      const handled = { Escape: () => onClose(), ArrowLeft: () => go(-1), ArrowRight: () => go(1), '+': () => applyZoom((z) => z + 0.5), '=': () => applyZoom((z) => z + 0.5), '-': () => applyZoom((z) => z - 0.5), 0: () => applyZoom(1) }[e.key];
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
      handled();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, go, applyZoom]);

  // Native, non-passive wheel listener so the page never scrolls behind.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (e) => { e.preventDefault(); applyZoom((z) => z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  const onPointerDown = (e) => {
    moved.current = false;
    if (zoom <= 1 || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, pan };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
    setPan(clampPan({ x: drag.current.pan.x + dx, y: drag.current.pan.y + dy }, zoom));
  };
  const onPointerUp = () => { drag.current = null; };

  if (!item) return null;
  const date = item.created_at ? new Date(item.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  return createPortal(
    <div className="lb" role="dialog" aria-modal="true" aria-label="Image preview">
      <header className="lb-bar">
        <div className="lb-info">
          <b>Recreated from {nameOf(item)}</b>
          <span>{[item.request?.aspect_ratio, date, `${index + 1} / ${items.length}`].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="lb-tools">
          <div className="lb-zoom">
            <button aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => applyZoom((z) => z - 0.5)}><Minus /></button>
            <button className="lb-pct" aria-label="Reset zoom" onClick={() => applyZoom(1)}>{Math.round(zoom * 100)}%</button>
            <button aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => applyZoom((z) => z + 0.5)}><Plus /></button>
          </div>
          <DownloadMenu className="lb-btn" onDownload={(format) => onDownload(item, format)}><Download /> <span>Download</span></DownloadMenu>
          <button className="lb-btn lb-close" aria-label="Close preview" onClick={onClose}><X /></button>
        </div>
      </header>

      <div
        ref={stageRef}
        className={`lb-stage ${zoom > 1 ? 'zoomed' : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget && !moved.current) onClose(); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {url ? (
          <img
            ref={imgRef}
            src={url}
            alt={`Generated creative from ${nameOf(item)}`}
            draggable={false}
            onDoubleClick={() => applyZoom(zoom > 1 ? 1 : 2)}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: drag.current ? 'none' : 'transform .15s ease' }}
          />
        ) : null}
        {hasPrev ? <button className="lb-nav prev" aria-label="Previous image" onClick={() => go(-1)}><ChevronLeft /></button> : null}
        {hasNext ? <button className="lb-nav next" aria-label="Next image" onClick={() => go(1)}><ChevronRight /></button> : null}
      </div>
    </div>,
    document.body,
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Calendar, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, Image as ImageIcon, RefreshCw, Search, Sparkle, Trash2, X } from 'lucide-react';
import { autoUpdate, flip, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions } from '@floating-ui/react';
import { deleteImageGenJob, downloadImageGenImage, fetchLandingAd, getImageGenJob, listMySpace } from '../../services/api';
import { useImageGenCredits } from '../../hooks/useImageGenCredits';
import GeneratedImageDetailDrawer from './GeneratedImageDetailDrawer';
import DownloadMenu, { getLastDownloadFormat } from './DownloadMenu';
import './myspace.css';
import '../shared/floating-popover.css';

const PAGE_SIZE = 24;
const ACTIVE = new Set(['queued', 'running']);
const pad = (v) => String(v).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (v) => { const [y, m, d] = String(v || '').split('-').map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysAgo = (n) => { const d = today(); d.setDate(d.getDate() - n); return d; };
const niceDate = (v, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => { const d = v instanceof Date ? v : parseKey(v) || new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, opts); };
const cardDate = (v) => { const d = new Date(v); if (Number.isNaN(d.getTime())) return '—'; const z = new Date(d); z.setHours(0, 0, 0, 0); const diff = Math.round((today() - z) / 86400000); const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); return diff === 0 ? `Today, ${t}` : diff === 1 ? `Yesterday, ${t}` : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${t}`; };
const imageUrl = (item) => { const image = item?.result?.images?.[0]; return typeof image === 'string' ? image : image?.url; };
const advertiser = (item) => item?.source?.advertiser || `${String(item?.source?.network || 'Ad').replace(/^./, (c) => c.toUpperCase())} ad`;
const ratioStyle = (ratio) => { const [w, h] = String(ratio || '1:1').split(':').map(Number); return { aspectRatio: `${w || 1} / ${h || 1}` }; };
const dayBounds = (start, end = start) => { const a = new Date(start); const b = new Date(end); a.setHours(0, 0, 0, 0); b.setHours(23, 59, 59, 999); return { from: a.toISOString(), to: b.toISOString() }; };
const ranges = (range, from, to) => range === 'today' ? dayBounds(today()) : range === '7d' ? dayBounds(daysAgo(6), today()) : range === '30d' ? dayBounds(daysAgo(29), today()) : from && to ? dayBounds(parseKey(from), parseKey(to)) : {};
const rangeText = (range, from, to) => range === 'today' ? 'today' : range === '7d' ? 'in the last 7 days' : range === 'custom' && from && to ? `between ${niceDate(from, { day: 'numeric', month: 'short' })} and ${niceDate(to, { day: 'numeric', month: 'short' })}` : 'in the last 30 days';
const toAd = (item) => ({ id: item.source?.ad_id, adId: item.source?.ad_id, network: item.source?.network, advertiser: item.source?.advertiser, thumbnail: item.source?.image_url, recreateDefaults: { aspectRatio: item.request?.aspect_ratio, prompt: item.request?.prompt, brandWebsite: item.request?.brand_website, productImageUrl: item.request?.product_image_url, productImage: item.request?.product_image, extraImageUrls: item.request?.extra_image_urls || [] } });

function RangePicker({ initialFrom, initialTo, close, apply }) {
  const [from, setFrom] = useState(initialFrom || ''); const [to, setTo] = useState(initialTo || '');
  const [picking, setPicking] = useState(initialFrom && !initialTo ? 'to' : 'from'); const [hover, setHover] = useState('');
  const seed = parseKey(initialFrom) || new Date(); const [month, setMonth] = useState(new Date(seed.getFullYear(), seed.getMonth(), 1));
  useEffect(() => { const esc = (e) => e.key === 'Escape' && close(); document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [close]);
  const first = new Date(month.getFullYear(), month.getMonth(), 1); const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const end = picking === 'to' ? (hover || to) : to; const low = from && end ? [from, end].sort()[0] : ''; const high = from && end ? [from, end].sort()[1] : '';
  const count = from && to ? Math.round((parseKey(to) - parseKey(from)) / 86400000) + 1 : 0; const nowKey = dateKey(new Date());
  const current = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();
  const choose = (key) => { if (picking === 'from') { setFrom(key); setTo(''); setPicking('to'); } else { const pair = [from, key].sort(); setFrom(pair[0]); setTo(pair[1]); setPicking('from'); setHover(''); } };
  return <div className="ms-rp" role="dialog" aria-label="Choose custom date range">
    <div className="ms-rp-inputs"><button className={`ms-rp-in ${picking === 'from' ? 'on' : ''}`} onClick={() => setPicking('from')}><small>FROM</small><b>{from ? niceDate(from) : 'Select date'}</b></button><button className={`ms-rp-in ${picking === 'to' ? 'on' : ''}`} onClick={() => setPicking('to')}><small>TO</small><b>{to ? niceDate(to) : 'Select date'}</b></button></div>
    <div className="ms-rp-nav"><button className="ms-nb" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></button><span>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span><button className="ms-nb" disabled={current} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></button></div>
    <div className="ms-cal">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span className="ms-wd" key={d}>{d}</span>)}{cells.map((d) => { const key = dateKey(d); const cls = ['ms-d', d.getMonth() !== month.getMonth() && 'mut', key > nowKey && 'off', low && key > low && key < high && 'in', key === low && 'st', key === high && 'en'].filter(Boolean).join(' '); return <button key={key} className={cls} disabled={key > nowKey} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover('')} onClick={() => choose(key)}>{d.getDate()}</button>; })}</div>
    <div className="ms-rp-ft"><span>{count ? `${count} day${count === 1 ? '' : 's'}` : 'Select both dates'}</span><button className="ms-btn ms-cancel" onClick={close}>Cancel</button><button className="ms-btn ms-apply" disabled={!from || !to} onClick={() => apply(from, to)}>Apply</button></div>
  </div>;
}

function Empty({ credits, browse }) { return <div className="ms-empty"><div className="ms-empty-i"><div className="ms-illustration" aria-hidden="true"><span className="ms-illus-circle"/><span className="ms-spark s1">✦</span><span className="ms-spark s2">✦</span><span className="ms-card-back"><i/><b/><em/></span><span className="ms-card-front"><i>✦</i><b/><em/></span></div><h2>No images yet</h2><p>Find an ad you like in the Ads Library and click <b>Recreate</b></p><button className="ms-empty-cta" onClick={browse}><Sparkle fill="currentColor"/> Browse Ads Library</button><span className="ms-empty-note">You have {credits ?? '—'} credits · 1 credit = 1 image</span></div></div>; }
function useMasonryColumns() {
  const getCount = () => { const w = window.innerWidth; return w >= 1700 ? 6 : w >= 1350 ? 5 : w >= 1050 ? 4 : w >= 760 ? 3 : w >= 520 ? 2 : 1; };
  const [count, setCount] = useState(getCount);
  useEffect(() => { const resize = () => setCount(getCount()); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  return count;
}
function MasonryGrid({ items, columnCount, open, remove, recreate, download, highlightedId, clearHighlight, registerCard }) {
  const columns = useMemo(() => {
    const lanes = Array.from({ length: columnCount }, () => []);
    const laneHeights = Array.from({ length: columnCount }, () => 0);
    items.forEach((item) => {
      const [width, height] = String(item.request?.aspect_ratio || '1:1').split(':').map(Number);
      const fixedThumb = item.status !== 'succeeded';
      const estimatedHeight = (fixedThumb ? 0.6 : (height || 1) / (width || 1)) + 0.28;
      const shortestLane = laneHeights.indexOf(Math.min(...laneHeights));
      lanes[shortestLane].push(item);
      laneHeights[shortestLane] += estimatedHeight;
    });
    return lanes;
  }, [items, columnCount]);
  return <div className="ms-grid" style={{ '--ms-columns': columnCount }}>{columns.map((column, index) => <div className="ms-column" key={`lane-${index}`}>{column.map((item) => <Card key={item.id || item.job_id} item={item} open={open} remove={remove} recreate={recreate} download={download} highlighted={highlightedId === item.job_id} clearHighlight={clearHighlight} registerCard={registerCard}/>)}</div>)}</div>;
}
function Skeletons({ columnCount }) { const columns = Array.from({ length: columnCount }, () => []); Array.from({ length: 12 }, (_, i) => <div className="ms-skeleton" style={{ height: 245 + (i % 3) * 42 }} key={i}/>).forEach((card, index) => columns[index % columnCount].push(card)); return <div className="ms-grid" style={{ '--ms-columns': columnCount }}>{columns.map((column, index) => <div className="ms-column" key={`skeleton-lane-${index}`}>{column}</div>)}</div>; }

function Card({ item, open, remove, recreate, download, highlighted, clearHighlight, registerCard }) {
  const active = ACTIVE.has(item.status); const failed = ['failed', 'cancelled'].includes(item.status); const done = item.status === 'succeeded'; const viewable = done || failed; const url = imageUrl(item); const name = advertiser(item); const ratio = item.request?.aspect_ratio || '1:1';
  return <article ref={(node) => registerCard(item.job_id, node)} className={`ms-card gc ${done ? 'is-done' : ''} ${failed ? 'is-failed' : ''} ${active ? 'is-generating' : ''} ${highlighted ? 'hl' : ''}`} tabIndex={viewable ? 0 : -1} onMouseEnter={() => highlighted && clearHighlight()} onClick={() => { if (highlighted) clearHighlight(); if (viewable) open(item); }} onKeyDown={(e) => { if (viewable && ['Enter', ' '].includes(e.key)) { if (highlighted) clearHighlight(); open(item); } }}><div className="ms-thumb" style={ratioStyle(ratio)}><div className="ms-card-chips"><span className="ms-ratio">{ratio}</span>{highlighted ? <span className="ms-new-badge">New</span> : null}</div>
    {done && url ? <div className="ms-image"><img src={url} alt={`Generated creative from ${name}`} loading="lazy" decoding="async"/></div> : null}
    {active ? <div className="ms-image ms-generating"><span className="ms-ring"/><b>Generating…</b><small>Usually 15–40 sec</small></div> : null}
    {failed ? <div className="ms-image ms-failed"><AlertCircle/><b>Generation failed</b><small>Your credit was refunded</small><div className="ms-failed-actions"><button onClick={(e) => { e.stopPropagation(); recreate(item); }}><RefreshCw/> Try again</button><button className="delete" onClick={(e) => { e.stopPropagation(); remove(item); }}><Trash2/> Delete</button></div></div> : null}
    {done ? <div className="ms-hover"><div className="ms-actions"><DownloadMenu ariaLabel="Download" onDownload={(format) => download(item, format)}><Download/><span>Download</span></DownloadMenu><button className="recreate" onClick={(e) => { e.stopPropagation(); recreate(item); }}><Sparkle fill="currentColor"/><span>Recreate again · 1 credit</span></button><button className="delete" onClick={(e) => { e.stopPropagation(); remove(item); }}><Trash2/><span>Delete</span></button></div><span className="ms-view"><Eye/> View details</span></div> : null}
  </div><div className="ms-card-body"><div className="ms-from">{item.source?.image_url ? <img src={item.source.image_url} alt="" loading="lazy" decoding="async"/> : null}<span>Recreated from <b>{name}</b></span></div><div className="ms-meta"><span>{cardDate(item.created_at)}</span>{active ? <b className="generating">Generating…</b> : failed ? <b className="failed">Failed</b> : null}</div></div></article>;
}

export default function MySpacePage({ onBrowseAds, onRecreate, onOpenOriginalAd, onShowToast, refreshVersion = 0 }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams(); const rawRange = params.get('range'); const range = ['today', '7d', '30d', 'custom'].includes(rawRange) ? rawRange : '30d'; const sort = params.get('sort') === 'oldest' ? 'oldest' : 'newest'; const from = params.get('from') || ''; const to = params.get('to') || ''; const q = params.get('q') || ''; const statusFilter = ['succeeded', 'failed'].includes(params.get('status')) ? params.get('status') : ''; const highlightId = params.get('highlight') || '';
  const [search, setSearch] = useState(q); const [debounced, setDebounced] = useState(q); const [rangeOpen, setRangeOpen] = useState(false); const [sortOpen, setSortOpen] = useState(false); const [items, setItems] = useState([]); const [cursor, setCursor] = useState(null); const [total, setTotal] = useState(0); const [totalAll, setTotalAll] = useState(null); const [statusCounts, setStatusCounts] = useState({ all: 0, succeeded: 0, failed: 0, active: 0 }); const { summary: creditsSummary, balance: liveBalance, refresh: refreshCredits } = useImageGenCredits(); const credits = creditsSummary ? { ...creditsSummary, balance: liveBalance ?? creditsSummary.balance } : (typeof liveBalance === 'number' ? { balance: liveBalance } : null); const [loading, setLoading] = useState(true); const [more, setMore] = useState(false); const [error, setError] = useState(''); const [selected, setSelected] = useState(null); const sentinel = useRef(null); const seq = useRef(0); const fetching = useRef(false); const seenRefreshVersion = useRef(refreshVersion);
  const { refs: sortRefs, floatingStyles: sortFloatingStyles, context: sortContext, isPositioned: sortIsPositioned, x: sortX, y: sortY } = useFloating({ open: sortOpen, onOpenChange: setSortOpen, placement: 'bottom-end', strategy: 'fixed', middleware: [offset(6), flip({ padding: 12 }), shift({ padding: 12 })], whileElementsMounted: autoUpdate });
  const sortDismiss = useDismiss(sortContext, { outsidePress: true, escapeKey: true });
  const { getReferenceProps: getSortReferenceProps, getFloatingProps: getSortFloatingProps } = useInteractions([sortDismiss]);
  const sortPositioned = typeof sortIsPositioned === 'boolean' ? sortIsPositioned : sortX != null && sortY != null;
  const sourceAdCache = useRef(new Map());
  const cardNodes = useRef(new Map());
  const highlightTimer = useRef(null);
  const highlightHandled = useRef('');
  const highlightFetch = useRef('');
  const drawerPushed = useRef(false);
  const [highlightedId, setHighlightedId] = useState('');
  const dates = useMemo(() => ranges(range, from, to), [range, from, to]);
  const columnCount = useMasonryColumns();
  const updateParams = useCallback((updates) => {
    const next = new URLSearchParams(params);
    Object.entries(updates).forEach(([key, value]) => {
      const isDefault = (key === 'range' && value === '30d') || (key === 'sort' && value === 'newest');
      if (!value || isDefault) next.delete(key);
      else next.set(key, value);
    });
    setParams(next, { replace: true });
  }, [params, setParams]);
  const registerCard = useCallback((id, node) => {
    if (node) cardNodes.current.set(id, node);
    else cardNodes.current.delete(id);
  }, []);
  const clearHighlight = useCallback(() => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = null;
    setHighlightedId('');
  }, []);
  const startHighlight = useCallback((id) => {
    highlightHandled.current = id;
    setHighlightedId(id);
    updateParams({ highlight: '' });
    let attempts = 0;
    const scrollWhenReady = () => {
      const card = cardNodes.current.get(id);
      if (card?.querySelector('.ms-thumb')) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (attempts++ < 20) window.requestAnimationFrame(scrollWhenReady);
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(scrollWhenReady));
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => { highlightTimer.current = null; setHighlightedId(''); }, 3000);
  }, [updateParams]);
  useEffect(() => { const id = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(id); }, [search]);
  useEffect(() => { setSearch(q); setDebounced(q); }, [q]);
  useEffect(() => { if (debounced !== q) updateParams({ q: debounced }); }, [debounced, q, updateParams]);
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);
  const load = useCallback(async (append = false) => { const call = append ? seq.current : ++seq.current; append ? setMore(true) : setLoading(true); setError(''); try { const res = await listMySpace({ ...dates, status: statusFilter === 'failed' ? 'failed,cancelled' : statusFilter || undefined, q: q || undefined, sort, cursor: append ? cursor : undefined, limit: PAGE_SIZE }); if (call !== seq.current) return; const data = res?.data || {}; setItems((old) => append ? [...old, ...(data.items || [])] : (data.items || [])); setCursor(data.next_cursor || null); setTotal(Number(data.total ?? data.items?.length ?? 0)); setTotalAll(Number(data.total_all ?? data.total ?? data.items?.length ?? 0)); setStatusCounts({ all: Number(data.status_counts?.all ?? data.total ?? 0), succeeded: Number(data.status_counts?.succeeded ?? 0), failed: Number(data.status_counts?.failed ?? 0), active: Number(data.status_counts?.active ?? 0) }); } catch (e) { if (call === seq.current) setError(e.message || 'Could not load MySpace right now.'); } finally { if (call === seq.current) { setLoading(false); setMore(false); fetching.current = false; } } }, [cursor, dates, q, sort, statusFilter]);
  useEffect(() => { setCursor(null); load(false); }, [dates.from, dates.to, q, sort, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (seenRefreshVersion.current === refreshVersion) return; seenRefreshVersion.current = refreshVersion; setCursor(null); load(false); refreshCredits(); }, [refreshVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refreshCredits(); }, [refreshCredits]);
  useEffect(() => {
    const missing = items.filter((item) => {
      const key = `${item.source?.network || ''}:${item.source?.ad_id || ''}`;
      return !item.source?.advertiser && item.source?.network && item.source?.ad_id && !sourceAdCache.current.has(key);
    });
    if (!missing.length) return undefined;
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const item = missing[next++];
        const key = `${item.source.network}:${item.source.ad_id}`;
        // Mark pending before awaiting so polling/list updates cannot enqueue a duplicate.
        sourceAdCache.current.set(key, null);
        try {
          const result = await fetchLandingAd(item.source.network, item.source.ad_id);
          sourceAdCache.current.set(key, result?.ads?.[0] || null);
        } catch { sourceAdCache.current.set(key, null); }
      }
    };
    Promise.all(Array.from({ length: Math.min(3, missing.length) }, worker)).then(() => {
      setItems((current) => current.map((item) => {
        const sourceAd = sourceAdCache.current.get(`${item.source?.network || ''}:${item.source?.ad_id || ''}`);
        if (!sourceAd?.advertiser) return item;
        return { ...item, source: { ...item.source, advertiser: sourceAd.advertiser, running_days: sourceAd.runningDays ?? item.source?.running_days } };
      }));
    });
    return undefined;
  }, [items]);
  useEffect(() => { const node = sentinel.current; if (!node || !cursor) return; const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !fetching.current) { fetching.current = true; load(true); } }, { rootMargin: '500px' }); io.observe(node); return () => io.disconnect(); }, [cursor, load]);
  useEffect(() => { if (!items.some((x) => ACTIVE.has(x.status))) return; const id = setInterval(async () => { const updates = await Promise.all(items.filter((x) => ACTIVE.has(x.status)).map((x) => getImageGenJob(x.job_id).then((r) => r?.data).catch(() => null))); setItems((old) => old.map((x) => { const update = updates.find((u) => u?.job_id === x.job_id); if (!update) return x; if (ACTIVE.has(x.status) && !ACTIVE.has(update.status)) setStatusCounts((counts) => ({ ...counts, active: Math.max(0, counts.active - 1), succeeded: counts.succeeded + (update.status === 'succeeded' ? 1 : 0), failed: counts.failed + (['failed', 'cancelled'].includes(update.status) ? 1 : 0) })); return { ...update, source: { ...update.source, advertiser: update.source?.advertiser || x.source?.advertiser, running_days: update.source?.running_days ?? x.source?.running_days } }; })); }, 3000); return () => clearInterval(id); }, [items]);
  useEffect(() => {
    if (!highlightId) {
      highlightHandled.current = '';
      highlightFetch.current = '';
      return;
    }
    if (loading || highlightHandled.current === highlightId) return;
    if (items.some((item) => item.job_id === highlightId)) {
      startHighlight(highlightId);
      return;
    }
    if (range !== '30d' || statusFilter || q || from || to) {
      setLoading(true);
      setSearch('');
      setDebounced('');
      updateParams({ range: '30d', from: '', to: '', q: '', status: '' });
      return;
    }
    if (highlightFetch.current === highlightId) return;
    highlightFetch.current = highlightId;
    getImageGenJob(highlightId)
      .then((response) => {
        const item = response?.data;
        if (!item?.job_id) throw new Error('Image not found');
        setItems((current) => current.some((entry) => entry.job_id === item.job_id) ? current : [item, ...current]);
      })
      .catch(() => {
        highlightHandled.current = highlightId;
        updateParams({ highlight: '' });
        onShowToast?.('That generated image could not be found.', 'error');
      })
      .finally(() => { highlightFetch.current = ''; });
  }, [from, highlightId, items, loading, onShowToast, q, range, startHighlight, statusFilter, to, updateParams]);
  useEffect(() => { const id = params.get('image'); if (!id) { setSelected(null); return; } const found = items.find((x) => x.job_id === id); if (found) { setSelected(found); return; } if (!loading) getImageGenJob(id).then((r) => { if (r?.data) setSelected(r.data); }).catch(() => updateParams({ image: '' })); }, [items, params, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (item) => {
    setSelected(item);
    const next = new URLSearchParams(params);
    next.set('image', item.job_id);
    next.delete('highlight');
    drawerPushed.current = true;
    setParams(next);
  };
  const close = () => {
    setSelected(null);
    if (drawerPushed.current) {
      drawerPushed.current = false;
      navigate(-1);
      return;
    }
    updateParams({ image: '' });
  };
  const move = (n) => {
    const i = items.findIndex((x) => x.job_id === selected?.job_id);
    const nextItem = items[i + n];
    if (!nextItem) return;
    setSelected(nextItem);
    updateParams({ image: nextItem.job_id });
  };
  const remove = async (item) => { if (!window.confirm("Delete this image? This can't be undone.")) return; const snapshot = items; const countsSnapshot = statusCounts; setItems((old) => old.filter((x) => x.job_id !== item.job_id)); setTotal((x) => Math.max(0, x - 1)); setTotalAll((x) => Math.max(0, x - 1)); setStatusCounts((counts) => ({ ...counts, all: Math.max(0, counts.all - 1), succeeded: Math.max(0, counts.succeeded - (item.status === 'succeeded' ? 1 : 0)), failed: Math.max(0, counts.failed - (['failed', 'cancelled'].includes(item.status) ? 1 : 0)), active: Math.max(0, counts.active - (ACTIVE.has(item.status) ? 1 : 0)) })); if (selected?.job_id === item.job_id) close(); try { await deleteImageGenJob(item.job_id); onShowToast?.('Image deleted', 'success'); } catch { setItems(snapshot); setStatusCounts(countsSnapshot); setTotal((x) => x + 1); setTotalAll((x) => x + 1); onShowToast?.('Could not delete this image.', 'error'); } };
  const download = async (item, format) => { if (!imageUrl(item)) return; const name = advertiser(item).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'image'; try { await downloadImageGenImage(item.job_id, format || getLastDownloadFormat(), `recreate-${name}-${item.job_id}`); } catch { onShowToast?.('Could not download this image.', 'error'); } };
  const recreate = (item) => onRecreate?.(toAd(item)); const browse = () => onBrowseAds?.(); const clear = () => { setSearch(''); setDebounced(''); updateParams({ range: '30d', from: '', to: '', q: '', status: '', sort: 'newest', image: '' }); };
  const recreateFromDrawer = (item) => {
    close();
    // Let the high-z-index drawer unmount before mounting the Recreate modal;
    // otherwise the modal is present but visually appears behind the drawer.
    window.requestAnimationFrame(() => recreate(item));
  };
  const custom = range === 'custom' && from && to ? `${niceDate(from, { day: 'numeric', month: 'short' })} – ${niceDate(to, { day: 'numeric', month: 'short' })}` : 'Custom range';
  const setStatusFilter = (status) => updateParams({ status, image: '' });
  const clearDateFilter = () => { setRangeOpen(false); updateParams({ range: '30d', from: '', to: '', image: '' }); };
  const initialLoading = loading && items.length === 0 && totalAll === null;
  return <main className="myspace-page"><header className="ms-header"><div><h1>MySpace</h1><p>All images you’ve generated</p></div><div className="ms-pills"><span className="ms-pill"><i style={{ background: 'var(--ps-accent-strong)' }}/><b>{initialLoading ? '—' : statusCounts.all}</b> image{statusCounts.all === 1 ? '' : 's'}</span><span className="ms-pill"><i style={{ background: 'var(--ps-violet)' }}/><b>{credits?.balance ?? '—'}</b> credits left</span>{credits?.cycle_resets_at ? <span className="ms-pill"><i style={{ background: 'var(--ps-success)' }}/>Refreshes <b>{niceDate(credits.cycle_resets_at)}</b></span> : null}</div><button className="ms-browse" onClick={browse}><Sparkle fill="currentColor"/> Recreate from Ads Library</button></header>
    {!loading && totalAll === 0 && !highlightId && !highlightedId ? <Empty credits={credits?.balance} browse={browse}/> : <>
      <div className="ms-toolbar">
        <div className="ms-segments"><button className={range === 'today' ? 'on' : ''} onClick={() => updateParams({ range: 'today', from: '', to: '', image: '' })}>Today</button><button className={range === '7d' ? 'on' : ''} onClick={() => updateParams({ range: '7d', from: '', to: '', image: '' })}>Last 7 days</button><button className={range === '30d' ? 'on' : ''} onClick={() => updateParams({ range: '30d', from: '', to: '', image: '' })}>Last 30 days</button><div className={`ms-range-wrap ${range === 'custom' ? 'on' : ''}`}><button className="ms-range-trigger" onClick={() => setRangeOpen(!rangeOpen)}><Calendar/><span>{custom}</span></button><button className="ms-range-clear" aria-label="Clear custom date filter" title="Clear custom date filter" onClick={(event) => { event.stopPropagation(); if (range === 'custom') clearDateFilter(); }}><X/></button>{rangeOpen ? <RangePicker initialFrom={from} initialTo={to} close={() => setRangeOpen(false)} apply={(a, b) => { setRangeOpen(false); updateParams({ range: 'custom', from: a, to: b, image: '' }); }}/> : null}</div></div>
        <div className="ms-status-segments" aria-label="Filter images by status"><button className={!statusFilter ? 'on' : ''} aria-pressed={!statusFilter} onClick={() => setStatusFilter('')}>All</button><button className={statusFilter === 'succeeded' ? 'on' : ''} aria-pressed={statusFilter === 'succeeded'} onClick={() => setStatusFilter('succeeded')}>Success</button><button className={statusFilter === 'failed' ? 'on' : ''} aria-pressed={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')}>Failed</button></div>
        <label className="ms-search"><Search/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by advertiser or prompt"/></label>
        <div className="ms-sort-wrap">
          <button ref={sortRefs.setReference} {...getSortReferenceProps({ onClick: () => setSortOpen(!sortOpen) })} className="ms-sort"><span>⇅</span> {sort === 'oldest' ? 'Oldest first' : 'Newest first'} <ChevronDown/></button>
          {sortOpen ? <FloatingPortal><div ref={sortRefs.setFloating} {...getSortFloatingProps({ className: 'ms-sort-floating' })} style={{ ...sortFloatingStyles, visibility: sortPositioned ? 'visible' : 'hidden' }}><div className={`ms-sort-menu floating-popover-motion ${sortPositioned ? 'is-positioned' : ''}`}><button onClick={() => { updateParams({ sort: 'newest' }); setSortOpen(false); }}>Newest first</button><button onClick={() => { updateParams({ sort: 'oldest' }); setSortOpen(false); }}>Oldest first</button></div></div></FloatingPortal> : null}
        </div>
      </div>
      <p className="ms-count"><b>{total} {statusFilter === 'succeeded' ? 'successful ' : statusFilter === 'failed' ? 'failed ' : ''}image{total === 1 ? '' : 's'}</b> {rangeText(range, from, to)}</p>
      {initialLoading ? <Skeletons columnCount={columnCount}/> : <div className={`ms-gallery-state ${loading ? 'is-loading' : ''}`}>{loading ? <span className="ms-filter-progress"/> : null}<MasonryGrid items={items} columnCount={columnCount} open={open} remove={remove} recreate={recreate} download={download} highlightedId={highlightedId} clearHighlight={clearHighlight} registerCard={registerCard}/>{!loading && error ? <div className="ms-message error"><p>{error}</p><button onClick={() => load(false)}>Try again</button></div> : null}{!loading && !error && items.length === 0 ? <div className="ms-message"><ImageIcon/><p>No images match these filters</p><button onClick={clear}>Clear filters</button></div> : null}</div>}<div ref={sentinel} className="ms-sentinel">{more ? 'Loading more…' : ''}</div></>}
    <GeneratedImageDetailDrawer item={selected} items={items} onClose={close} onPrevious={() => move(-1)} onNext={() => move(1)} onDelete={remove} onDownload={download} onRecreate={recreateFromDrawer} onOpenOriginalAd={onOpenOriginalAd} onShowToast={onShowToast}/></main>;
}

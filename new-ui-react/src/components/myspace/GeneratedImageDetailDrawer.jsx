import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Maximize2, RefreshCw, Sparkle, Trash2, X } from 'lucide-react';
import { fetchLandingAd } from '../../services/api';
import DownloadMenu from './DownloadMenu';
import ImageLightbox from './ImageLightbox';

const imageUrl = (item) => { const image = item?.result?.images?.[0]; return typeof image === 'string' ? image : image?.url; };
const fallbackName = (item) => item?.source?.advertiser || `${String(item?.source?.network || 'Ad').replace(/^./, (c) => c.toUpperCase())} ad`;
const bytes = (value) => !value ? null : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;

export default function GeneratedImageDetailDrawer({ item, items = [], onClose, onPrevious, onNext, onDelete, onDownload, onRecreate, onOpenOriginalAd, onShowToast }) {
  const index = items.findIndex((row) => row.job_id === item?.job_id);
  const [sourceAd, setSourceAd] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => { setPreviewOpen(false); }, [item?.job_id]);
  useEffect(() => {
    if (!item) return undefined;
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    // Freshchat's injected launcher uses an extremely high z-index. Hide only
    // its frame while this drawer is open, then restore its exact prior style.
    const chatFrame = document.getElementById('fc_frame');
    const previousChatVisibility = chatFrame?.style.visibility;
    if (chatFrame) chatFrame.style.visibility = 'hidden';
    const keys = (event) => { if (event.key === 'Escape') onClose(); else if (event.key === 'ArrowLeft' && index > 0) onPrevious(); else if (event.key === 'ArrowRight' && index < items.length - 1) onNext(); };
    document.addEventListener('keydown', keys); return () => { document.body.style.overflow = previous; if (chatFrame) chatFrame.style.visibility = previousChatVisibility || ''; document.removeEventListener('keydown', keys); };
  }, [item, index, items.length, onClose, onPrevious, onNext]);
  useEffect(() => {
    setSourceAd(null);
    if (!item?.source?.network || !item?.source?.ad_id) return undefined;
    let active = true;
    fetchLandingAd(item.source.network, item.source.ad_id)
      .then((result) => { if (active) setSourceAd(result?.ads?.[0] || null); })
      .catch(() => {});
    return () => { active = false; };
  }, [item?.job_id, item?.source?.network, item?.source?.ad_id]);
  if (!item) return null;
  const failed = ['failed', 'cancelled'].includes(item.status); const image = failed ? null : imageUrl(item); const name = sourceAd?.advertiser || fallbackName(item); const runningDays = sourceAd?.runningDays ?? item.source?.running_days; const product = item.request?.product_image; const refs = [item.source?.image_url, ...(item.request?.extra_image_urls || [])].filter(Boolean);
  // Lightbox pages through the images that actually have a result.
  const previewItems = items.filter((row) => row.status === 'succeeded' && imageUrl(row));
  const copyPrompt = async () => { try { await navigator.clipboard.writeText(item.request?.prompt || ''); onShowToast?.('Prompt copied', 'success'); } catch { onShowToast?.('Could not copy prompt.', 'error'); } };
  return <div className="ms-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="ms-drawer" aria-label="Image details"><header className="ms-drawer-header"><div><b>Image details</b><span>Recreated from {name}</span></div><div className="ms-drawer-nav"><button disabled={index <= 0} onClick={onPrevious}><ChevronLeft/></button><button disabled={index < 0 || index >= items.length - 1} onClick={onNext}><ChevronRight/></button><button className="close" onClick={onClose}><X/></button></div></header>
    <div className="ms-drawer-body"><div className={`ms-stage ${failed ? 'failed' : ''} ${image ? 'has-image' : ''}`}>{image ? <div className="ms-stage-img"><img src={image} alt={`Generated creative from ${name}`} onClick={() => setPreviewOpen(true)}/><div className="ms-img-actions"><button aria-label="Preview" title="Preview" onClick={() => setPreviewOpen(true)}><Maximize2/></button><DownloadMenu ariaLabel="Download" onDownload={(format) => onDownload(item, format)}><Download/></DownloadMenu></div></div> : failed ? <div className="ms-drawer-failure"><span>!</span><strong>Generation failed</strong><p>{item.error?.user_message || item.error?.message || 'The image could not be generated.'}</p><small><Check/> Your credit was refunded</small><button onClick={() => onRecreate(item)}><RefreshCw/> Try again</button></div> : null}</div><section><h3>DETAILS</h3><div className="ms-detail-row"><b>Reference ad</b><div className="ms-detail-value media">{item.source?.image_url ? <img src={item.source.image_url} alt=""/> : null}<span><strong>{name}</strong>{runningDays ? <small>{runningDays} day{Number(runningDays) === 1 ? '' : 's'} running</small> : null}<button className="ms-original-ad" onClick={() => onOpenOriginalAd?.({ network: item.source?.network, adId: item.source?.ad_id, ad: sourceAd })}>View original ad <ExternalLink/></button></span></div></div>
      {item.request?.product_image_url ? <div className="ms-detail-row"><b>Product image</b><div className="ms-detail-value media"><img src={item.request.product_image_url} alt=""/><span><strong>{product?.name || 'Product image'}</strong><small>{[bytes(product?.size_bytes), product?.width && product?.height ? `${product.width} × ${product.height}` : null].filter(Boolean).join(' · ') || 'Uploaded reference'}</small></span></div></div> : null}
      {item.request?.brand_website ? <div className="ms-detail-row"><b>Brand website</b><div className="ms-detail-value"><a href={item.request.brand_website} target="_blank" rel="noreferrer">{item.request.brand_website} <ExternalLink/></a></div></div> : null}
      {item.request?.prompt ? <div className="ms-detail-row"><b>Prompt used</b><div className="ms-detail-value"><div className="ms-prompt">{item.request.prompt}</div><div className="ms-ref-line"><span>{refs.slice(0, 3).map((url) => <img src={url} alt="" key={url}/>)} {refs.length} reference image{refs.length === 1 ? '' : 's'}</span><button onClick={copyPrompt}><Copy/> Copy prompt</button></div></div></div> : null}
      <div className="ms-detail-row"><b>Aspect ratio</b><div className="ms-detail-value"><span className="ms-aspect-pill">{item.request?.aspect_ratio || '—'} · Original</span></div></div><div className="ms-detail-row"><b>Generated</b><div className="ms-detail-value">{new Date(item.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} <span className="muted">· {item.credit?.cost ?? 1} credit</span></div></div></section></div>
    <footer className="ms-drawer-footer">{image ? <DownloadMenu variant="split" className="primary" onDownload={(format) => onDownload(item, format)}/> : null}<button className={image ? '' : 'primary'} onClick={() => onRecreate(item)}><Sparkle fill="currentColor"/> {failed ? 'Try again' : 'Recreate again'}</button><button className="danger" onClick={() => onDelete(item)}><Trash2/> Delete</button></footer></aside>{previewOpen && image ? <ImageLightbox items={previewItems} startIndex={Math.max(0, previewItems.findIndex((row) => row.job_id === item.job_id))} onClose={() => setPreviewOpen(false)} onDownload={onDownload}/> : null}</div>;
}

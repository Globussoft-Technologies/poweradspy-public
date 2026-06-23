import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  X,
  Play,
  ThumbsUp,
  Eye,
  EyeOff,
  Share2,
  MessageCircle,
  ExternalLink,
  Heart,
  Star,
  StarHalf,
  Clock,
  TrendingUp,
  MousePointerClick,
  Film,
  Layers,
  Image,
  Monitor,
  Search,
  Type,
  Globe,
  Calendar,
  Tag,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  Download,
} from "lucide-react";
import { AD_TYPE_BADGES, getStarRating } from "../../constants";
import OriginalPreview from "./OriginalPreview";
import { createShareLink, fetchFreshTikTokVideoUrl, getVideoEmbedUrl, trackEvent } from "../../services/api";
import { downloadAdAsPdf } from "../../services/adPdf";

import fbIcon from "../../assets/fb.png";
import igIcon from "../../assets/ig.png";
import ytIcon from "../../assets/yt.png";
import gIcon from "../../assets/g.png";
import gdnIcon from "../../assets/gdn.png";
import linkedinIcon from "../../assets/linkedin.png";
import nativeIcon from "../../assets/native.png";
import rdIcon from "../../assets/rd.png";
import quoraIcon from "../../assets/quora.png";
import pinterestIcon from "../../assets/pinterest.png";
import tiktokIcon from "../../assets/tiktoklogo.jpg";
import metaIcon from "../../assets/meta.svg";
import he from "he";

import mpAgkn from "../../assets/marketingPlatform/agkn.com.png";
import mpBranch from "../../assets/marketingPlatform/branch.png";
import mpConversionx from "../../assets/marketingPlatform/conversionx.co.png";
import mpDemdex from "../../assets/marketingPlatform/demdex.net.png";
import mpDoubleclick from "../../assets/marketingPlatform/doubleclick.png";
import mpHubspot from "../../assets/marketingPlatform/hubs.ly.png";
import mpHootsuite from "../../assets/marketingPlatform/ow.ly.png";
import mpKenshoo from "../../assets/marketingPlatform/xg4ken.com.png";
import ecBigCommerce from "../../assets/ecommercePlatform/BigCommerce.png";
import ecDemandware from "../../assets/ecommercePlatform/Demandware.png";
import ecPrestaShop from "../../assets/ecommercePlatform/PrestaShop.png";
import ecShopify from "../../assets/ecommercePlatform/Shopify.png";
import ecSquarespace from "../../assets/ecommercePlatform/Squarespace.png";
import ecVolusion from "../../assets/ecommercePlatform/Volusion.png";
import ecWix from "../../assets/ecommercePlatform/Wix.png";
import ecWooCommerce from "../../assets/ecommercePlatform/WooCommerce.png";
import ec3dCart from "../../assets/ecommercePlatform/_3dCart.png";
import ecMagento from "../../assets/ecommercePlatform/magento.png";
import fnBuilderall from "../../assets/funnels/builderall.png";
import fnClickfunnel from "../../assets/funnels/clickfunnel.png";
import fnConvertri from "../../assets/funnels/convertri.png";
import fnGetresponse from "../../assets/funnels/getresponse.png";
import fnInstapage from "../../assets/funnels/instapage.png";
import fnKajabi from "../../assets/funnels/kajabi.png";
import fnKartra from "../../assets/funnels/kartra.png";
import fnKeap from "../../assets/funnels/keap.png";
import fnLandingi from "../../assets/funnels/landingi.png";
import fnLeadpages from "../../assets/funnels/leadpages.png";
import fnOptimizepress from "../../assets/funnels/optimizepress.png";
import fnSamcart from "../../assets/funnels/samcart.png";
import fnWishpond from "../../assets/funnels/wishpond.png";

const DM_MP_IMGS = {
  'agkn.com': mpAgkn, 'branch': mpBranch, 'conversionx.co': mpConversionx,
  'demdex.net': mpDemdex, 'doubleclick': mpDoubleclick, 'hubs.ly': mpHubspot,
  'ow.ly': mpHootsuite, 'xg4ken.com': mpKenshoo,
};
const DM_MP_LIST = [
  { match: 'demdex.net', file: 'demdex.net', title: 'Adobe Audience Manager' },
  { match: 'branch', file: 'branch', title: 'Branch' },
  { match: 'conversionx.co', file: 'conversionx.co', title: 'Conversionx' },
  { match: 'doubleclick', file: 'doubleclick', title: 'Google Marketing Platform' },
  { match: 'ow.ly', file: 'ow.ly', title: 'Hootsuite' },
  { match: 'hubs.ly', file: 'hubs.ly', title: 'Hubspot' },
  { match: 'xg4ken.com', file: 'xg4ken.com', title: 'Kenshoo' },
  { match: 'agkn.com', file: 'agkn.com', title: 'Neustar' },
];
const DM_EC_IMGS = {
  'bigcommerce': ecBigCommerce, 'demandware': ecDemandware, 'prestashop': ecPrestaShop,
  'shopify': ecShopify, 'squarespace': ecSquarespace, 'volusion': ecVolusion,
  'wix': ecWix, 'woocommerce': ecWooCommerce, '3dcart': ec3dCart, 'magento': ecMagento,
};
const DM_FN_IMGS = {
  'builderall': fnBuilderall, 'clickfunnels': fnClickfunnel, 'clickfunnel': fnClickfunnel,
  'convertri': fnConvertri, 'getresponse': fnGetresponse, 'instapage': fnInstapage,
  'kajabi': fnKajabi, 'kartra': fnKartra, 'keap': fnKeap, 'landingi': fnLandingi,
  'leadpages': fnLeadpages, 'optimizepress': fnOptimizepress, 'samcart': fnSamcart,
  'wishpond': fnWishpond,
};

const PLATFORM_ICONS = {
  facebook: fbIcon,
  instagram: igIcon,
  youtube: ytIcon,
  google: gIcon,
  gdn: gdnIcon,
  linkedin: linkedinIcon,
  native: nativeIcon,
  reddit: rdIcon,
  quora: quoraIcon,
  pinterest: pinterestIcon,
  tiktok: tiktokIcon,
};

const AD_TYPE_ICONS = {
  video: Film,
  carousel: Layers,
  image: Image,
  banner: Monitor,
  display: Monitor,
  discovery: Search,
  "text-image": Type,
  text: Type,
};

const StarRating = ({ rating }) => {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (rating >= i)
      stars.push(
        <Star key={i} size={12} className="fill-amber-400 text-amber-400" />,
      );
    else if (rating >= i - 0.5)
      stars.push(
        <StarHalf
          key={i}
          size={12}
          className="fill-amber-400 text-amber-400"
        />,
      );
    else
      stars.push(
        <Star key={i} size={12} className="text-theme-text-tertiary/30" />,
      );
  }
  return <div className="flex items-center gap-0.5">{stars}</div>;
};

/**
 * EngagementStat — single engagement metric card. Detects when the formatted
 * value overflows its container and exposes the full value via tooltip.
 */
const EngagementStat = ({ icon, color, label, value, tooltip }) => {
  const valueRef = useRef(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const measure = () => {
    const el = valueRef.current;
    if (!el) return;
    setIsTruncated(el.scrollWidth > el.clientWidth + 1);
  };

  useEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const showLabelTip = tooltip && tooltip !== label;
  const tooltipText = isTruncated
    ? showLabelTip
      ? `${value} — ${tooltip}`
      : String(value)
    : showLabelTip
      ? tooltip
      : null;

  return (
    <div
      className="group/stat relative flex items-center gap-2.5 rounded-lg bg-white/[0.025] border border-white/[0.05] px-2.5 py-2 hover:bg-white/[0.05] hover:border-white/[0.12] transition-colors duration-200 cursor-pointer"
      onMouseEnter={measure}
      // title={isTruncated ? String(value) : undefined}
    >
      <div
        className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
        style={{
          background: `${color}1a`,
          color,
          boxShadow: `inset 0 0 0 1px ${color}33`,
        }}
      >
        {icon}
      </div>
      <div className="flex flex-col leading-tight min-w-0 flex-1">
        <span
          ref={valueRef}
          className="block text-[14px] font-extrabold text-theme-text tabular-nums truncate"
        >
          {value}
        </span>
        <span className="text-[9px] uppercase tracking-wider font-bold text-white/60">
          {label}
        </span>
      </div>

      {tooltipText && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] font-medium rounded-md opacity-0 group-hover/stat:opacity-100 transition-opacity pointer-events-none border border-slate-700 w-max max-w-[220px] text-center leading-relaxed z-20 shadow-lg">
          {tooltipText}
        </span>
      )}
    </div>
  );
};

/**
 * AdDetailModal — Full detail overlay shown on card click.
 * Pinterest-style expanded view with all ad information.
 */
const AdDetailModal = ({
  ad,
  onClose,
  isFavourite,
  onToggleFavourite,
  onAnalytics,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onSearch,
  onHideAd,
  onHideAdvertiser,
  isHidden,
  isAdvertiserHidden,
  onUnHideAd,
  guest,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [advTooltipPos, setAdvTooltipPos] = useState(null);
  const advNameRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [copyLoading, setCopyLoading] = useState(false);
  const [showHideMenu, setShowHideMenu] = useState(false);
  const [hideMenuPos, setHideMenuPos] = useState({ top: 0, left: 0 });
  const hideButtonRef = React.useRef(null);

  // Image-loaded gate so the user sees a spinner instead of the browser's
  // top-to-bottom progressive JPEG render while bytes arrive.
  const [imgLoaded, setImgLoaded] = useState(false);
  // Broken thumbnail/image URL — show a "Preview unavailable" placeholder
  // instead of spinning the loader forever (matches MasonryCard/AnalyticsModal).
  const [imgError, setImgError] = useState(false);
  // Callback ref handles cache races: when the modal opens with an image
  // the browser already has cached, `load` can fire before React attaches
  // its onLoad handler. Checking `complete` synchronously at mount catches
  // that case.
  const handleImgRef = React.useCallback((node) => {
    if (node && node.complete && node.naturalWidth > 0) {
      setImgLoaded(true);
    }
  }, []);

  // ─── Video URL with fallback ──────────────────────
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState(null);
  const [isRefreshingVideo, setIsRefreshingVideo] = useState(false);
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const videoRefreshAttempted = React.useRef(false);
  const videoStallTimerRef = React.useRef(null);

  const clearVideoStallTimer = React.useCallback(() => {
    if (videoStallTimerRef.current) {
      clearTimeout(videoStallTimerRef.current);
      videoStallTimerRef.current = null;
    }
  }, []);

  const handleVideoError = React.useCallback(async () => {
    clearVideoStallTimer();
    if (videoRefreshAttempted.current) {
      // Fallback URL also failed — stop trying so we don't loop on a dead source.
      setIsPlaying(false);
      setVideoUnavailable(true);
      return;
    }
    videoRefreshAttempted.current = true;
    const network = (ad?.network || "").toLowerCase();
    if (network === "tiktok" && ad?.tiktokLibraryUrl) {
      setIsRefreshingVideo(true);
      try {
        const freshUrl = await fetchFreshTikTokVideoUrl(ad.tiktokLibraryUrl);
        if (freshUrl) {
          setResolvedVideoUrl(freshUrl);
        } else {
          setIsPlaying(false);
          setVideoUnavailable(true);
        }
      } catch {
        setIsPlaying(false);
        setVideoUnavailable(true);
      } finally {
        setIsRefreshingVideo(false);
      }
    } else if (ad?.videoUrlFallback) {
      // NAS copy 410'd/expired (or Quora image_url_original) — switch to the live CDN URL.
      setResolvedVideoUrl(ad.videoUrlFallback);
    } else {
      setIsPlaying(false);
      setVideoUnavailable(true);
    }
  }, [clearVideoStallTimer, ad?.network, ad?.tiktokLibraryUrl, ad?.videoUrlFallback]);

  // 12s is the budget for first-frame. HTMLMediaElement won't always fire
  // `error` for an expired CDN URL (the browser keeps retrying at the network
  // layer), so we have to bound the wait ourselves before showing the
  // unavailable state.
  const handleVideoLoadStart = React.useCallback(() => {
    clearVideoStallTimer();
    videoStallTimerRef.current = setTimeout(() => {
      handleVideoError();
    }, 12000);
  }, [clearVideoStallTimer, handleVideoError]);

  const handleVideoCanPlay = React.useCallback(() => {
    clearVideoStallTimer();
  }, [clearVideoStallTimer]);

  useEffect(() => () => clearVideoStallTimer(), [clearVideoStallTimer]);

  // Keyboard navigation — must be before any early return
  useEffect(() => {
    if (!ad) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onPrev?.();
      if (e.key === "ArrowRight" && hasNext) onNext?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [ad, onClose, onPrev, onNext, hasPrev, hasNext]);

  // Reset state when ad changes
  useEffect(() => {
    setIsPlaying(false);
    setCopied(false);
    setShowOriginal(false);
    setActiveIndex(0);
    setIsExpanded(false);
    setCopyLoading(false);
    setShowHideMenu(false);
    setResolvedVideoUrl(null);
    setIsRefreshingVideo(false);
    setVideoUnavailable(false);
    videoRefreshAttempted.current = false;
    clearVideoStallTimer();
  }, [ad, clearVideoStallTimer]);

  // Reset the image-load gate whenever the displayed image will change
  // (different ad selected, or carousel paged). Must live before the
  // early-return below so the hook count stays consistent across renders.
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [ad, activeIndex]);

  // Backend splits carousel ads across two fields: the cover image lands in
  // `thumbnail` (image_video_url) and the rest of the slides in `carouselMedia`
  // (ad_image_video). Without prepending the cover here, it would be missing
  // from the detail view even though the PDF export includes it — keeps card,
  // detail, analytics, and PDF surfaces showing the same set of slides.
  // Must live before the early-return below so the hook count stays consistent.
  const carouselImages = useMemo(() => {
    const media = ad?.carouselMedia || [];
    // `carouselMedia` is already DefaultImage-filtered in mapAdToCard; also skip
    // the cover when it's the placeholder so a broken first slide doesn't render.
    const coverOk = ad?.thumbnail && !ad.thumbnail.includes("DefaultImage");
    if (coverOk && media.length > 0 && !media.includes(ad.thumbnail)) {
      return [ad.thumbnail, ...media];
    }
    return media;
  }, [ad?.thumbnail, ad?.carouselMedia]);

  // YouTube and Facebook ads ship their playable URL in `ad_url` (mapped to
  // ad.adUrl) — not in ad.videoUrl — so for those we embed via iframe rather
  // than <video> (which can't decode either platform's watch page).
  const embedUrl = useMemo(
    () => getVideoEmbedUrl(ad?.adUrl),
    [ad?.adUrl],
  );

  if (!ad) return null;

  const platform = (ad.network || "").toLowerCase();
  // Network shown in the UI. YouTube DISPLAY ads surfaced under GDN carry
  // badgeNetwork:'gdn' so they display as GDN, while `platform` (= ad.network)
  // keeps routing share/insights to YouTube where the ad actually lives.
  const displayNetwork = (ad.badgeNetwork || ad.network || "").toLowerCase();

  // Format platform name for display
  const PLATFORM_NAMES = {
    facebook: "Facebook",
    instagram: "Instagram",
    youtube: "YouTube",
    google: "Google",
    gdn: "Google Display Network",
    linkedin: "LinkedIn",
    native: "Native",
    reddit: "Reddit",
    pinterest: "Pinterest",
    tiktok: "TikTok",
  };
  const platformDisplayName = PLATFORM_NAMES[displayNetwork] || ad.badgeNetwork || ad.network || "";

  // Format position for display (e.g. SEARCHFEED_DISCOVERY → Search Feed Discovery)
  const formatPosition = (pos) => {
    if (!pos) return "";
    return pos
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };
  const adTypeLower = (ad.adType || "image").toLowerCase();
  const badge = AD_TYPE_BADGES[adTypeLower] || AD_TYPE_BADGES.image;
  const TypeIcon = AD_TYPE_ICONS[adTypeLower] || Image;
  const isVideo = adTypeLower === "video";
  const isActive = (ad.status || "").toLowerCase() === "active";

  const starRating = ad.popularity ? getStarRating(ad.popularity) : 0;

  const hasCarousel = carouselImages.length > 1;
  const currentImg = hasCarousel
    ? carouselImages[activeIndex]
    : ad.thumbnail || "";
  const rawTitleStr =
    (ad.carouselTitles?.length > activeIndex
      ? ad.carouselTitles[activeIndex]
      : ad.title) || "";
  const currentTitle = rawTitleStr.replace(/^,|,$/g, "").trim();

  const handleCopyLink = async () => {
    if (guest?.showGuestWarning("Please login to copy ad link")) return;
    if (copyLoading) return;
    setCopyLoading(true);
    try {
      const adId = ad.adId || ad.id || "";
      const network = platform || ad.network || "facebook";
      const result = await createShareLink({ adId, network });
      const url = `${window.location.origin}/share/${result.token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      trackEvent('copyAd', { ad_id: adId, network, landing_page_url: url });
    } catch (err) {
      console.error("Failed to create share link:", err);
    } finally {
      setCopyLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal content */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-sm md:max-w-xl lg:max-w-3xl flex justify-center items-center"
      >
        {/* Nav arrows */}
        {hasPrev && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrev?.();
            }}
            className="absolute top-1/2 -translate-y-1/2 -left-4 sm:-left-14 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
        )}
        {hasNext && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNext?.();
            }}
            className="absolute top-1/2 -translate-y-1/2 -right-4 sm:-right-14 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <ChevronRight size={24} />
          </button>
        )}

        <div
          className="w-[90vw] relative max-w-sm md:max-w-xl lg:max-w-3xl max-h-[90vh] flex flex-col md:flex-row rounded-2xl shadow-2xl"
          style={{
            backgroundColor: "var(--color-card)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-20 p-1.5 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
          >
            <X size={16} />
          </button>

          {/* Left: Media — vertically centered with blurred image background */}
          <div
            className="md:w-1/2 relative flex-shrink-0 flex rounded-tl-2xl rounded-bl-2xl items-center justify-center overflow-hidden"
            style={{ backgroundColor: "var(--color-surface)" }}
          >
            {showOriginal ? (
              /* Original platform preview */
              <div
                className="w-full h-full overflow-y-auto p-4 pb-[60px] flex flex-col items-center justify-center"
                style={{ backgroundColor: "#f0f2f5" }}
              >
                <OriginalPreview ad={ad} />
              </div>
            ) : (
              <>
                {/* Blurred image background — fills entire media panel */}
                <div className="absolute inset-0 z-0 pointer-events-none">
                  <img
                    key={currentImg}
                    src={currentImg}
                    alt=""
                    className="w-full h-full object-cover scale-110"
                    style={{
                      filter: "blur(40px) saturate(1.5) brightness(0.4)",
                    }}
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                </div>
                {/* Darkened edges — top & bottom vignette over the blur */}
                <div
                  className="absolute top-0 left-0 right-0 h-20 z-[1] pointer-events-none"
                  style={{
                    background:
                      "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)",
                  }}
                />
                <div
                  className="absolute bottom-0 left-0 right-0 h-20 z-[1] pointer-events-none"
                  style={{
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.5), transparent)",
                  }}
                />

                {isPlaying && isVideo && (resolvedVideoUrl || ad.videoUrl || embedUrl) ? (
                  <>
                    {(resolvedVideoUrl || ad.videoUrl) ? (
                      <video
                        key={resolvedVideoUrl || ad.videoUrl}
                        src={resolvedVideoUrl || ad.videoUrl}
                        className="w-full h-auto max-h-[90vh] object-contain relative z-[1]"
                        autoPlay
                        controls
                        onEnded={() => setIsPlaying(false)}
                        onError={handleVideoError}
                        onLoadStart={handleVideoLoadStart}
                        onCanPlay={handleVideoCanPlay}
                      />
                    ) : (
                      <iframe
                        key={embedUrl}
                        src={embedUrl}
                        title={currentTitle || "Video ad"}
                        className="w-full h-[60vh] max-h-[90vh] relative z-[1] border-0 bg-black"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    )}
                    {isRefreshingVideo && (
                      <div className="absolute inset-0 z-[2] bg-black/70 flex flex-col items-center justify-center gap-2">
                        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                        <span className="text-[11px] text-white/70 font-medium">Refreshing video…</span>
                      </div>
                    )}
                  </>
                ) : adTypeLower === "text" ? (
                  <div className="relative flex items-center justify-center w-full min-h-[320px] h-full z-[1] p-8 bg-gradient-to-br from-indigo-950/40 to-slate-900/40">
                    <p className="2xl:text-base text-sm font-medium leading-relaxed text-zinc-300 text-center line-clamp-6">
                      {currentTitle ? `"${currentTitle}"` : 'Text Ad'}
                    </p>
                  </div>
                ) : adTypeLower === "banner" && !currentImg ? (
                  <div className="relative flex items-center justify-center w-full min-h-[320px] h-full z-[1] p-8 bg-gradient-to-br from-indigo-950/40 to-slate-900/40">
                    <div className="flex flex-col items-center gap-3 text-center max-w-sm">
                      {ad.subtitle && (
                        <p className="2xl:text-base text-sm font-bold leading-snug text-zinc-100 line-clamp-4">
                          {ad.subtitle}
                        </p>
                      )}
                      {ad.adText && (
                        <p className="text-xs leading-relaxed text-zinc-400 line-clamp-3">
                          {ad.adText}
                        </p>
                      )}
                      {ad.title && (
                        <p className="text-xs text-zinc-500 line-clamp-2">
                          {ad.title}
                        </p>
                      )}
                    </div>
                  </div>
                ) : adTypeLower === "text-image" ? (
                  <div className="relative w-full min-h-[320px] h-full flex items-center justify-center overflow-hidden z-[1]">
                    {currentImg && (
                      <img
                        src={currentImg}
                        alt={currentTitle}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                    )}
                    {!currentImg && (
                      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 to-slate-900/40" />
                    )}
                    <div className="absolute inset-0 bg-black/40" />
                    <p className="relative z-10 text-[15px] font-semibold leading-relaxed text-white text-center px-8 line-clamp-6 drop-shadow-lg">
                      {ad.textImageTitle || currentTitle || ad.adText || ""}
                    </p>
                  </div>
                ) : (
                  <div className="relative flex items-center justify-center w-full group/carousel">
                    <img
                      key={currentImg}
                      ref={handleImgRef}
                      src={currentImg}
                      alt={currentTitle}
                      decoding="async"
                      className={`w-full h-auto max-h-[90vh] object-contain relative z-[1] transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
                      onLoad={() => setImgLoaded(true)}
                      onError={(e) => {
                        e.target.style.display = "none";
                        setImgError(true);
                      }}
                    />
                    {/* Spinner while bytes are still arriving — replaces the
                        browser's progressive top-to-bottom render with a clean
                        load state. Sits over the blurred backdrop. */}
                    {!imgLoaded && !imgError && currentImg && (
                      <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
                        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                      </div>
                    )}
                    {/* Broken image URL — sized placeholder instead of an endless
                        spinner. Not absolute: the <img> is display:none on error so
                        the container would otherwise collapse to zero height. */}
                    {imgError && (
                      <div className="relative z-[2] flex flex-col items-center justify-center gap-2 w-full min-h-[320px] pointer-events-none">
                        <Image size={32} className="text-zinc-500" strokeWidth={1.5} />
                        <span className="text-[11px] font-medium text-zinc-400 tracking-wide">
                          Preview unavailable
                        </span>
                      </div>
                    )}
                    {isVideo && !videoUnavailable && (
                      <div
                        className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/20 hover:bg-black/30 transition-colors z-[2]"
                        onClick={() => {
                          // Nothing playable — no direct media URL and no
                          // YouTube/Facebook watch URL in ad_url. Hide the
                          // play affordance and let the thumbnail stand on
                          // its own.
                          if (!(resolvedVideoUrl || ad.videoUrl) && !embedUrl) {
                            setVideoUnavailable(true);
                            return;
                          }
                          setIsPlaying(true);
                        }}
                      >
                        <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20">
                          <Play fill="white" size={22} />
                        </div>
                      </div>
                    )}

                    {/* Carousel Controls within Modal */}
                    {hasCarousel && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveIndex((p) =>
                              p > 0 ? p - 1 : carouselImages.length - 1,
                            );
                          }}
                          className="absolute left-4 top-1/2 -translate-y-1/2 z-[3] p-2.5 rounded-full bg-black/40 backdrop-blur-md text-white border border-white/20 shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-all hover:bg-black/60 hover:scale-110 active:scale-95"
                        >
                          <ChevronLeft size={20} />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveIndex((p) =>
                              p < carouselImages.length - 1 ? p + 1 : 0,
                            );
                          }}
                          className="absolute right-4 top-1/2 -translate-y-1/2 z-[3] p-2.5 rounded-full bg-black/40 backdrop-blur-md text-white border border-white/20 shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-all hover:bg-black/60 hover:scale-110 active:scale-95"
                        >
                          <ChevronRight size={20} />
                        </button>

                        <div className="absolute bottom-16 left-0 right-0 flex justify-center gap-2 z-[3] px-4 flex-wrap">
                          {carouselImages.map((_, idx) => (
                            <div
                              key={idx}
                              className={`h-1.5 rounded-full transition-all duration-300 ${
                                idx === activeIndex
                                  ? "w-5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                                  : "w-1.5 bg-white/40 hover:bg-white/60"
                              }`}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Badge overlays on image — above gradients */}
            {!showOriginal && (
              <>
                {/* Corner Ad Type Strip */}
                {PLATFORM_ICONS[displayNetwork] && (
                  <div className="absolute top-0 left-0 w-[72px] h-[72px] z-[3] pointer-events-none overflow-hidden rounded-tl-2xl">
                    <div
                      className="absolute inset-0 bg-white/20 flex items-center justify-center backdrop-blur-[2px]"
                      style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
                    >
                      <div className="flex items-center gap-1 pr-6 pb-8">
                        <img
                          src={PLATFORM_ICONS[displayNetwork]}
                          alt={displayNetwork}
                          className="w-[22px] h-[22px] object-contain drop-shadow-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* <div className="absolute top-3 left-[70px] z-[3] flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border backdrop-blur-sm ${badge.color}`}
                  >
                    <TypeIcon size={11} />
                    {badge.label}
                  </span>
                  {ad.aspectRatio && ad.aspectRatio !== "auto" && (
                    <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-black/50 text-white/80 backdrop-blur-sm border border-white/10">
                      {ad.aspectRatio}
                    </span>
                  )}
                </div> */}
              </>
            )}

            {/* Original Preview toggle button — bottom center */}
            <button
              onClick={() => {
                if (!showOriginal) trackEvent('showOriginal', { ad_id: ad.adId ?? ad.id, network: platform ?? ad.network ?? 'facebook' });
                setShowOriginal(!showOriginal);
              }}
              className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-[3] flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold transition-all backdrop-blur-md border ${
                showOriginal
                  ? "bg-[#335296] text-white border-[#3759a3] shadow-lg shadow-[#3759a3]/30"
                  : "bg-black/40 text-white/80 border-white/15 hover:bg-black/60 hover:text-white"
              }`}
            >
              <Smartphone size={12} />
              {showOriginal ? "Show Image" : "Original Preview"}
            </button>
          </div>

          {/* Right: Details - Added pt-12 to prevent cross overlap with heart button */}
          <div className="md:w-1/2 overflow-y-auto p-5 pt-12 space-y-4">
            {/* Advertiser header */}
            <div className="flex items-center gap-1 pr-0">
              {/* <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-white/20'}`} /> */}
              {ad.advertiserImage ? (
                <img
                  src={ad.advertiserImage}
                  alt=""
                  className="w-8 h-8 rounded-lg object-cover border"
                  style={{ borderColor: "var(--color-border)" }}
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black"
                  style={{
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-accent)",
                  }}
                >
                  {platform === "tiktok" ? (
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                      <circle
                        cx="12"
                        cy="8"
                        r="4"
                        fill="currentColor"
                        opacity="0.8"
                      />
                      <path
                        d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"
                        fill="currentColor"
                        opacity="0.6"
                      />
                    </svg>
                  ) : (
                    (ad.advertiser || "?")[0]
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="relative min-w-0">
                    <p
                      ref={advNameRef}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSearch?.(ad.advertiser, "advertiser");
                        onClose();
                      }}
                      onMouseEnter={() => {
                        if (advNameRef.current) {
                          const r = advNameRef.current.getBoundingClientRect();
                          setAdvTooltipPos({ bottom: window.innerHeight - r.top + 8, left: r.left });
                        }
                      }}
                      onMouseLeave={() => setAdvTooltipPos(null)}
                      className="text-xs font-bold truncate cursor-pointer transition-all"
                      style={{ color: "var(--color-text)" }}
                    >
                      {ad.advertiser}
                    </p>
                  </div>
                  {ad.verified && (
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="10" cy="10" r="10" fill="#335296"/>
                      <path d="M5.5 10.5L8.5 13.5L14.5 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {ad.isMetaLib && (
                    <img src={metaIcon} alt="meta" className="w-4 h-4 flex-shrink-0" />
                  )}
                </div>
                {/* Platform logos row */}
                {(() => {
                  const mpLogos = [];
                  const mpUrlObj = ad.marketPlatformUrls || {};
                  const mpRedirects = (mpUrlObj.url_redirects || '').split('||').map(s => s.trim()).filter(Boolean);
                  const mpRedirectUrlsArr = Array.isArray(mpUrlObj.redirect_urls)
                    ? mpUrlObj.redirect_urls
                    : typeof mpUrlObj.redirect_urls === 'string' && mpUrlObj.redirect_urls
                      ? [mpUrlObj.redirect_urls]
                      : [];
                  const mpUrlSources = [
                    ad.destinationUrl,
                    mpUrlObj.destination_url,
                    mpUrlObj.url_destination,
                    mpUrlObj.source_url,
                    mpUrlObj.redirect_url,
                    mpUrlObj.final_url,
                    ...mpRedirects,
                    ...mpRedirectUrlsArr,
                  ];
                  const mpSeen = new Set();
                  for (const urlVal of mpUrlSources) {
                    if (!urlVal) continue;
                    const lower = urlVal.toLowerCase();
                    for (const mp of DM_MP_LIST) {
                      if (lower.includes(mp.match) && !mpSeen.has(mp.match)) {
                        mpSeen.add(mp.match);
                        const src = DM_MP_IMGS[mp.file];
                        if (src) mpLogos.push({ key: mp.match, src, title: mp.title });
                      }
                    }
                  }
                  const ecRaw = ad.builtWith;
                  const ecList = Array.isArray(ecRaw) ? ecRaw : ecRaw ? [ecRaw] : [];
                  const ecLogos = ecList.map(name => {
                    const src = DM_EC_IMGS[name.toLowerCase().replace(/\s+/g, '')];
                    return src ? { key: `ec_${name}`, src, title: name } : null;
                  }).filter(Boolean);
                  const fnRaw = ad.builtWithFunnel;
                  const fnList = Array.isArray(fnRaw) ? fnRaw : fnRaw ? [fnRaw] : [];
                  const fnLogos = fnList.map(name => {
                    const src = DM_FN_IMGS[name.toLowerCase().replace(/\s+/g, '')];
                    return src ? { key: `fn_${name}`, src, title: name } : null;
                  }).filter(Boolean);
                  const allLogos = [...mpLogos, ...ecLogos, ...fnLogos];
                  if (allLogos.length === 0) return null;
                  return (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {allLogos.map((logo) => (
                        <div key={logo.key} className="relative shrink-0 group/logo">
                          <img
                            src={logo.src}
                            alt={logo.title}
                            className="h-4 w-auto object-contain"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                          <div className="absolute bottom-full left-0 mb-1 px-2 py-1 rounded text-[10px] font-semibold whitespace-nowrap pointer-events-none bg-[#1a1a1a] text-white z-[9999] opacity-0 group-hover/logo:opacity-100 transition-opacity border border-white/10 shadow-xl">
                            {logo.title}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <button
                onClick={() => {
                  if (guest?.showGuestWarning("Please login to save favourites")) return;
                  onToggleFavourite?.(ad);
                }}
                className="p-2 rounded-lg transition-colors hover:bg-white/5"
              >
                <Heart
                  size={18}
                  className={
                    isFavourite
                      ? "fill-red-500 text-red-500"
                      : "text-white/30 hover:text-red-400"
                  }
                />
              </button>

              {/* Download styled PDF report (creative + advertiser + timeline +
                  engagement + budget + tech-stack + links). Same generator as
                  the MasonryCard hover Download button — see services/adPdf.js. */}
              <button
                onClick={() => { downloadAdAsPdf(ad); trackEvent('downloadAd', { ad_id: ad.adId ?? ad.id, network: ad.network ?? platform ?? 'NA' }); }}
                title="Download ad report (PDF)"
                className="p-2 rounded-lg transition-colors hover:bg-white/5"
              >
                <Download size={18} className="text-white/30 hover:text-white/70" />
              </button>

              {/* Eye / Hide dropdown */}
              <div className="relative">
                <button
                  ref={hideButtonRef}
                  onClick={() => {
                    if (!showHideMenu && hideButtonRef.current) {
                      const rect = hideButtonRef.current.getBoundingClientRect();
                      setHideMenuPos({
                        top: rect.bottom + 4,
                        left: rect.left,
                      });
                    }
                    setShowHideMenu((v) => !v);
                  }}
                  className="p-2 rounded-lg transition-colors hover:bg-white/5"
                >
                  <EyeOff size={18} className="text-white/30 hover:text-white/70" />
                </button>
              </div>
            </div>

            {/* Title & subtitle */}
            <div>
              <h2
                className="text-xs 2xl:text-sm leading-snug max-h-20 overflow-y-auto mb-1.5 transition-opacity duration-300"
                style={{ color: "var(--color-text)" }}
              >
               {he.decode(currentTitle || '')}
              </h2>
              {ad.subtitle && (
                <div className="max-h-40 overflow-y-auto">
                  <p
                    className="text-[11px] leading-relaxed"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {isExpanded || ad.subtitle.length <= 150
                      ? ad.subtitle
                      : `${ad.subtitle.substring(0, 150)}...`}
                    {ad.subtitle.length > 150 && (
                      <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="ml-1 text-[#6b99ff] hover:text-[#7899e0] font-bold focus:outline-none"
                      >
                        {isExpanded ? "Show Less" : "Read More"}
                      </button>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* CTA */}
            {/* {ad.cta && (
                        <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                                <MousePointerClick size={10} />
                                {ad.cta}
                            </span>
                        </div>
                    )} */}
            {ad.cta && (
              <div className="flex items-center gap-1.5">
                <div className="relative inline-flex group">
                  {/* CTA Button */}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();

                      const hasUrl = !!ad?.destinationUrl?.trim();
                      if (hasUrl) {
                        const url = ad.destinationUrl.startsWith("http")
                          ? ad.destinationUrl
                          : `https://${ad.destinationUrl}`;
                        window.open(url, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition
                                ${
                                  ad?.destinationUrl?.trim()
                                    ? "bg-[#3762c1]/10 border border-[#3759a3]/20 text-[#6b99ff] cursor-pointer hover:bg-[#3762c1]/20"
                                    : "bg-gray-500/10 border border-gray-500/20 text-gray-400 cursor-not-allowed"
                                }`}
                  >
                    <MousePointerClick size={10} />
                    {ad.cta}
                  </span>

                  {/* Tooltip */}
                  {!ad?.destinationUrl?.trim() && (
                    <div
                      className="absolute left-full top-1/2 -translate-y-1/2 ml-2 mb-2 
                                            hidden group-hover:flex z-50"
                    >
                      <div
                        className="relative px-3 py-1.5 text-[10px] text-white 
                                                bg-black/90 rounded-md shadow-lg text-center whitespace-nowrap"
                      >
                        Button disabled as it lacks a <br />
                        Destination URL
                        {/* Arrow */}
                        <div
                          className="absolute left-1/2 -translate-x-1/2 top-full 
                                                w-2 h-2 bg-black/90 rotate-45"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Star rating */}
            {starRating > 0 && (
              <div className="relative group flex items-center gap-2 w-fit">
                <StarRating rating={starRating} />
                <span className="text-[10px] font-medium text-white/40">
                  {starRating.toFixed(1)}
                </span>
                {/* Tooltip */}
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-50 pointer-events-none">
                  <div className="px-2.5 py-1.5 rounded-lg text-[9px] text-white bg-[#222] shadow-lg border border-[#333] w-max max-w-[160px] text-center leading-relaxed">
                    Popularity is based on engagements and impressions
                  </div>
                  <div className="w-2 h-2 bg-[#222] rotate-45 ml-4 -mt-1" />
                </div>
              </div>
            )}

            {/* Engagement stats — show if any value exists */}
            {(() => {
              const stats = [
                ad.likes && {
                  key: "likes",
                  icon: <ThumbsUp size={14} strokeWidth={2.2} />,
                  color: "#6b99ff",
                  label: "Likes",
                  value: ad.likes,
                  tooltip: "Likes",
                },
                ad.views && {
                  key: "views",
                  icon: <Eye size={14} strokeWidth={2.2} />,
                  color: "#94a3b8",
                  label: "Views",
                  value: ad.views,
                  tooltip: "Views",
                },
                ad.shares && {
                  key: "shares",
                  icon: <Share2 size={14} strokeWidth={2.2} />,
                  color: "#22c55e",
                  label: "Shares",
                  value: ad.shares,
                  tooltip: "Shares",
                },
                ad.comments && {
                  key: "comments",
                  icon: <MessageCircle size={14} strokeWidth={2.2} />,
                  color: "#eab308",
                  label: "Comments",
                  value: ad.comments,
                  tooltip: "Comments",
                },
                ad.impressions && {
                  key: "impressions",
                  icon: <TrendingUp size={14} strokeWidth={2.2} />,
                  color: "#a78bfa",
                  label: "Impressions",
                  value: ad.impressions,
                  tooltip:
                    "Impressions are based on Location, ad type, ad running days",
                },
                ad.ctr != null && ad.ctr !== "" && Number(ad.ctr) !== 0 && {
                  key: "ctr",
                  icon: <MousePointerClick size={14} strokeWidth={2.2} />,
                  color: "#22d3ee",
                  label: "CTR",
                  value: `${ad.ctr}%`,
                  tooltip: "Click-through rate",
                },
                (ad.budget || ad.lowerBudget > 0 || ad.upperBudget > 0) && {
                  key: "budget",
                  icon: (
                    <span className="text-[13px] font-extrabold leading-none">
                      $
                    </span>
                  ),
                  color: "#10b981",
                  label: "Ad Budget",
                  // Prefer the qualitative tag (TikTok's "High/Medium/Low")
                  // when present; otherwise show the numeric range. Mirrors
                  // MasonryCard's budget chip so the two surfaces match.
                  value: ad.budget
                    ? `${ad.budget} budget`
                    : `${ad.lowerBudget ?? 0} - ${ad.upperBudget ?? "∞"}`,
                  tooltip: "Ad Budget",
                },
              ].filter(Boolean);

              if (stats.length === 0) return null;

              return (
                <div className="relative rounded-xl p-3.5 bg-gradient-to-br from-white/[0.045] via-white/[0.02] to-transparent border border-white/[0.08]">
                  {/* Decorative glow — contained in its own clipped wrapper so it
                      doesn't impose `overflow: hidden` on the parent (which would
                      crop the stat-card tooltips that overflow upward). */}
                  <div className="pointer-events-none absolute inset-0 rounded-xl overflow-hidden">
                    <div
                      className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-40"
                      style={{ background: "radial-gradient(circle, #6b99ff33, transparent 70%)" }}
                    />
                  </div>

                  <div className="relative flex items-center gap-1.5 mb-3">
                    <span className="h-1 w-1 rounded-full bg-[#6b99ff]" />
                    <p className="text-[9px] font-extrabold uppercase tracking-widest text-white/70">
                      Engagement
                    </p>
                    <span className="ml-auto text-[9px] font-semibold text-white/50">
                      {stats.length} metric{stats.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="relative grid grid-cols-2 gap-2">
                    {stats.map((s) => (
                      <EngagementStat
                        key={s.key}
                        icon={s.icon}
                        color={s.color}
                        label={s.label}
                        value={s.value}
                        tooltip={s.tooltip}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Keywords */}
            {ad.keywords && (
              <div className="space-y-1.5">
                <p
                  className="text-[9px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Keywords
                </p>
                <div className="flex flex-wrap gap-1">
                  {ad.keywords.split(",").map((kw, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/[0.04] border border-white/5"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <Tag size={7} className="inline mr-0.5" />
                      {kw.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Meta details */}
            <div
  className="rounded-xl p-3 space-y-2"
  style={{
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  }}
>
              <p
                className="text-[10px] font-extrabold uppercase tracking-widest text-theme-text"
                style={{}}
              >
                Details
              </p>
              {/* <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                {ad.adType && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Ad Type
                    </span>
                    <span
                      className="font-bold"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {formatPosition(ad.adType)}
                    </span>
                  </>
                )}
                {ad.adPosition && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Position
                    </span>
                    <span
                      className="font-bold"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {formatPosition(ad.adPosition)}
                    </span>
                  </>
                )}
                {ad.runningDays && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Running
                    </span>
                    <span
                      className="font-medium flex items-center gap-1"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <Clock size={9} /> {ad.runningDays} days
                    </span>
                  </>
                )}
                {ad.date && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Post Date
                    </span>
                    <span
                      className="font-medium flex items-center gap-1"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <Calendar size={9} /> {ad.date}
                    </span>
                  </>
                )}
                {ad.firstSeen && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      First seen
                    </span>
                    <span
                      className="font-medium flex items-center gap-1"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <Calendar size={9} /> {ad.firstSeen}
                    </span>
                  </>
                )}
                {ad.lastSeen && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Last seen
                    </span>
                    <span
                      className="font-medium flex items-center gap-1"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <Calendar size={9} /> {ad.lastSeen}
                    </span>
                  </>
                )}
                {(
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Language
                    </span>
                    <span
                      className="font-medium flex items-center gap-1"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <Globe size={9} /> {ad.adLanguage || "—"}
                    </span>
                  </>
                )}
                {ad.network && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Platform
                    </span>
                    <span
                      className="font-bold"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {platformDisplayName}
                    </span>
                  </>
                )}
                {platform === "tiktok" && ad.industry && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Category
                    </span>
                    <span
                      className="font-bold"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {ad.industry}
                    </span>
                  </>
                )}
                {platform === "tiktok" && ad.budget != null && ad.budget !== "" && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      Budget
                    </span>
                    <span
                      className="font-bold"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {ad.budget}
                    </span>
                  </>
                )}
                {platform === "tiktok" && ad.ctr != null && ad.ctr !== "" && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      CTR
                    </span>
                    <span
                      className="font-bold"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {ad.ctr}%
                    </span>
                  </>
                )}
              </div>
            </div> */}
           <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
  {ad.adType && (
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        Ad Type
      </span>

      <span
        className="font-semibold text-[11px]"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        {formatPosition(ad.adType)}
      </span>
    </>
  )}

  {ad.adPosition && (
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        Position
      </span>

      <span
        className="font-semibold text-[11px]"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        {formatPosition(ad.adPosition)}
      </span>
    </>
  )}

  {ad.runningDays && (
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        Running
      </span>

      <span
        className="font-semibold text-[11px] flex items-center gap-1"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        <Clock size={10} /> {ad.runningDays} days
      </span>
    </>
  )}

  {ad.date && (
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        Post Date
      </span>

      <span
        className="font-semibold text-[11px] flex items-center gap-1"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        <Calendar size={10} /> {ad.date}
      </span>
    </>
  )}

  {ad.firstSeen && (
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        First Seen
      </span>

      <span
        className="font-semibold text-[11px] flex items-center gap-1"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        <Calendar size={10} /> {ad.firstSeen}
      </span>
    </>
  )}

  {ad.lastSeen && (
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        Last Seen
      </span>

      <span
        className="font-semibold text-[11px] flex items-center gap-1"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        <Calendar size={10} /> {ad.lastSeen}
      </span>
    </>
  )}

  {(
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        Language
      </span>

      <span
        className="font-semibold text-[11px] flex items-center gap-1"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        <Globe size={10} /> {ad.adLanguage || "—"}
      </span>
    </>
  )}

  {ad.network && (
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        Platform
      </span>

      <span
        className="font-bold text-[11px]"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        {platformDisplayName}
      </span>
    </>
  )}

  {platform === "tiktok" && ad.industry && (
    <>
      <span
        className="text-[9px] font-bold uppercase"
        style={{
          color: "var(--color-text-secondary)",
          letterSpacing: "0.12em",
        }}
      >
        Category
      </span>

      <span
        className="font-bold text-[11px]"
        style={{
          color: "var(--color-text-secondary)",
        }}
      >
        {ad.industry}
      </span>
    </>
  )}

  {platform === "tiktok" &&
    ad.budget != null &&
    ad.budget !== "" && (
      <>
        <span
          className="text-[9px] font-bold uppercase"
          style={{
            color: "var(--color-text-secondary)",
            letterSpacing: "0.12em",
          }}
        >
          Budget
        </span>

        <span
          className="font-semibold text-[11px]"
          style={{
            color: "var(--color-text-secondary)",
          }}
        >
          {ad.budget}
        </span>
      </>
    )}

  {platform === "tiktok" &&
    ad.ctr != null &&
    ad.ctr !== "" && (
      <>
        <span
          className="text-[9px] font-bold uppercase"
          style={{
            color: "var(--color-text-secondary)",
            letterSpacing: "0.12em",
          }}
        >
          CTR
        </span>

        <span
          className="font-semibold text-[11px]"
          style={{
            color: "var(--color-text-secondary)",
          }}
        >
          {ad.ctr}%
        </span>
      </>
    )}
</div>
</div>
            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  // Fire-and-forget preload of the creative so it's already
                  // decoded by the time AnalyticsModal mounts its own <img>.
                  // Browser HTTP cache holds raw bytes; each <img> element
                  // still has to redecode them into a bitmap (1–2s for large
                  // thumbnails). Image.decode() warms that decode pipeline.
                  if (ad?.thumbnail && typeof window !== "undefined") {
                    const preload = new window.Image();
                    preload.src = ad.thumbnail;
                    if (preload.decode) {
                      preload.decode().catch(() => {});
                    }
                  }
                  onAnalytics?.(ad);
                }}
                className="flex-1 py-2 rounded-lg text-[11px] font-bold transition-colors bg-[#335296] hover:opacity-80 text-white"
              >
                Analytics
              </button>
              {ad.adUrl && ad.adUrl !== "#" && (
                <a
                  href={ad.adUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackEvent('viewOriginal', { ad_id: ad.adId ?? ad.id, network: platform ?? ad.network ?? 'facebook' })}
                  className="px-4 py-2 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1.5"
                  style={{
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <ExternalLink size={12} /> View Original
                </a>
              )}
              <div className="relative group/copy">
                <button
                  onClick={handleCopyLink}
                  disabled={copyLoading}
                  className="px-3 py-2 rounded-xl text-[11px] font-bold transition-colors flex items-center gap-1"
                  style={{
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                    opacity: copyLoading ? 0.6 : 1,
                    cursor: copyLoading ? "wait" : "pointer",
                  }}
                >
                  {copied ? (
                    <Check size={12} className="text-green-400" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-[10px] font-bold rounded-lg shadow-xl opacity-0 group-hover/copy:opacity-100 transition-all duration-200 pointer-events-none z-50 whitespace-nowrap border border-white/10">
                  {copied ? "Copied!" : "Copy ad link"}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 bg-[#1a1a1a] rotate-45 border-r border-b border-white/10" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Advertiser tooltip — fixed above the name, escapes overflow clipping */}
      {advTooltipPos && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ bottom: advTooltipPos.bottom, left: advTooltipPos.left }}
        >
          <div className="bg-[#1a1a1a] text-white text-[11px] px-3 py-2 rounded-lg shadow-2xl whitespace-nowrap text-center font-bold leading-tight border border-white/10 min-w-[200px] font-sans">
            Click here to see all the ads from<br />{ad.advertiser}
          </div>
          <div className="w-3 h-3 bg-[#1a1a1a] border-r border-b border-white/10 rotate-45 absolute left-4 -bottom-[6px]" />
        </div>
      )}

      {/* Hide/Unhide dropdown — rendered fixed to escape overflow clipping */}
      {showHideMenu && (
        <>
          <div
            className="fixed inset-0 z-[500]"
            onClick={(e) => { e.stopPropagation(); setShowHideMenu(false); }}
          />
          <div
            className="fixed z-[501] min-w-[170px] rounded-xl border backdrop-blur-xl shadow-2xl overflow-hidden"
            style={{
              top: hideMenuPos.top,
              left: hideMenuPos.left,
              backgroundColor: "var(--color-card)",
              backgroundImage: "linear-gradient(rgba(255,255,255,0.02), rgba(255,255,255,0.02))",
              borderColor: "rgba(255,255,255,0.06)",
            }}
          >
            {isHidden ? (
              <>
                {isAdvertiserHidden ? (
                  <button
                    onClick={() => {
                      onUnHideAd?.({ ...ad, hideType: 1 });
                      setShowHideMenu(false);
                      onClose();
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
                  >
                    <Eye size={13} className="text-white/40" />
                    Unhide advertiser
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        onUnHideAd?.({ ...ad, hideType: 2 });
                        setShowHideMenu(false);
                        onClose();
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
                    >
                      <Eye size={13} className="text-white/40" />
                      Unhide this ad
                    </button>
                    <button
                      onClick={() => {
                        onHideAdvertiser?.(ad);
                        setShowHideMenu(false);
                        onClose();
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
                    >
                      <EyeOff size={13} className="text-white/40" />
                      Hide advertiser
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    onHideAdvertiser?.(ad);
                    setShowHideMenu(false);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
                >
                  <EyeOff size={13} className="text-white/40" />
                  Hide advertiser
                </button>
                <button
                  onClick={() => {
                    onHideAd?.(ad);
                    setShowHideMenu(false);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
                >
                  <EyeOff size={13} className="text-white/40" />
                  Hide this ad
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AdDetailModal;

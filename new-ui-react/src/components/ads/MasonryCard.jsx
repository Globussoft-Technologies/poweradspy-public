import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { createPortal } from "react-dom";
import {
  Play,
  ThumbsUp,
  Eye,
  EyeOff,
  Share2,
  MessageCircle,
  Heart,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Link,
  Check,
  Download,
  TrendingUp,
  MousePointerClick,
  Wallet,
  Film,
  Layers,
  Monitor,
  Search,
  Type,
  Star,
} from "lucide-react";
import { AD_TYPE_BADGES, getStarRating } from "../../constants";
import {
  createShareLink,
  fetchFreshTikTokVideoUrl,
  getVideoEmbedUrl,
  trackEvent,
} from "../../services/api";
import { downloadAdAsPdf } from "../../services/adPdf";

import metaIcon from "../../assets/meta.svg";
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

const MC_MP_IMGS = {
  "agkn.com": mpAgkn,
  branch: mpBranch,
  "conversionx.co": mpConversionx,
  "demdex.net": mpDemdex,
  doubleclick: mpDoubleclick,
  "hubs.ly": mpHubspot,
  "ow.ly": mpHootsuite,
  "xg4ken.com": mpKenshoo,
};
const MC_MP_LIST = [
  { match: "demdex.net", file: "demdex.net", title: "Adobe Audience Manager" },
  { match: "branch", file: "branch", title: "Branch" },
  { match: "conversionx.co", file: "conversionx.co", title: "Conversionx" },
  {
    match: "doubleclick",
    file: "doubleclick",
    title: "Google Marketing Platform",
  },
  { match: "ow.ly", file: "ow.ly", title: "Hootsuite" },
  { match: "hubs.ly", file: "hubs.ly", title: "Hubspot" },
  { match: "xg4ken.com", file: "xg4ken.com", title: "Kenshoo" },
  { match: "agkn.com", file: "agkn.com", title: "Neustar" },
];
const MC_EC_IMGS = {
  bigcommerce: ecBigCommerce,
  demandware: ecDemandware,
  prestashop: ecPrestaShop,
  shopify: ecShopify,
  squarespace: ecSquarespace,
  volusion: ecVolusion,
  wix: ecWix,
  woocommerce: ecWooCommerce,
  "3dcart": ec3dCart,
  magento: ecMagento,
};
const MC_FN_IMGS = {
  builderall: fnBuilderall,
  clickfunnels: fnClickfunnel,
  clickfunnel: fnClickfunnel,
  convertri: fnConvertri,
  getresponse: fnGetresponse,
  instapage: fnInstapage,
  kajabi: fnKajabi,
  kartra: fnKartra,
  keap: fnKeap,
  landingi: fnLandingi,
  leadpages: fnLeadpages,
  optimizepress: fnOptimizepress,
  samcart: fnSamcart,
  wishpond: fnWishpond,
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
  image: ImageIcon,
  banner: Monitor,
  display: Monitor,
  discovery: Search,
  "text-image": Type,
  text: Type,
};

const formatStat = (val) => {
  if (val == null || val === "" || val === "N/A") return null;
  // Already a formatted string with units (e.g. "195.4K", "39%") — pass
  // through untouched (CTR can legitimately be "0%", so format strings
  // with a % bypass the numeric zero filter below).
  if (typeof val === "string" && /[a-zA-Z%]/.test(val)) return val;
  const num = Number(val);
  if (isNaN(num)) return String(val);
  // Treat 0 as "no data" so the icon is omitted entirely instead of
  // rendering a misleading "0". Matches formatNumber() in services/api.js
  // and the truthy-only checks AdDetailModal uses.
  if (num === 0) return null;
  if (num >= 1_000_000)
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(num);
};

// All six engagement stats with their idiomatic icon + colour. The card
// renders an icon for every stat that has data — no per-platform trio,
// no "N/A" placeholders — and a tooltip on hover provides the label.
// Impressions: TrendingUp (reach trend), CTR: MousePointerClick — these
// match the original MasonryCard mappings pre-redesign so users see the
// same icons they're already familiar with from other platforms.
const STAT_ORDER = ["impressions", "views", "likes", "comments", "shares", "ctr"];

const STAT_CONFIG = {
  impressions: { label: "Impressions", Icon: TrendingUp,        color: "text-[#a78bfa]" },
  views:       { label: "Views",       Icon: Eye,               color: "text-slate-400" },
  likes:       { label: "Likes",       Icon: ThumbsUp,          color: "text-[#6b99ff]" },
  comments:    { label: "Comments",    Icon: MessageCircle,     color: "text-yellow-500" },
  shares:      { label: "Shares",      Icon: Share2,            color: "text-green-500" },
  ctr:         { label: "CTR",         Icon: MousePointerClick, color: "text-cyan-400" },
};

const resolveStatValue = (key, ad) => {
  switch (key) {
    case "impressions": return ad.impressions;
    case "ctr": {
      // Match the no-data treatment applied to other stats (0 ⇒ hide).
      // Without this, "0%" would bypass formatStat's numeric zero filter
      // via the format-string fast path and render as a real metric.
      if (ad.ctr == null || ad.ctr === "") return null;
      const n = Number(ad.ctr);
      if (isNaN(n) || n === 0) return null;
      return `${ad.ctr}%`;
    }
    case "views":       return ad.views;
    case "likes":       return ad.likes;
    case "comments":    return ad.comments;
    case "shares":      return ad.shares;
    default:            return null;
  }
};

const MasonryCard = ({
  ad,
  isFavourite,
  onToggleFavourite,
  onClick,
  onImageReady,
  onSearch,
  onHideAd,
  onHideAdvertiser,
  isHidden = false,
  isAdvertiserHidden = false,
  onUnhide,
  showCopyLink = false,
  guest,
}) => {
  const platform = String(ad.network || "").toLowerCase();
  // Network shown on the corner badge. YouTube DISPLAY ads surfaced under GDN
  // carry badgeNetwork:'gdn' so they show the GDN badge (while still routing to
  // YouTube via ad.network).
  const badgeNetwork = String(ad.badgeNetwork || ad.network || "").toLowerCase();
  const adTypeLower = (ad.adType || "image").toLowerCase();
  const badge = AD_TYPE_BADGES[adTypeLower] || AD_TYPE_BADGES.image;
  const TypeIcon = AD_TYPE_ICONS[adTypeLower] || ImageIcon;
  const isVideo = adTypeLower === "video";
  const isTextOnlyAd =
    adTypeLower === "text" ||
    adTypeLower === "organic_search" ||
    adTypeLower === "native_ad";
  const isBannerAd = adTypeLower === "banner";
  const isTextImageAd = adTypeLower === "text-image";
  const isActive = (ad.status || "").toLowerCase() === "active";
  const hasMediaOverlay = !isTextOnlyAd && !isBannerAd && !isTextImageAd;

  const [imgError, setImgError] = useState(false);
  const [advImgError, setAdvImgError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [showHideMenu, setShowHideMenu] = useState(false);
  const [hideMenuPos, setHideMenuPos] = useState({ top: 0, left: 0 });
  const hideButtonRef = useRef(null);
  const hideMenuRef = useRef(null);

  // Outside-click dismissal — using a document mousedown listener instead of
  // a fullscreen backdrop. A backdrop would (a) sit above the hover-icon
  // strip, blocking clicks back on the EyeOff button, and (b) steal hover
  // state from the card so the icons would fade out the moment the menu
  // opened. The listener ignores clicks on the button itself so its own
  // onClick can keep toggling.
  useEffect(() => {
    if (!showHideMenu) return;
    const handler = (e) => {
      if (hideMenuRef.current?.contains(e.target)) return;
      if (hideButtonRef.current?.contains(e.target)) return;
      setShowHideMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHideMenu]);

  const handleCopyLink = async (e) => {
    e.stopPropagation();
    if (copyLoading) return;
    setCopyLoading(true);
    try {
      const adId = ad.adId || ad.id || "";
      const network = String(ad.network || "facebook").toLowerCase();
      const result = await createShareLink({ adId, network });
      const url = `${window.location.origin}/share/${result.token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      trackEvent('copyAd', { ad_id: adId, network, landing_page_url: url });
    } catch {
      // silently fail
    } finally {
      setCopyLoading(false);
    }
  };

  // Download styled PDF report. Shared with AdDetailModal — see services/adPdf.js.
  const handleDownload = (e) => {
    e.stopPropagation();
    if (guest?.isRestricted || guest?.isPublicLanding) {
      guest?.showGuestWarning?.("Please login to download ads");
      return;
    }
    downloadAdAsPdf(ad);
    trackEvent('downloadAd', { ad_id: ad.adId ?? ad.id, network: ad.network ?? 'NA' });
  };

  // Lock media container height so thumbnail↔video swap doesn't resize the card
  const mediaRef = useRef(null);
  const [lockedHeight, setLockedHeight] = useState(null);

  // ─── Video URL with fallback ──────────────────────
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState(null);
  const [isRefreshingVideo, setIsRefreshingVideo] = useState(false);
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const videoRefreshAttempted = useRef(false);
  const videoStallTimerRef = useRef(null);
  const isTikTok = platform === "tiktok";
  const isQuora = platform === "quora";
  const effectiveVideoUrl = resolvedVideoUrl || ad.videoUrl;
  // YouTube and Facebook ads ship their playable URL in `ad_url` (mapped to
  // ad.adUrl) — not in ad.videoUrl — so for those we embed via iframe rather
  // than <video> (which can't decode either platform's watch page).
  const embedUrl = useMemo(
    () => getVideoEmbedUrl(ad.adUrl),
    [ad.adUrl],
  );

  const clearVideoStallTimer = useCallback(() => {
    if (videoStallTimerRef.current) {
      clearTimeout(videoStallTimerRef.current);
      videoStallTimerRef.current = null;
    }
  }, []);

  // Treat a dead video URL the same as any other load failure. Without this,
  // an expired CDN URL would buffer indefinitely (no `error` event fires until
  // the network actually rejects) and the user is stuck on a black frame.
  const handleVideoError = useCallback(async () => {
    clearVideoStallTimer();
    if (videoRefreshAttempted.current) {
      // Fallback URL also failed — give up so we don't loop on a dead source.
      setIsPlaying(false);
      setVideoUnavailable(true);
      return;
    }
    videoRefreshAttempted.current = true;

    if (isTikTok && ad.tiktokLibraryUrl && !(guest?.isRestricted || guest?.isPublicLanding)) {
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
    } else if (isQuora && ad.videoUrlFallback) {
      setResolvedVideoUrl(ad.videoUrlFallback);
    } else {
      setIsPlaying(false);
      setVideoUnavailable(true);
    }
  }, [clearVideoStallTimer, isTikTok, isQuora, ad.tiktokLibraryUrl, ad.videoUrlFallback, guest]);

  const handleVideoLoadStart = useCallback(() => {
    clearVideoStallTimer();
    // 12s without a single frame ≈ expired/unreachable URL. The HTMLMediaElement
    // won't always raise `error` (browsers keep retrying on the network layer),
    // so we have to budget the wait ourselves.
    videoStallTimerRef.current = setTimeout(() => {
      handleVideoError();
    }, 12000);
  }, [clearVideoStallTimer, handleVideoError]);

  const handleVideoCanPlay = useCallback(() => {
    clearVideoStallTimer();
  }, [clearVideoStallTimer]);

  // Reset video state if the underlying ad changes (carded grid reuses the
  // component instance across pages of results) so we don't carry an old
  // ad's "unavailable" verdict into a new one.
  useEffect(() => {
    setVideoUnavailable(false);
    setResolvedVideoUrl(null);
    videoRefreshAttempted.current = false;
    clearVideoStallTimer();
  }, [ad.id, ad.videoUrl, clearVideoStallTimer]);

  useEffect(() => () => clearVideoStallTimer(), [clearVideoStallTimer]);

  // Backend splits carousel ads across two fields: the cover image lands in
  // `thumbnail` (image_video_url) and the rest of the slides in `carouselMedia`
  // (ad_image_video). Without prepending the cover here, it would be missing
  // from the card view even though the PDF export includes it — keeps card,
  // detail, analytics, and PDF surfaces showing the same set of slides.
  const carouselImages = useMemo(() => {
    const media = ad.carouselMedia || [];
    // `carouselMedia` is already DefaultImage-filtered in mapAdToCard; also skip
    // the cover when it's the placeholder so a broken first slide doesn't render.
    const coverOk = ad.thumbnail && !ad.thumbnail.includes("DefaultImage");
    if (coverOk && media.length > 0 && !media.includes(ad.thumbnail)) {
      return [ad.thumbnail, ...media];
    }
    return media;
  }, [ad.thumbnail, ad.carouselMedia]);

  const hasCarousel = carouselImages.length > 1;
  const currentImg = hasCarousel
    ? carouselImages[activeIndex]
    : ad.thumbnail || "";
  const rawTitleStr =
    (ad.carouselTitles?.length > activeIndex
      ? ad.carouselTitles[activeIndex]
      : ad.title) || "";
  const currentTitle = useMemo(
    () => rawTitleStr.replace(/^,|,$/g, "").trim(),
    [rawTitleStr],
  );
  const decodedTitle = useMemo(
    () => he.decode(currentTitle || ""),
    [currentTitle],
  );

  const handleImgLoad = useCallback(() => {
    setIsImageLoading(false);
    setImgError(false);
    setImgRetryCount(0);
    if (mediaRef.current && !lockedHeight) {
      const h = mediaRef.current.getBoundingClientRect().height;
      if (h > 0) setLockedHeight(h);
    }
    onImageReady?.(ad.id);
  }, [ad.id, onImageReady, lockedHeight]);

  // Auto-retry transient image failures (CDN hiccups, network blips).
  const MAX_IMG_RETRIES = 3;
  const [imgRetryCount, setImgRetryCount] = useState(0);
  const imgRetryTimerRef = useRef(null);

  const handleImgError = useCallback(() => {
    setImgRetryCount((prev) => {
      if (prev >= MAX_IMG_RETRIES) {
        setIsImageLoading(false);
        setImgError(true);
        onImageReady?.(ad.id);
        return prev;
      }
      const delays = [800, 2000, 4500];
      const next = prev + 1;
      imgRetryTimerRef.current = setTimeout(() => {
        setImgRetryCount(next);
      }, delays[prev] || 4500);
      setIsImageLoading(true);
      setImgError(false);
      return prev;
    });
  }, [ad.id, onImageReady]);

  useEffect(() => {
    if (imgRetryTimerRef.current) clearTimeout(imgRetryTimerRef.current);
    setImgRetryCount(0);
    setImgError(false);
    setIsImageLoading(true);
  }, [currentImg]);

  useEffect(
    () => () => {
      if (imgRetryTimerRef.current) clearTimeout(imgRetryTimerRef.current);
    },
    [],
  );

  React.useEffect(() => {
    if (!ad.thumbnail && adTypeLower !== "text") onImageReady?.(ad.id);
  }, [ad.id, ad.thumbnail, adTypeLower, onImageReady]);

  const starRating = useMemo(
    () => (ad.popularity ? getStarRating(ad.popularity) : 0),
    [ad.popularity],
  );
  const ratingLabel = starRating > 0 ? starRating.toFixed(1) : null;

  // ─── Available engagement stats ──────────────────────────
  // Show whichever of the 6 fields actually have data, in canonical order.
  // No N/A placeholders — if a stat is missing, its icon doesn't render.
  // If none of the six have data, the whole row is omitted.
  const availableStats = useMemo(
    () =>
      STAT_ORDER.map((key) => ({
        key,
        ...STAT_CONFIG[key],
        value: formatStat(resolveStatValue(key, ad)),
      })).filter((s) => s.value),
    [ad],
  );

  // Derived handle ("@advertiser" if no real handle is in the data)
  const handle = useMemo(() => {
    if (!ad.advertiser) return null;
    return "@" + ad.advertiser.replace(/\s+/g, "").toLowerCase();
  }, [ad.advertiser]);

  return (
    <>
    <div
      onClick={() => onClick?.(ad)}
      className="group relative h-full cursor-pointer rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-300 bg-[#0f111a] border border-white/10 hover:border-white/25"
    >
      <div className="flex flex-col h-full">
        {/* ═══ MEDIA SECTION ═══════════════════════════════════════ */}
        <div
          ref={mediaRef}
          className="relative overflow-hidden flex items-center justify-center group/carousel bg-[#0a0a0a]"
          style={lockedHeight ? { height: lockedHeight } : { minHeight: 220 }}
        >
          {isBannerAd ? (
            <div className="w-full flex flex-col items-center justify-center p-6 bg-gradient-to-br from-indigo-950/40 to-slate-900/40 min-h-[240px]">
              <p className="text-[13px] font-bold text-white/90 text-center line-clamp-3 mb-2">
                {ad.subtitle ||
                  ad.newsfeed_description ||
                  ad.newsfeeddescription ||
                  ""}
              </p>
              <p className="text-[12px] text-zinc-300 text-center line-clamp-4 mb-2">
                {ad.adText || ""}
              </p>
              <p className="text-[11px] font-medium text-zinc-400 text-center line-clamp-1">
                {currentTitle || ad.ad_title || ad.title || ""}
              </p>
            </div>
          ) : isTextOnlyAd ? (
            <div className="w-full flex items-center min-h-60 justify-center p-6 bg-gradient-to-br from-indigo-950/40 to-slate-900/40">
              <p className="text-[14px] font-medium leading-relaxed text-zinc-300 text-center line-clamp-6">
                "{currentTitle || ad.ad_text || "Text Ad"}"
              </p>
            </div>
          ) : isTextImageAd ? (
            <div className="relative w-full min-h-[220px] flex items-center justify-center overflow-hidden">
              {currentImg && (
                <img
                  src={currentImg}
                  alt=""
                  onLoad={handleImgLoad}
                  onError={handleImgError}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/40" />
              <p className="relative z-10 text-[14px] font-semibold leading-relaxed text-white text-center px-5 line-clamp-5 drop-shadow-lg">
                {ad.textImageTitle || currentTitle || ad.ad_text || ""}
              </p>
            </div>
          ) : (
            <div className="relative w-full h-full min-h-[220px]">
              {isPlaying && isVideo && (effectiveVideoUrl || embedUrl) ? (
                <>
                  {effectiveVideoUrl ? (
                    <video
                      key={effectiveVideoUrl}
                      src={effectiveVideoUrl}
                      className="relative z-20 w-full object-contain bg-black"
                      style={{ height: lockedHeight || 220 }}
                      autoPlay
                      controls
                      onEnded={() => {}}
                      onError={handleVideoError}
                      onLoadStart={handleVideoLoadStart}
                      onCanPlay={handleVideoCanPlay}
                    />
                  ) : (
                    <iframe
                      key={embedUrl}
                      src={embedUrl}
                      title={currentTitle || "Video ad"}
                      className="relative z-20 w-full bg-black border-0"
                      style={{ height: lockedHeight || 220 }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  )}
                  {isRefreshingVideo && (
                    <div className="absolute inset-0 z-30 bg-black/70 flex flex-col items-center justify-center gap-2">
                      <Loader2 size={24} className="text-white animate-spin" />
                      <span className="text-[10px] text-white/70 font-medium">
                        Refreshing video…
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {!imgError && (
                    <img
                      key={`${currentImg}_${imgRetryCount}`}
                      src={currentImg}
                      alt={currentTitle}
                      decoding="async"
                      onLoad={handleImgLoad}
                      onError={handleImgError}
                      className={`absolute inset-0 w-full h-full object-cover block transition-opacity duration-300 ${
                        isImageLoading ? "opacity-0" : "opacity-100"
                      }`}
                    />
                  )}
                  {isImageLoading && !imgError && (
                    <div className="absolute inset-0 z-20 media-shimmer pointer-events-none" />
                  )}
                  {imgError && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-900/70 to-zinc-800/40 pointer-events-none">
                      <ImageIcon
                        size={28}
                        className="text-zinc-500"
                        strokeWidth={1.5}
                      />
                      <span className="text-[10px] font-medium text-zinc-400 tracking-wide">
                        Preview unavailable
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* Subtle diagonal watermark — gives empty/dark thumbnails some texture */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden z-[15]">
                <span
                  className="text-white/[0.05] font-bold uppercase whitespace-nowrap select-none"
                  style={{
                    transform: "rotate(-22deg)",
                    fontSize: "13px",
                    letterSpacing: "0.35em",
                  }}
                >
                  AD CREATIVE · {badgeNetwork.toUpperCase()}
                </span>
              </div>

              {/* Play affordance for videos */}
              {isVideo && !isPlaying && !videoUnavailable && (
                <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                  <button
                    className="w-14 h-14 bg-black/55 backdrop-blur-md rounded-full flex items-center justify-center border border-white/25 shadow-[0_0_20px_rgba(0,0,0,0.5)] transform transition-all group-hover:scale-110 group-hover:bg-black/70 pointer-events-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Nothing playable (no direct media URL and no
                      // YouTube/Facebook watch URL in ad_url). Hide the play
                      // affordance and let the thumbnail stand on its own.
                      if (!effectiveVideoUrl && !embedUrl) {
                        setVideoUnavailable(true);
                        return;
                      }
                      setIsPlaying(true);
                    }}
                  >
                    <Play
                      fill="white"
                      className="ml-0.5 text-white drop-shadow-xl"
                      size={22}
                    />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Title overlay — bottom gradient on image/video/carousel */}
          {hasMediaOverlay && decodedTitle && !isPlaying && (
            <div className="absolute inset-x-0 bottom-0 z-30 pt-32 pb-3.5 px-4 bg-gradient-to-t from-black to-transparent pointer-events-none">
              <h3 className="text-white font-bold text-[14px] leading-snug line-clamp-2 drop-shadow-lg">
                {decodedTitle}
              </h3>
            </div>
          )}

          {/* Top-left: triangular corner ribbon with platform icon — always visible */}
          {PLATFORM_ICONS[badgeNetwork] && (
            <div className="absolute top-0 left-0 w-16 h-16 z-30 pointer-events-none overflow-hidden">
              <div
                className="absolute inset-0 bg-white/20 flex items-center justify-center"
                style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
              >
                <div className="flex items-center gap-1 pr-5 pb-7">
                  <img
                    src={PLATFORM_ICONS[badgeNetwork]}
                    alt={badgeNetwork}
                    className="w-[22px] h-[22px] object-contain drop-shadow-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Top-right: hover-revealed action strip — order: Type, Like, Download, Hide.
              Stays visible while the hide menu is open so the user can click
              the EyeOff icon again to dismiss without losing track of it. */}
          <div
            className={`absolute top-2.5 right-2.5 z-30 flex items-center gap-1.5 transition-opacity duration-200 ${
              showHideMenu ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {/* Ad type label */}
            <span
              className={`ad-type-badge inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border backdrop-blur-md shadow-[0_1px_4px_rgba(0,0,0,0.4)] !bg-black/60 ${badge.color}`}
            >
              <TypeIcon size={10} />
              {badge.label}
            </span>

            {/* Like / Favourite */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (guest?.isRestricted || guest?.isPublicLanding) {
                  guest?.showGuestWarning?.("Please login to save favourites");
                  return;
                }
                onToggleFavourite?.(ad);
              }}
              title={
                isFavourite ? "Remove from favourites" : "Add to favourites"
              }
              className={`w-8 h-8 rounded-md backdrop-blur-md border flex items-center justify-center transition-colors ${
                isFavourite
                  ? "bg-black/65 border-rose-500/40"
                  : "bg-black/55 border-white/15 hover:bg-black/75"
              }`}
            >
              <Heart
                size={14}
                className={
                  isFavourite ? "fill-rose-500 text-rose-500" : "text-zinc-100"
                }
              />
            </button>

            {/* Download */}
            <button
              onClick={handleDownload}
              title="Download ad report (PDF)"
              className="w-8 h-8 rounded-md bg-black/55 backdrop-blur-md border border-white/15 flex items-center justify-center text-zinc-100 hover:bg-black/75 transition-colors"
            >
              <Download size={14} />
            </button>

            {/* Hide / Unhide — only render if the parent wired up a handler.
                SavedAdsPage's Favourites tab intentionally omits onHideAd so
                the hide affordance stays out of that view. */}
            {isHidden ? (
              onUnhide && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnhide(ad);
                  }}
                  title={isAdvertiserHidden ? "Unhide advertiser" : "Unhide ad"}
                  className="w-8 h-8 rounded-md bg-black/55 backdrop-blur-md border border-white/15 flex items-center justify-center hover:bg-black/75 transition-colors"
                >
                  <Eye
                    size={14}
                    className={
                      isAdvertiserHidden ? "text-red-400" : "text-blue-400"
                    }
                  />
                </button>
              )
            ) : (
              onHideAd && (
                <button
                  ref={hideButtonRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!showHideMenu && hideButtonRef.current) {
                      const rect = hideButtonRef.current.getBoundingClientRect();
                      // Anchor menu below the button, right-aligned with the icon
                      // (180 ≈ menu min-width). Clamps to viewport so the menu
                      // never slides offscreen on narrow cards near the edge.
                      setHideMenuPos({
                        top: rect.bottom + 4,
                        left: Math.max(8, rect.right - 180),
                      });
                    }
                    setShowHideMenu((v) => !v);
                  }}
                  title="Hide ad or advertiser"
                  className="w-8 h-8 rounded-md bg-black/55 backdrop-blur-md border border-white/15 flex items-center justify-center text-zinc-100 hover:bg-black/75 transition-colors"
                >
                  <EyeOff size={14} />
                </button>
              )
            )}

            {/* Copy link — only on saved/hidden pages */}
            {showCopyLink && (
              <button
                onClick={handleCopyLink}
                disabled={copyLoading}
                title={
                  copied ? "Copied!" : copyLoading ? "Copying…" : "Copy ad link"
                }
                className="w-8 h-8 rounded-md bg-black/55 backdrop-blur-md border border-white/15 flex items-center justify-center text-zinc-100 hover:bg-black/75 transition-colors disabled:opacity-60"
              >
                {copied ? (
                  <Check size={14} className="text-green-400" />
                ) : copyLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Link size={14} />
                )}
              </button>
            )}
          </div>

          {/* Carousel controls */}
          {hasCarousel && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIndex((prev) =>
                    prev > 0 ? prev - 1 : carouselImages.length - 1,
                  );
                }}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-30 p-1.5 rounded-full bg-black/50 backdrop-blur-md text-white border border-white/20 shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-all hover:bg-black/70"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIndex((prev) =>
                    prev < carouselImages.length - 1 ? prev + 1 : 0,
                  );
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-30 p-1.5 rounded-full bg-black/50 backdrop-blur-md text-white border border-white/20 shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-all hover:bg-black/70"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>

        {/* ═══ BODY ═══════════════════════════════════════════════ */}
        <div className="px-4 py-3.5 flex flex-col gap-3 flex-1">
          {/* Advertiser row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="relative flex-shrink-0">
                {ad.advertiserImage &&
                !ad.advertiserImage.includes("DefaultImage.jpg") &&
                !advImgError ? (
                  <img
                    src={ad.advertiserImage}
                    alt=""
                    onError={() => setAdvImgError(true)}
                    className="w-10 h-10 rounded-full object-cover border border-white/10"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold bg-[#335296]/10 text-[#6b99ff] border border-[#3759a3]/10">
                    {(ad.advertiser || "?")[0].toUpperCase()}
                  </div>
                )}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0f111a] ${
                    isActive
                      ? "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.7)]"
                      : "bg-zinc-600"
                  }`}
                  title={isActive ? "Currently running" : "Inactive"}
                />
              </div>

              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-1 min-w-0">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onSearch?.(ad.advertiser, "advertiser");
                    }}
                    className="text-[14px] font-bold truncate text-zinc-100 hover:text-[#6b99ff] cursor-pointer transition-colors"
                    title={`See all ads from ${ad.advertiser}`}
                  >
                    {ad.advertiser}
                  </span>
                  {ad.verified && (
                    <svg
                      className="w-3.5 h-3.5 flex-shrink-0"
                      viewBox="0 0 20 20"
                      fill="none"
                    >
                      <circle cx="10" cy="10" r="10" fill="#335296" />
                      <path
                        d="M5.5 10.5L8.5 13.5L14.5 7"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {ad.isMetaLib && (
                    <img
                      src={metaIcon}
                      alt="meta"
                      className="w-3.5 h-3.5 flex-shrink-0"
                    />
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mt-0.5 truncate">
                  {handle && <span className="truncate">{handle}</span>}
                  {ad.runningDays && (
                    <>
                      <span className="opacity-50">·</span>
                      <span className="whitespace-nowrap">
                        {ad.runningDays}d running
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Star rating pill — popularity is derived from impressions +
                engagement (see getStarRating in constants/index.js). */}
            {ratingLabel && (
              <div className="relative group/pop flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 flex-shrink-0">
                <Star size={12} className="fill-amber-400 text-amber-400" />
                <span className="text-[13px] font-black leading-none text-zinc-100">
                  {ratingLabel}
                </span>
                <div className="absolute bottom-full right-0 mb-1.5 px-2 py-1 bg-[#1a1a1a] text-white text-[10px] font-semibold rounded-md border border-white/10 whitespace-nowrap opacity-0 group-hover/pop:opacity-100 pointer-events-none transition-opacity z-50">
                  Popularity
                </div>
              </div>
            )}
          </div>

          {/* Marketing platform / ecommerce / funnel logos */}
          {(() => {
            const mpUrlObj = ad.marketPlatformUrls || {};
            const mpRedirects = (mpUrlObj.url_redirects || "")
              .split("||")
              .map((s) => s.trim())
              .filter(Boolean);
            const redirectUrlsArr = Array.isArray(mpUrlObj.redirect_urls)
              ? mpUrlObj.redirect_urls
              : typeof mpUrlObj.redirect_urls === "string" &&
                  mpUrlObj.redirect_urls
                ? [mpUrlObj.redirect_urls]
                : [];
            const urlSources = [
              ad.destinationUrl,
              mpUrlObj.destination_url,
              mpUrlObj.url_destination,
              mpUrlObj.source_url,
              mpUrlObj.redirect_url,
              mpUrlObj.final_url,
              ...mpRedirects,
              ...redirectUrlsArr,
            ];
            const seen = new Set();
            const mpLogos = [];
            for (const urlVal of urlSources) {
              if (!urlVal) continue;
              const lower = urlVal.toLowerCase();
              for (const mp of MC_MP_LIST) {
                if (lower.includes(mp.match) && !seen.has(mp.match)) {
                  seen.add(mp.match);
                  const src = MC_MP_IMGS[mp.file];
                  if (src)
                    mpLogos.push({ key: mp.match, src, title: mp.title });
                }
              }
            }
            const ecRaw = ad.builtWith;
            const ecList = Array.isArray(ecRaw) ? ecRaw : ecRaw ? [ecRaw] : [];
            const ecLogos = ecList
              .map((name) => {
                const src = MC_EC_IMGS[name.toLowerCase().replace(/\s+/g, "")];
                return src ? { key: `ec_${name}`, src, title: name } : null;
              })
              .filter(Boolean);
            const fnRaw = ad.builtWithFunnel;
            const fnList = Array.isArray(fnRaw) ? fnRaw : fnRaw ? [fnRaw] : [];
            const fnLogos = fnList
              .map((name) => {
                const src = MC_FN_IMGS[name.toLowerCase().replace(/\s+/g, "")];
                return src ? { key: `fn_${name}`, src, title: name } : null;
              })
              .filter(Boolean);
            const allLogos = [...mpLogos, ...ecLogos, ...fnLogos];
            if (allLogos.length === 0) return null;
            return (
              <div className="flex items-center gap-1.5 flex-wrap">
                {allLogos.map((logo) => (
                  <div key={logo.key} className="relative shrink-0 group/logo">
                    <img
                      src={logo.src}
                      alt={logo.title}
                      title={logo.title}
                      className="h-4 w-auto object-contain opacity-80"
                      onError={(e) => {
                        e.target.style.display = "none";
                      }}
                    />
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Title in body — only for non-media variants (text/banner/text-image already render it inside the media) */}
          {!hasMediaOverlay && decodedTitle && (
            <h3 className="text-[13px] leading-relaxed text-zinc-200 break-words line-clamp-2">
              {decodedTitle}
            </h3>
          )}

          {/* Engagement stats — icon + value, label revealed on hover.
              Renders only the fields that have data; if none do, the whole
              row is omitted so empty cards don't show a meaningless rule. */}
          {availableStats.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 border-t border-dashed border-zinc-700/50">
              {availableStats.map((s) => {
                const Icon = s.Icon;
                return (
                  <div
                    key={s.key}
                    className="relative group/stat inline-flex items-center gap-1.5"
                  >
                    <Icon size={13} className={`flex-shrink-0 ${s.color}`} />
                    <span className="text-[12px] font-bold text-zinc-100">
                      {s.value}
                    </span>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#1a1a1a] text-white text-[10px] font-semibold rounded-md border border-white/10 whitespace-nowrap opacity-0 group-hover/stat:opacity-100 pointer-events-none transition-opacity z-50">
                      {s.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Budget chip — qualitative tag (`ad.budget`, e.g. TikTok's
              "High/Medium/Low") and/or numeric range (`ad.lowerBudget`,
              `ad.upperBudget`, e.g. Meta). Either signal is enough to
              render the chip, and both render side-by-side when present.
              Kept in sync with AdDetailModal so the two surfaces always
              agree on whether budget is reported for this ad. */}
          {(ad.budget || ad.lowerBudget > 0 || ad.upperBudget > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {ad.budget && (
                <span className="relative group/budget inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Wallet size={10} />
                  {ad.budget} budget
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#1a1a1a] text-white text-[10px] font-semibold rounded-md border border-white/10 whitespace-nowrap opacity-0 group-hover/budget:opacity-100 pointer-events-none transition-opacity z-50">
                    Estimated ad spend
                  </div>
                </span>
              )}
              {(ad.lowerBudget > 0 || ad.upperBudget > 0) && (
                <span className="relative group/budget inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Wallet size={10} />${ad.lowerBudget ?? 0} – ${ad.upperBudget ?? "∞"}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#1a1a1a] text-white text-[10px] font-semibold rounded-md border border-white/10 whitespace-nowrap opacity-0 group-hover/budget:opacity-100 pointer-events-none transition-opacity z-50">
                    Ad spend range
                  </div>
                </span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-auto pt-1">
            {(() => {
              // Prefer last-seen — it's the most useful "is this still active"
              // signal in the grid. Fall back to first-seen, then post date so
              // older datasets that don't carry last_seen still surface a date.
              const dateLabel = ad.lastSeen
                ? "Last seen"
                : ad.firstSeen
                  ? "First seen"
                  : ad.date
                    ? "Post date"
                    : null;
              const dateValue = ad.lastSeen || ad.firstSeen || ad.date;
              if (!dateValue) return <span />;
              return (
                <span className="relative group/date text-[10px] font-medium text-zinc-500">
                  {dateValue}
                  <div className="absolute bottom-full left-0 mb-1.5 px-2 py-1 bg-[#1a1a1a] text-white text-[10px] font-semibold rounded-md border border-white/10 whitespace-nowrap opacity-0 group-hover/date:opacity-100 pointer-events-none transition-opacity z-50">
                    {dateLabel}
                  </div>
                </span>
              );
            })()}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClick?.(ad);
              }}
              className="flex items-center gap-0.5 text-[11px] font-bold text-[#6b99ff] hover:opacity-80 transition-opacity"
            >
              View details
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

    </div>
    {/* Hide dropdown — portaled to document.body so it escapes the card's
        hover:-translate-y-0.5 transform (which would otherwise make the
        card a containing block for fixed descendants, breaking the menu's
        viewport-relative positioning). Mirrors the AdDetailModal hide menu. */}
    {showHideMenu &&
      createPortal(
        <div
          ref={hideMenuRef}
          className="fixed z-[501] min-w-[180px] rounded-xl border backdrop-blur-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          style={{
            top: hideMenuPos.top,
            left: hideMenuPos.left,
            backgroundColor: "var(--color-card)",
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.02), rgba(255,255,255,0.02))",
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <button
            onClick={() => {
              if (guest?.isRestricted || guest?.isPublicLanding) {
                guest?.showGuestWarning?.("Please login to hide ads");
                setShowHideMenu(false);
                return;
              }
              onHideAd?.(ad);
              setShowHideMenu(false);
            }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
          >
            <EyeOff size={13} className="text-white/40" />
            Hide this ad
          </button>
          <button
            onClick={() => {
              if (guest?.isRestricted || guest?.isPublicLanding) {
                guest?.showGuestWarning?.("Please login to hide advertisers");
                setShowHideMenu(false);
                return;
              }
              onHideAdvertiser?.(ad);
              setShowHideMenu(false);
            }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
          >
            <EyeOff size={13} className="text-white/40" />
            Hide advertiser
          </button>
        </div>,
        document.body,
      )}
    </>
  );
};

export default React.memo(MasonryCard);

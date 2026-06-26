import React, { useState, useMemo, useRef, useCallback } from "react";
import { fetchFreshTikTokVideoUrl } from "../../services/api";
import {
  Play,
  ThumbsUp,
  Eye,
  Share2,
  MessageCircle,
  ExternalLink,
  X,
  Download,
  Heart,
  MoreVertical,
  EyeOff,
  UserX,
  Link,
  Check,
  Star,
  StarHalf,
  Film,
  Layers,
  Image,
  ImageOff,
  Monitor,
  Search,
  Type,
  Clock,
  TrendingUp,
  MousePointerClick,
  Loader2,
} from "lucide-react";
import StatPill from "../shared/StatPill";
import {
  getVisibleMetrics,
  AD_TYPE_BADGES,
  getStarRating,
} from "../../constants";

import sponsoredIcon from "../../assets/sponsored.png";
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
    if (rating >= i) {
      stars.push(
        <Star key={i} size={10} className="fill-amber-400 text-amber-400" />,
      );
    } else if (rating >= i - 0.5) {
      stars.push(
        <StarHalf
          key={i}
          size={10}
          className="fill-amber-400 text-amber-400"
        />,
      );
    } else {
      stars.push(
        <Star key={i} size={10} className="text-theme-text-tertiary/30" />,
      );
    }
  }
  return <div className="flex items-center gap-0.5">{stars}</div>;
};

const AdCard = ({
  ad,
  isFavourite = false,
  onHideAd,
  onHideAdvertiser,
  onToggleFavourite,
  onAnalytics,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const platform = (ad.network || "").toLowerCase();
  const adTypeLower = (ad.adType || "image").toLowerCase();
  const badge = AD_TYPE_BADGES[adTypeLower] || AD_TYPE_BADGES.image;
  const TypeIcon = AD_TYPE_ICONS[adTypeLower] || Image;

  // ─── TikTok video refresh failsafe ──────────────────────
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState(null);
  const [isRefreshingVideo, setIsRefreshingVideo] = useState(false);
  const [videoRefreshFailed, setVideoRefreshFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const videoRefreshAttempted = useRef(false);

  const effectiveVideoUrl = resolvedVideoUrl || ad.videoUrl;
  const isTikTok = platform === 'tiktok';

  /**
   * When a TikTok video fails to load (expired CDN URL), try to fetch
   * a fresh URL from the backend proxy. Only attempts once per card.
   */
  const handleVideoError = useCallback(async () => {
    // Only run for TikTok, only attempt once, and only if we have a library URL
    if (!isTikTok || videoRefreshAttempted.current || !ad.tiktokLibraryUrl) {
      setVideoRefreshFailed(true);
      return;
    }
    videoRefreshAttempted.current = true;
    setIsRefreshingVideo(true);

    try {
      const freshUrl = await fetchFreshTikTokVideoUrl(ad.tiktokLibraryUrl);
      if (freshUrl) {
        setResolvedVideoUrl(freshUrl);
        // Keep isPlaying true so the video auto-plays with the new URL
      } else {
        setVideoRefreshFailed(true);
        setIsPlaying(false);
      }
    } catch {
      setVideoRefreshFailed(true);
      setIsPlaying(false);
    } finally {
      setIsRefreshingVideo(false);
    }
  }, [isTikTok, ad.tiktokLibraryUrl]);

  const visibleMetrics = useMemo(
    () => getVisibleMetrics(ad.network, ad.adPosition, ad.adType),
    [ad.network, ad.adPosition, ad.adType],
  );
  const hasEngagement =
    visibleMetrics.like ||
    visibleMetrics.share ||
    visibleMetrics.comment ||
    visibleMetrics.view;

  const starRating = useMemo(
    () => (ad.popularity ? getStarRating(ad.popularity) : 0),
    [ad.popularity],
  );

  const isVideo = adTypeLower === "video";
  const isActive = (ad.status || "").toLowerCase() === "active";

  // Don't render ads whose media never stored. When the source image can't be fetched the
  // backend falls back to a "DefaultImage" placeholder (e.g. .../stream/DefaultImage.jpg);
  // we hide those cards instead of showing an empty/placeholder preview. (Return is after
  // all hooks so the rules of hooks are preserved.)
  if (typeof ad.thumbnail === "string" && ad.thumbnail.includes("DefaultImage")) {
    return null;
  }

  return (
    <div
      className={`notranslate group cursor-pointer flex flex-col rounded-xl border overflow-hidden transition-all duration-200 hover:shadow-xl hover:shadow-black/20 relative`}
      translate="no"
      style={{
        backgroundColor: "var(--color-card)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Platform icon */}
      {PLATFORM_ICONS[platform] && (
        <div className="absolute top-2 right-2 z-10">
          <img
            src={PLATFORM_ICONS[platform]}
            alt={ad.network}
            className="w-5 h-5 object-contain drop-shadow-lg"
          />
        </div>
      )}

      {/* Ad type badge with icon */}
      <div className="absolute top-2 left-2 z-10">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border backdrop-blur-sm ${badge.color}`}
        >
          <TypeIcon size={10} />
          {badge.label}
        </span>
      </div>

      {/* Media section */}
      <div
        className="relative aspect-video overflow-hidden rounded-t-xl"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        {/* TikTok video refresh spinner overlay */}
        {isRefreshingVideo && (
          <div className="absolute inset-0 z-20 bg-black/70 flex flex-col items-center justify-center gap-2">
            <Loader2 size={24} className="text-white animate-spin" />
            <span className="text-[10px] text-white/70 font-medium">Refreshing video…</span>
          </div>
        )}

        {isPlaying && isVideo ? (
          <video
            key={effectiveVideoUrl}
            src={effectiveVideoUrl}
            className="w-full h-full object-cover"
            autoPlay
            controls
            onEnded={() => setIsPlaying(false)}
            onError={handleVideoError}
          />
        ) : (
          <>
            {(ad.previewUnavailable || !ad.thumbnail || imgFailed) ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gray-100 dark:bg-gray-800 text-gray-400 select-none">
                <ImageOff size={26} />
                <span className="text-[11px] font-medium">Preview unavailable</span>
              </div>
            ) : (
              <img
                src={ad.thumbnail}
                alt={ad.title}
                onError={() => setImgFailed(true)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isVideo) onAnalytics?.(ad);
                  else setShowLightbox(true);
                }}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100 cursor-pointer"
              />
            )}
            {isVideo && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center justify-center">
                <button
                  className="w-10 h-10 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20 pointer-events-auto cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsPlaying(true);
                  }}
                >
                  <Play fill="white" size={16} />
                </button>
              </div>
            )}
          </>
        )}

        {/* Aspect ratio pill overlay — bottom-left of image */}
        {ad.aspectRatio && ad.aspectRatio !== "auto" && (
          <div className="absolute bottom-2 left-2 z-10">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/50 text-white/80 backdrop-blur-sm border border-white/10">
              {ad.aspectRatio}
            </span>
          </div>
        )}
      </div>

      {/* Content section */}
      <div className="p-3.5 flex flex-col flex-1">
        {/* Advertiser row with status indicator */}
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-1.5">
            {/* Active/Inactive status dot */}
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]" : "bg-white/20"}`}
              title={isActive ? "Currently Running" : "Inactive"}
            />
            {ad.advertiserImage ? (
              <img
                src={ad.advertiserImage}
                alt={ad.advertiser}
                className="w-5 h-5 rounded-md object-cover"
                style={{ borderColor: "var(--color-border)" }}
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />
            ) : (
              <div
                className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black"
                style={{
                  backgroundColor: "var(--color-surface)",
                  color: "var(--color-accent)",
                  borderColor: "var(--color-border)",
                }}
              >
                {platform === "tiktok" ? (
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3">
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
            <span
              className="text-[10px] font-semibold truncate max-w-[90px] inline-flex items-center gap-0.5"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {ad.advertiser}
              {ad.verified && (
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="10" cy="10" r="10" fill="#5865F2"/>
                  <path d="M5.5 10.5L8.5 13.5L14.5 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {ad.isMetaLib && (
                <img src={metaIcon} alt="meta" className="w-3.5 h-3.5 flex-shrink-0" />
              )}
            </span>
          </div>
          <span
            className="text-[9px] font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            {ad.date}
          </span>
        </div>

        {/* Title */}
        <h3
          className="font-bold text-[12px] line-clamp-2 leading-snug mb-1 transition-colors"
          style={{ color: "var(--color-text)" }}
        >
          {ad.title}
        </h3>

        {/* Subtitle with hover tooltip for truncated text */}
        <div className="relative group/sub mb-2">
          <p
            className="text-[10px] line-clamp-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {ad.subtitle}
          </p>
          {ad.subtitle && ad.subtitle.length > 50 && (
            <div
              className="absolute left-0 top-full mt-1 z-50 px-2.5 py-1.5 rounded-lg text-[10px] leading-relaxed max-w-[240px] opacity-0 group-hover/sub:opacity-100 transition-opacity pointer-events-none shadow-xl"
              style={{
                backgroundColor: "var(--color-card)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
              }}
            >
              {ad.subtitle}
            </div>
          )}
        </div>

        {/* CTA badge */}
        {ad.cta && (
          <div className="flex items-center gap-1.5 mb-2">
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/[0.05] border border-white/10"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <MousePointerClick size={9} className="text-[#6b99ff]" />
              {ad.cta}
            </span>
          </div>
        )}

        {/* Star rating row — separated from engagement for clarity */}
        {(starRating > 0 || ad.runningDays) && (
          <div className="flex items-center justify-between mb-2.5">
            {starRating > 0 ? (
              <div className="flex items-center gap-1.5">
                <StarRating rating={starRating} />
                <span className="text-[9px] font-medium text-white/30">
                  {starRating.toFixed(1)}
                </span>
              </div>
            ) : (
              <div />
            )}
            {ad.runningDays && (
              <div
                className="flex items-center gap-1 text-[9px] font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                <Clock size={9} />
                <span>{ad.runningDays}d</span>
              </div>
            )}
          </div>
        )}

        {/* Engagement stats — platform-aware, only when actual data exists */}
        <div className="mt-auto space-y-2.5">
          {hasEngagement &&
          (ad.likes || ad.views || ad.shares || ad.comments) ? (
            <>
              {/* Engagement data zone with subtle background */}
              <div className="rounded-lg p-2 bg-white/[0.02] border border-white/[0.04]">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex-1 grid gap-1.5`}
                    style={{
                      gridTemplateColumns: `repeat(${[visibleMetrics.like && ad.likes, visibleMetrics.view && ad.views, visibleMetrics.share && ad.shares, visibleMetrics.comment && ad.comments].filter(Boolean).length || 1}, minmax(0, 1fr))`,
                    }}
                  >
                    {visibleMetrics.like && ad.likes && (
                      <StatPill
                        icon={<ThumbsUp size={10} className="text-[#6b99ff]" />}
                        value={ad.likes}
                        tooltip="Likes"
                      />
                    )}
                    {visibleMetrics.view && ad.views && (
                      <StatPill
                        icon={
                          <Eye
                            size={10}
                            style={{ color: "var(--color-text-muted)" }}
                          />
                        }
                        value={ad.views}
                        tooltip="Views"
                      />
                    )}
                    {visibleMetrics.share && ad.shares && (
                      <StatPill
                        icon={<Share2 size={10} className="text-green-500" />}
                        value={ad.shares}
                        tooltip="Shares"
                      />
                    )}
                    {visibleMetrics.comment && ad.comments && (
                      <StatPill
                        icon={
                          <MessageCircle
                            size={10}
                            className="text-yellow-500"
                          />
                        }
                        value={ad.comments}
                        tooltip="Comments"
                      />
                    )}
                  </div>
                  <div className="relative group/fav">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavourite?.(ad);
                      }}
                      className="p-1 rounded transition-colors"
                      style={{
                        color: isFavourite
                          ? undefined
                          : "var(--color-text-muted)",
                      }}
                    >
                      <Heart
                        size={13}
                        className={
                          isFavourite
                            ? "fill-red-500 text-red-500"
                            : "hover:text-red-400"
                        }
                      />
                    </button>
                    <span
                      className="absolute bottom-full right-0 mb-1.5 px-2 py-1 text-[9px] font-medium rounded-md whitespace-nowrap opacity-0 group-hover/fav:opacity-100 transition-opacity pointer-events-none z-50"
                      style={{
                        backgroundColor: "var(--color-surface)",
                        color: "var(--color-text)",
                        borderColor: "var(--color-border)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      {isFavourite
                        ? "Remove from favourites"
                        : "Mark as favourite"}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* No engagement — show keywords (Google) or just the favourite button */
            <div className="flex items-center gap-1.5">
              <div className="flex-1 flex items-center gap-1.5">
                {ad.keywords ? (
                  <div className="flex flex-wrap gap-1">
                    {ad.keywords
                      .split(",")
                      .slice(0, 3)
                      .map((kw, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/[0.04] border border-white/5 text-white/50 truncate max-w-[80px]"
                        >
                          {kw.trim()}
                        </span>
                      ))}
                  </div>
                ) : (
                  <div className="flex-1 border-t border-dashed border-white/[0.06]" />
                )}
              </div>
              <div className="relative group/fav">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavourite?.(ad);
                  }}
                  className="p-1 rounded transition-colors"
                  style={{
                    color: isFavourite ? undefined : "var(--color-text-muted)",
                  }}
                >
                  <Heart
                    size={13}
                    className={
                      isFavourite
                        ? "fill-red-500 text-red-500"
                        : "hover:text-red-400"
                    }
                  />
                </button>
                <span
                  className="absolute bottom-full right-0 mb-1.5 px-2 py-1 text-[9px] font-medium rounded-md whitespace-nowrap opacity-0 group-hover/fav:opacity-100 transition-opacity pointer-events-none z-50"
                  style={{
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text)",
                    borderColor: "var(--color-border)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {isFavourite ? "Remove from favourites" : "Mark as favourite"}
                </span>
              </div>
            </div>
          )}

          {/* Engagement rate pill — only if engagement exists */}
          {hasEngagement && ad.engRate && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/[0.03] border border-white/5">
                <TrendingUp
                  size={9}
                  className={
                    Number(parseFloat(ad.engRate)) >= 5
                      ? "text-emerald-400"
                      : Number(parseFloat(ad.engRate)) >= 2
                        ? "text-[#6b99ff]"
                        : "text-slate-400"
                  }
                />
                <span
                  className={`text-[9px] font-bold ${Number(parseFloat(ad.engRate)) >= 5 ? "text-emerald-400" : Number(parseFloat(ad.engRate)) >= 2 ? "text-[#6b99ff]" : "text-slate-400"}`}
                >
                  {ad.engRate}
                </span>
              </div>
              {ad.engPerDay != null && (
                <span className="text-[9px] text-white/25 font-medium">
                  {ad.engPerDay}/day
                </span>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalytics?.(ad);
              }}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors"
              style={{
                backgroundColor: "var(--color-surface)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
              }}
            >
              Analytics
            </button>
            {ad.adPosition?.toLowerCase() !== "side" &&
              ad.adPosition?.toLowerCase() !== "marketplace" && (
                <div className="relative group/tip">
                  <a
                    href={ad.adUrl || ad.metaAdUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = ad.adUrl || ad.metaAdUrl;
                      if (!url) e.preventDefault();
                    }}
                    className="px-2.5 py-1.5 rounded-lg transition-colors flex items-center h-full"
                    style={{
                      backgroundColor: "var(--color-surface)",
                      color: "var(--color-text-secondary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <ExternalLink size={11} />
                  </a>
                  <span
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[9px] font-medium rounded-md whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none"
                    style={{
                      backgroundColor: "var(--color-surface)",
                      color: "var(--color-text)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    Show Original
                  </span>
                </div>
              )}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="px-1.5 py-1.5 rounded-lg transition-colors flex items-center h-full"
                style={{
                  backgroundColor: "var(--color-surface)",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <MoreVertical size={13} />
              </button>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                    }}
                  />
                  <div
                    className="absolute bottom-full right-0 mb-1.5 rounded-lg shadow-2xl z-50 py-1 min-w-[160px]"
                    style={{
                      backgroundColor: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onHideAd?.(ad);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:opacity-80 transition-colors"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <EyeOff size={12} />
                      Hide this ad
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onHideAdvertiser?.(ad);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-red-400 hover:opacity-80 transition-colors"
                    >
                      <UserX size={12} />
                      Hide advertiser
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const shareUrl = import.meta.env.VITE_SHARE_URL || "";
                        const networkRoute = (
                          ad.network || "facebook"
                        ).toLowerCase();
                        const adId = ad.adId || ad.id || "";
                        const url = `${shareUrl}/${networkRoute}/landing/ad_id/${adId}`;
                        navigator.clipboard.writeText(url);
                        setCopied(true);
                        setShowMenu(false);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:opacity-80 transition-colors"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <Link size={12} />
                      Copy ad link
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Copied toast */}
      {copied && (
        <div
          className="fixed top-5 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold rounded-xl shadow-2xl border border-green-500/30"
          style={{
            backgroundColor: "var(--color-card)",
            color: "var(--color-text)",
          }}
        >
          <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-white">
            <Check size={12} strokeWidth={3} />
          </div>
          Link copied to clipboard!
        </div>
      )}

      {/* Lightbox */}
      {showLightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setShowLightbox(false)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const img = new window.Image();
                  img.crossOrigin = "anonymous";
                  img.src = ad.thumbnail || "";
                  await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                  });
                  const canvas = document.createElement("canvas");
                  canvas.width = img.naturalWidth;
                  canvas.height = img.naturalHeight;
                  canvas.getContext("2d").drawImage(img, 0, 0);
                  const blob = await new Promise((resolve) =>
                    canvas.toBlob(resolve, "image/png"),
                  );
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `${(ad.title || "ad").replace(/[^a-zA-Z0-9]/g, "_")}.jpg`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                } catch {
                  window.open(ad.thumbnail || "", "_blank");
                }
              }}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
            >
              <Download size={20} />
            </button>
            <button
              onClick={() => setShowLightbox(false)}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          <img
            src={ad.thumbnail || ""}
            alt={ad.title}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default AdCard;

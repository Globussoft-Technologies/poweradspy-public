import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  ThumbsUp,
  Eye,
  Share2,
  MessageCircle,
  ExternalLink,
  Clock,
  AlertTriangle,
  Loader2,
  LogIn,
  Star,
  StarHalf,
  Film,
  Layers,
  Image,
  Monitor,
  Search,
  Type,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Tag,
  Globe,
  MousePointerClick,
} from "lucide-react";
import StatPill from "../shared/StatPill";
import { AD_TYPE_BADGES, getStarRating } from "../../constants";
import { fetchSharedAd } from "../../services/api";
import powerAdSpyLogo from "../../assets/poweradspy-logo.webp";

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

const BRAND_COLOR = "rgb(51, 82, 150)";

const StarRating = ({ rating }) => {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (rating >= i)
      stars.push(
        <Star key={i} size={14} className="fill-amber-400 text-amber-400" />,
      );
    else if (rating >= i - 0.5)
      stars.push(
        <StarHalf key={i} size={14} className="fill-amber-400 text-amber-400" />,
      );
    else
      stars.push(<Star key={i} size={14} className="text-gray-600" />);
  }
  return <div className="flex items-center gap-0.5">{stars}</div>;
};

const formatPosition = (pos) => {
  if (!pos) return "";
  return pos
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * SharedAdView — Public page that renders a single shared ad.
 * Accessible to anyone with the share token, no login required.
 */
const SharedAdView = ({ shareToken }) => {
  const [ad, setAd] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Video URL with NAS→CDN fallback, mirroring MasonryCard/AdDetailModal. The
  // mapped `ad.videoUrl` is NAS-first; on a 410/expiry we switch to the live
  // CDN URL (`ad.videoUrlFallback`) once, then give up and mark the video
  // unavailable so we don't loop on a dead source.
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState(null);
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const videoFallbackAttempted = useRef(false);

  // Reset video fallback state whenever the underlying ad changes.
  useEffect(() => {
    setResolvedVideoUrl(null);
    setVideoUnavailable(false);
    videoFallbackAttempted.current = false;
  }, [ad?.videoUrl]);

  const handleVideoError = () => {
    if (!videoFallbackAttempted.current && ad?.videoUrlFallback && ad.videoUrlFallback !== (resolvedVideoUrl || ad.videoUrl)) {
      // NAS copy 410'd/expired — switch to the live CDN URL.
      videoFallbackAttempted.current = true;
      setResolvedVideoUrl(ad.videoUrlFallback);
      return;
    }
    // Fallback also failed (or none available) — stop and show the unavailable state.
    setIsPlaying(false);
    setVideoUnavailable(true);
  };

  const AMEMBER_LOGIN_URL =
    import.meta.env.VITE_AMEMBER_LOGIN_URL ||
    "https://app-dev.poweradspy.com/amember/member";

  useEffect(() => {
    const loadSharedAd = async () => {
      setLoading(true);
      setError(null);
      setExpired(false);
      try {
        const result = await fetchSharedAd(shareToken);
        if (result.expired) {
          setExpired(true);
          return;
        }
        setAd(result.ad);
      } catch (err) {
        if (err.status === 410 || err.expired) {
          setExpired(true);
        } else {
          setError(err.message || "Failed to load shared ad");
        }
      } finally {
        setLoading(false);
      }
    };
    if (shareToken) loadSharedAd();
  }, [shareToken]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin mx-auto mb-4" style={{ color: BRAND_COLOR }} />
          <p className="text-gray-400 text-sm font-medium">Loading shared ad...</p>
        </div>
      </div>
    );
  }

  // Expired state
  if (expired) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Clock size={28} className="text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Link Expired</h1>
          <p className="text-gray-400 text-sm leading-relaxed mb-6">
            This shared ad link has expired and is no longer accessible.
            Please ask the person who shared it to generate a new link.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl transition-colors hover:opacity-90"
            style={{ backgroundColor: BRAND_COLOR }}
          >
            Go to PowerAdSpy
          </a>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !ad) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Link Not Found</h1>
          <p className="text-gray-400 text-sm leading-relaxed mb-6">
            {error || "This shared ad link is invalid or has been removed."}
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl transition-colors hover:opacity-90"
            style={{ backgroundColor: BRAND_COLOR }}
          >
            Go to PowerAdSpy
          </a>
        </div>
      </div>
    );
  }

  const platform = (ad.network || "").toLowerCase();
  const platformDisplayName = PLATFORM_NAMES[platform] || ad.network || "";
  const adTypeLower = (ad.adType || "image").toLowerCase();
  const badge = AD_TYPE_BADGES[adTypeLower] || AD_TYPE_BADGES.image;
  const TypeIcon = AD_TYPE_ICONS[adTypeLower] || Image;
  const isVideo = adTypeLower === "video";
  const effectiveVideoUrl = resolvedVideoUrl || ad.videoUrl;
  const isActive = (ad.status || "").toLowerCase() === "active";
  const starRating = ad.popularity ? getStarRating(ad.popularity) : 0;
  const hasCarousel = ad.carouselMedia?.length > 1;
  const currentImg = hasCarousel
    ? ad.carouselMedia[activeIndex]
    : ad.thumbnail || "";
  const rawTitleStr =
    (ad.carouselTitles?.length > activeIndex
      ? ad.carouselTitles[activeIndex]
      : ad.title) || "";
  const currentTitle = rawTitleStr.replace(/^,|,$/g, "").trim();

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Top bar — matches main app Header styling */}
      <header className="h-16 2xl:h-20 py-2 px-3 sm:px-5 flex items-center justify-between sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-white/[0.06]">
        <a href="/">
          <img
            src={powerAdSpyLogo}
            alt="PowerAdSpy"
            className="h-8 sm:h-9 2xl:h-12"
          />
        </a>
        {(() => {
          const storedToken = localStorage.getItem('authToken');
          const envToken = import.meta.env.VITE_PAS_API_TOKEN;
          const isLoggedIn = !!storedToken && storedToken !== envToken;
          return isLoggedIn ? (
            <a
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-white text-[13px] font-semibold rounded-lg transition-colors hover:opacity-90"
              style={{ backgroundColor: BRAND_COLOR }}
            >
              Go to Dashboard
            </a>
          ) : (
            <a
              href={AMEMBER_LOGIN_URL}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-white text-[13px] font-semibold rounded-lg transition-colors hover:opacity-90"
              style={{ backgroundColor: BRAND_COLOR }}
            >
              <LogIn size={14} />
              Login
            </a>
          );
        })()}
      </header>

      {/* Ad Content */}
      <main className="flex-1 flex items-start justify-center py-8 px-4">
        <div className="w-full max-w-3xl">
          {/* Card */}
          <div className="bg-[#111] rounded-2xl border border-white/[0.06] overflow-hidden shadow-2xl">
            {/* Advertiser header */}
            <div className="px-5 pt-5 pb-3 flex items-center gap-3">
              <div className="relative">
                {ad.advertiserImage ? (
                  <img
                    src={ad.advertiserImage}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover border border-white/10"
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ background: `linear-gradient(135deg, ${BRAND_COLOR}, #6366f1)` }}
                  >
                    {(ad.advertiser || "?")[0]?.toUpperCase()}
                  </div>
                )}
                {PLATFORM_ICONS[platform] && (
                  <img
                    src={PLATFORM_ICONS[platform]}
                    alt={platform}
                    className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border border-[#111]"
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white truncate">
                    {ad.advertiser || "Unknown"}
                  </span>
                  {isActive && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-green-500/10 text-green-400 border border-green-500/20 rounded-md">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-gray-500">
                    {platformDisplayName}
                  </span>
                  {ad.date && (
                    <span className="text-[11px] text-gray-600">{ad.date}</span>
                  )}
                </div>
              </div>
              {starRating > 0 && <StarRating rating={starRating} />}
            </div>

            {/* Ad title & text */}
            {currentTitle && (
              <div className="px-5 pb-2">
                <h2 className="text-sm font-semibold text-white leading-snug">
                  {currentTitle}
                </h2>
              </div>
            )}
            {ad.subtitle && (
              <div className="px-5 pb-3">
                <p className="text-xs text-gray-400 leading-relaxed line-clamp-4">
                  {ad.subtitle}
                </p>
              </div>
            )}

            {/* Media */}
            <div className="relative bg-black/30">
              {isVideo && effectiveVideoUrl && !videoUnavailable ? (
                <div className="relative">
                  {isPlaying ? (
                    <video
                      key={effectiveVideoUrl}
                      src={effectiveVideoUrl}
                      controls
                      autoPlay
                      className="w-full max-h-[500px] object-contain"
                      onError={handleVideoError}
                    />
                  ) : (
                    <div
                      className="relative cursor-pointer group"
                      onClick={() => setIsPlaying(true)}
                    >
                      <img
                        src={currentImg}
                        alt=""
                        className="w-full max-h-[500px] object-contain"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                        <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Play size={22} className="text-white ml-1" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <img
                    src={currentImg}
                    alt=""
                    className="w-full max-h-[500px] object-contain"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                  {/* Both NAS and CDN sources failed — surface the dead-video state
                      over the thumbnail (matches the grid/detail "unavailable" UX). */}
                  {videoUnavailable && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 pointer-events-none">
                      <Film size={28} className="text-zinc-300" strokeWidth={1.5} />
                      <span className="text-[11px] font-medium text-zinc-200 tracking-wide">
                        Video unavailable
                      </span>
                    </div>
                  )}
                  {/* Carousel navigation */}
                  {hasCarousel && (
                    <>
                      {activeIndex > 0 && (
                        <button
                          onClick={() => setActiveIndex((i) => i - 1)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                        >
                          <ChevronLeft size={16} />
                        </button>
                      )}
                      {activeIndex < ad.carouselMedia.length - 1 && (
                        <button
                          onClick={() => setActiveIndex((i) => i + 1)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                        >
                          <ChevronRight size={16} />
                        </button>
                      )}
                      {/* Dots */}
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1 bg-black/50 backdrop-blur-sm rounded-full">
                        {ad.carouselMedia.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={() => setActiveIndex(idx)}
                            className={`w-1.5 h-1.5 rounded-full transition-all ${
                              idx === activeIndex
                                ? "bg-white w-3"
                                : "bg-white/40"
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Ad type badge */}
              <div
                className="absolute top-3 left-3 px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1"
                style={{
                  backgroundColor: badge.bg,
                  color: badge.text,
                }}
              >
                <TypeIcon size={10} />
                {adTypeLower.charAt(0).toUpperCase() + adTypeLower.slice(1)}
              </div>
            </div>

            {/* Stats row */}
            <div className="px-5 py-3 flex flex-wrap gap-2 border-t border-white/[0.06]">
              <StatPill icon={<ThumbsUp size={12} className="text-[#6b99ff]" />} value={ad.likes || "0"} tooltip="Likes" />
              <StatPill icon={<Share2 size={12} className="text-[#6b99ff]" />} value={ad.shares || "0"} tooltip="Shares" />
              <StatPill icon={<MessageCircle size={12} className="text-[#6b99ff]" />} value={ad.comments || "0"} tooltip="Comments" />
              <StatPill icon={<Eye size={12} className="text-gray-500" />} value={ad.impressions || "0"} tooltip="Impressions" />
              {ad.popularity != null && (
                <StatPill icon={<TrendingUp size={12} className="text-green-400" />} value={ad.popularity} tooltip="Popularity" />
              )}
            </div>

            {/* CTA & destination */}
            {ad.cta && (
              <div className="px-5 pb-3 flex items-center gap-2">
                <span className="px-3 py-1.5 text-[11px] font-bold rounded-lg border flex items-center gap-1" style={{ backgroundColor: 'rgba(51,82,150,0.15)', color: BRAND_COLOR, borderColor: 'rgba(51,82,150,0.2)' }}>
                  <MousePointerClick size={11} />
                  {ad.cta}
                </span>
                {ad.destinationUrl && (
                  <a
                    href={ad.destinationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-gray-500 hover:opacity-80 transition-colors truncate max-w-[300px]"
                    style={{ color: 'inherit' }}
                    onMouseEnter={(e) => e.target.style.color = BRAND_COLOR}
                    onMouseLeave={(e) => e.target.style.color = ''}
                  >
                    {ad.destinationUrl}
                  </a>
                )}
              </div>
            )}

            {/* Meta details */}
            <div className="px-5 py-3 border-t border-white/[0.06] grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ad.adPosition && (
                <div>
                  <span className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
                    Position
                  </span>
                  <p className="text-[11px] text-gray-300 font-medium mt-0.5">
                    {formatPosition(ad.adPosition)}
                  </p>
                </div>
              )}
              {ad.runningDays != null && (
                <div>
                  <span className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
                    Running
                  </span>
                  <p className="text-[11px] text-gray-300 font-medium mt-0.5 flex items-center gap-1">
                    <TrendingUp size={10} className="text-green-400" />
                    {ad.runningDays} days
                  </p>
                </div>
              )}
              {ad.firstSeen && (
                <div>
                  <span className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
                    First Seen
                  </span>
                  <p className="text-[11px] text-gray-300 font-medium mt-0.5 flex items-center gap-1">
                    <Calendar size={10} />
                    {ad.firstSeen}
                  </p>
                </div>
              )}
              {ad.lastSeen && (
                <div>
                  <span className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
                    Last Seen
                  </span>
                  <p className="text-[11px] text-gray-300 font-medium mt-0.5 flex items-center gap-1">
                    <Calendar size={10} />
                    {ad.lastSeen}
                  </p>
                </div>
              )}
              {ad.adLanguage && (
                <div>
                  <span className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
                    Language
                  </span>
                  <p className="text-[11px] text-gray-300 font-medium mt-0.5 flex items-center gap-1">
                    <Globe size={10} />
                    {ad.adLanguage}
                  </p>
                </div>
              )}
              {ad.engRate && (
                <div>
                  <span className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
                    Eng. Rate
                  </span>
                  <p className="text-[11px] text-gray-300 font-medium mt-0.5">
                    {ad.engRate}
                  </p>
                </div>
              )}
            </div>

            {/* Keywords */}
            {ad.keywords && (
              <div className="px-5 py-3 border-t border-white/[0.06]">
                <div className="flex items-center gap-1 mb-2">
                  <Tag size={10} className="text-gray-500" />
                  <span className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
                    Keywords
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ad.keywords.split(",").map((kw, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-md text-[10px] text-gray-400 font-medium"
                    >
                      {kw.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            {ad.adUrl && ad.adUrl !== "#" && (
              <div className="px-5 py-3 border-t border-white/[0.06]">
                <a
                  href={ad.adUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-[11px] font-semibold rounded-lg transition-colors"
                >
                  <ExternalLink size={11} />
                  View Original Ad
                </a>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-white/5 py-4">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-center">
          <span className="text-[11px] text-white">
            Powered by{" "}
            <a
              href="https://poweradspy.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity font-semibold"
              style={{ color: BRAND_COLOR }}
            >
              PowerAdSpy
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
};

export default SharedAdView;

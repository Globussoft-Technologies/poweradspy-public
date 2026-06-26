import React, { useState, useRef, useEffect } from "react";
import {
  ThumbsUp,
  MessageCircle,
  Share2,
  Send,
  Bookmark,
  Heart,
  MoreHorizontal,
  Play,
  ArrowUp,
  ArrowDown,
  Repeat2,
  Music,
  Eye,
} from "lucide-react";

import fbIcon from "../../assets/fb.png";
import igIcon from "../../assets/ig.png";
import ytIcon from "../../assets/yt.png";
import gIcon from "../../assets/g.png";
import linkedinIcon from "../../assets/linkedin.png";
import rdIcon from "../../assets/rd.png";
import pinterestIcon from "../../assets/pinterest.png";

/**
 * OriginalPreview — Renders an ad as it would appear natively on its platform.
 * Uses flexbox column layout: header → content (flex-grow) → footer (mt-auto).
 * When fillWidth=true, cards stretch to fill their masonry cell with no max-width.
 */
const OriginalPreview = ({ ad, fillWidth = false }) => {
  const platform = (ad.network || "").toLowerCase();
  const position = (ad.adPosition || "").toLowerCase();
  const adType = (ad.adType || "image").toLowerCase();

  if (platform === "facebook")
    return (
      <FacebookPreview
        ad={ad}
        position={position}
        adType={adType}
        fill={fillWidth}
      />
    );
  if (platform === "instagram")
    return (
      <InstagramPreview
        ad={ad}
        position={position}
        adType={adType}
        fill={fillWidth}
      />
    );
  if (platform === "youtube")
    return (
      <YouTubePreview
        ad={ad}
        position={position}
        adType={adType}
        fill={fillWidth}
      />
    );
  if (platform === "google" || platform === "gdn")
    return (
      <GooglePreview
        platform={platform}
        ad={ad}
        position={position}
        adType={adType}
        fill={fillWidth}
      />
    );
  if (platform === "linkedin")
    return (
      <LinkedInPreview
        ad={ad}
        position={position}
        adType={adType}
        fill={fillWidth}
      />
    );
  if (platform === "reddit") return <RedditPreview ad={ad} fill={fillWidth} />;
  if (platform === "pinterest")
    return <PinterestPreview ad={ad} fill={fillWidth} />;
  if (platform === "tiktok") return <TikTokPreview ad={ad} fill={fillWidth} />;
  return (
    <FacebookPreview
      ad={ad}
      position={position}
      adType={adType}
      fill={fillWidth}
    />
  );
};

// Helper — card shell with flex column structure
const CardShell = ({
  fill,
  children,
  className = "",
  rounded = "rounded-lg",
}) => (
  <div
    className={`bg-white ${rounded} shadow-sm border border-gray-200 overflow-hidden flex flex-col ${fill ? "w-full h-full" : "max-w-full mx-auto"} ${className}`}
  >
    {children}
  </div>
);

// ─── Facebook ────────────────────────────────────────────────────────────────
const FacebookPreview = ({ ad, position, adType, fill }) => {
  if (position.includes("side")) {
    return (
      <div
        className={`bg-white rounded-lg p-3 shadow-sm border border-gray-200 flex items-center ${fill ? "w-full h-full" : "max-w-[260px] mx-auto"}`}
      >
        <div className="flex gap-2 w-full">
          <img
            src={ad.thumbnail}
            alt=""
            className="w-16 h-16 object-cover rounded flex-shrink-0"
            onError={(e) => (e.target.style.display = "none")}
          />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-gray-900 line-clamp-2 leading-tight">
              {ad.title}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5 truncate">
              {ad.destinationUrl || ad.subtitle}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CardShell fill={fill}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 flex-shrink-0">
        {ad.advertiserImage ? (
          <img
            src={ad.advertiserImage}
            alt=""
            className="w-10 h-10 rounded-full object-cover border border-gray-200"
            onError={(e) => (e.target.style.display = "none")}
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
            {(ad.advertiser || "?")[0]}
          </div>
        )}
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-gray-900">
            {ad.advertiser}
          </p>
          <p className="text-[11px] text-gray-500">
            Sponsored · <img src={fbIcon} alt="" className="w-3 h-3 inline" />
          </p>
        </div>
        <MoreHorizontal size={18} className="text-gray-400" />
      </div>

      {/* Body text */}
      <p className="px-3 mb-3 text-[13px] text-gray-800 leading-snug line-clamp-3 flex-shrink-0">
        {ad.subtitle || ad.title}
      </p>

      {/* Media — grows to fill available space */}
      <div className="relative bg-gray-100 flex-1 min-h-0">
        <img
          src={ad.thumbnail}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => (e.target.style.display = "none")}
        />
        {adType === "video" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 bg-black/50 rounded-full flex items-center justify-center">
              <Play fill="white" size={24} className="ml-1" />
            </div>
          </div>
        )}
      </div>

      {/* Footer — anchored to bottom via mt-auto */}
      <div className="flex-shrink-0 mt-auto">
        {/* Link preview */}
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
          <p className="text-[10px] text-gray-500 uppercase">
            {ad.destinationUrl || "example.com"}
          </p>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-gray-900 line-clamp-1 flex-1">
              {ad.title}
            </p>
            {ad.cta && (
              <button className="ml-2 px-4 py-1.5 bg-gray-200 text-[12px] font-semibold text-gray-800 rounded hover:bg-gray-300 flex-shrink-0">
                {ad.cta}
              </button>
            )}
          </div>
        </div>
        {/* Engagement counts */}
        <div className="px-3 py-1.5 flex items-center justify-between text-[11px] text-gray-500 border-t border-gray-200">
          <span>{ad.likes || "0"} Likes</span>
          <span>
            {ad.comments || "0"} Comments · {ad.shares || "0"} Shares
          </span>
        </div>
        {/* Action bar */}
        <div className="flex border-t border-gray-200">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
            <ThumbsUp size={16} /> Like
          </button>
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
            <MessageCircle size={16} /> Comment
          </button>
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
            <Share2 size={16} /> Share
          </button>
        </div>
      </div>
    </CardShell>
  );
};

// ─── Instagram ───────────────────────────────────────────────────────────────
const InstagramPreview = ({ ad, position, adType, fill }) => {
  if (
    position.includes("stories") ||
    position.includes("story") ||
    position.includes("reel")
  ) {
    return (
      <div
        className={`relative bg-black rounded-2xl overflow-hidden ${fill ? "w-full h-full" : "max-w-[280px] mx-auto"}`}
        style={fill ? {} : { aspectRatio: "9/16" }}
      >
        <img
          src={ad.thumbnail}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex items-center gap-2">
            {ad.advertiserImage ? (
              <img
                src={ad.advertiserImage}
                alt=""
                className="w-8 h-8 rounded-full border-2 border-white object-cover"
                onError={(e) => (e.target.style.display = "none")}
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold border-2 border-white">
                {(ad.advertiser || "?")[0]}
              </div>
            )}
            <span className="text-white text-[12px] font-semibold">
              {ad.advertiser}
            </span>
            <span className="text-white/60 text-[10px]">Sponsored</span>
          </div>
        </div>
        {ad.cta && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
            <button className="w-full py-2 rounded-full bg-white text-black text-[13px] font-semibold">
              {ad.cta}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <CardShell fill={fill}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 flex-shrink-0">
        <div className="p-[2px] rounded-full bg-gradient-to-br from-yellow-400 via-pink-500 to-purple-600">
          {ad.advertiserImage ? (
            <img
              src={ad.advertiserImage}
              alt=""
              className="w-8 h-8 rounded-full object-cover border-2 border-white"
              onError={(e) => (e.target.style.display = "none")}
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 border-2 border-white">
              {(ad.advertiser || "?")[0]}
            </div>
          )}
        </div>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-gray-900">
            {ad.advertiser}
          </p>
          <p className="text-[10px] text-gray-400">Sponsored</p>
        </div>
        <MoreHorizontal size={18} className="text-gray-900" />
      </div>

      {/* Media — grows */}
      <div className="relative bg-black flex-1 min-h-0">
        <img
          src={ad.thumbnail}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => (e.target.style.display = "none")}
        />
        {adType === "video" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 bg-black/40 rounded-full flex items-center justify-center">
              <Play fill="white" size={24} className="ml-1" />
            </div>
          </div>
        )}
      </div>

      {/* Footer — anchored */}
      <div className="flex-shrink-0 mt-auto">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-4">
            <Heart size={22} className="text-gray-900" />
            <MessageCircle size={22} className="text-gray-900" />
            <Send size={22} className="text-gray-900" />
          </div>
          <Bookmark size={22} className="text-gray-900" />
        </div>
        <div className="px-3 pb-3">
          <p className="text-[13px] font-semibold text-gray-900 mb-1">
            {ad.likes || "0"} likes
          </p>
          <p className="text-[13px] text-gray-800 line-clamp-2">
            <span className="font-semibold">{ad.advertiser}</span>{" "}
            {ad.subtitle || ad.title}
          </p>
          {ad.cta && (
            <button className="mt-2 text-[13px] font-semibold text-blue-500">
              {ad.cta}
            </button>
          )}
        </div>
      </div>
    </CardShell>
  );
};

// ─── YouTube ─────────────────────────────────────────────────────────────────
const YouTubePreview = ({ ad, position, adType, fill }) => {
  if (
    position.includes("banner") ||
    position.includes("display") ||
    adType === "banner" ||
    adType === "display"
  ) {
    return (
      <CardShell fill={fill}>
        <div className="relative flex-1 min-h-0">
          <img
            src={ad.thumbnail}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => (e.target.style.display = "none")}
          />
          <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-yellow-400 text-[10px] font-bold text-black rounded">
            Ad
          </span>
        </div>
        {ad.cta && (
          <div className="p-3 flex-shrink-0 mt-auto">
            <button className="w-full py-2 bg-blue-600 text-white text-[13px] font-semibold rounded hover:bg-blue-700">
              {ad.cta}
            </button>
          </div>
        )}
      </CardShell>
    );
  }

  return (
    <CardShell fill={fill}>
      {/* Video thumbnail — grows */}
      <div className="relative bg-black flex-1 min-h-0">
        <img
          src={ad.thumbnail}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
            <Play fill="white" size={28} className="ml-1" />
          </div>
        </div>
        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-yellow-400 text-[10px] font-bold text-black rounded">
          Ad
        </span>
        {ad.cta && (
          <div className="absolute bottom-2 right-2">
            <button className="px-3 py-1 bg-blue-600 text-white text-[11px] font-semibold rounded-sm hover:bg-blue-700">
              {ad.cta}
            </button>
          </div>
        )}
      </div>
      {/* Info — footer */}
      <div className="flex gap-2.5 p-3 flex-shrink-0 mt-auto">
        {ad.advertiserImage ? (
          <img
            src={ad.advertiserImage}
            alt=""
            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
            onError={(e) => (e.target.style.display = "none")}
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-sm font-bold text-red-600 flex-shrink-0">
            {(ad.advertiser || "?")[0]}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-medium text-gray-900 line-clamp-2 leading-snug">
            {ad.title}
          </p>
          <p className="text-[12px] text-gray-500 mt-0.5">{ad.advertiser}</p>
          <p className="text-[12px] text-gray-500">{ad.views || "0"} views</p>
        </div>
      </div>
    </CardShell>
  );
};

// ─── Google ──────────────────────────────────────────────────────────────────
const GooglePreview = ({ platform, ad, position, adType, fill }) => {
  if (
    adType === "display" ||
    adType === "banner" ||
    position.includes("display") ||
    position.includes("banner") ||
    platform === "gdn"
  ) {
    return (
      <CardShell fill={fill}>
        <div className="relative flex-1 min-h-0">
          <img
            src={ad.thumbnail}
            alt=""
            className="w-full h-full object-cover rounded-tr-xl rounded-tl-xl"
            onError={(e) => (e.target.style.display = "none")}
          />
          <div className="absolute top-2 right-2">
            <span className="px-1 py-0.5 bg-white/90 text-[9px] font-bold text-gray-500 rounded border border-gray-300">
              Ad
            </span>
          </div>
        </div>
        <div className="p-3 flex items-center justify-between flex-shrink-0 mt-auto">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-gray-900 line-clamp-1">
              {ad.title}
            </p>
            <p className="text-[11px] text-gray-500">{ad.advertiser}</p>
          </div>
          {ad.cta && (
            <button className="ml-2 px-3 py-1.5 bg-blue-600 text-white text-[11px] font-semibold rounded hover:bg-blue-700 flex-shrink-0">
              {ad.cta}
            </button>
          )}
        </div>
      </CardShell>
    );
  }

  // Google Search Ad — no media, so content fills
  return <GoogleSearchAd ad={ad} fill={fill} />;
};

/**
 * GoogleSearchAd — SERP-style text ad. The description is clamped to two lines
 * by default; a Read More affordance is shown only when that clamp actually
 * hides text (measured via scrollHeight vs clientHeight). On both surfaces —
 * the modal Original Preview (fill=false) and the grid "Show Original" preview
 * (fill=true) — the toggle expands the copy in place. Google search ad copy is
 * short (bounded description length), so the full text fits within the card's
 * existing height; no need to grow the masonry cell or defer to the modal.
 */
const GoogleSearchAd = ({ ad, fill }) => {
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const textRef = useRef(null);
  const description = ad.subtitle || ad.title || "";

  // Show the toggle only when the 2-line clamp is genuinely hiding text.
  // Skipped while expanded so toggling open doesn't make the button vanish.
  useEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const measure = () => setIsClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [description, expanded]);

  return (
    <div
      className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col p-4 ${fill ? "w-full h-full" : "max-w-[400px] mx-auto"}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
          <img src={gIcon} alt="" className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[12px] text-gray-900 font-medium">
            {ad.advertiser}
          </p>
          <p className="text-[11px] text-gray-500 truncate">
            {ad.destinationUrl || "www.example.com"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="px-1.5 py-0.5 text-[10px] font-bold text-gray-600 bg-gray-100 rounded border border-gray-300">
          Sponsored
        </span>
      </div>
      <h3 className="text-[16px] text-blue-700 font-medium leading-snug mb-1 hover:underline cursor-pointer">
        {ad.title}
      </h3>
      {/* No flex-1 here: under flex layout it would stretch the box and break
          the scrollHeight/clientHeight clamp detection. `mt-auto` on the
          keywords row keeps them pinned to the bottom of the card. */}
      <p
        ref={textRef}
        className={`text-[13px] text-gray-600 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}
      >
        {description}
      </p>
      {(isClamped || expanded) && (
        <button
          type="button"
          onClick={(e) => {
            // Expand in place on both surfaces. stopPropagation keeps the grid
            // preview's card-level onClick (which opens the detail modal) from
            // also firing — the copy is short enough to fit the existing card.
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="self-start mt-1 text-[12px] font-semibold text-blue-700 hover:underline focus:outline-none"
        >
          {expanded ? "Show Less" : "Read More"}
        </button>
      )}
      {ad.keywords && (
        <div className="flex flex-wrap gap-1.5 mt-auto pt-2.5">
          {ad.keywords
            .split(",")
            .slice(0, 4)
            .map((kw, i) => (
              <span
                key={i}
                className="px-2 py-1 text-[11px] text-blue-700 bg-blue-50 rounded-full border border-blue-100 hover:bg-blue-100 cursor-pointer"
              >
                {kw.trim()}
              </span>
            ))}
        </div>
      )}
    </div>
  );
};

// ─── LinkedIn ────────────────────────────────────────────────────────────────
const LinkedInPreview = ({ ad, position, adType, fill }) => {
  return (
    <CardShell fill={fill}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 flex-shrink-0">
        {ad.advertiserImage ? (
          <img
            src={ad.advertiserImage}
            alt=""
            className="w-12 h-12 rounded object-cover flex-shrink-0"
            onError={(e) => (e.target.style.display = "none")}
          />
        ) : (
          <div className="w-12 h-12 rounded bg-blue-600 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
            {(ad.advertiser || "?")[0]}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-gray-900">
            {ad.advertiser}
          </p>
          <p className="text-[11px] text-gray-500 truncate">
            {ad.subtitle ? ad.subtitle.substring(0, 40) : "Company"}
          </p>
          <p className="text-[11px] text-gray-400">Promoted</p>
        </div>
        <MoreHorizontal size={18} className="text-gray-400 flex-shrink-0" />
      </div>

      {/* Body */}
      <p className="px-3 pb-2 text-[13px] text-gray-700 line-clamp-3 leading-relaxed flex-shrink-0">
        {ad.subtitle || ad.title}
      </p>

      {/* Media — grows */}
      <div className="relative bg-gray-100 flex-1 min-h-0">
        <img
          src={ad.thumbnail}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => (e.target.style.display = "none")}
        />
        {adType === "video" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center">
              <Play fill="white" size={24} className="ml-1" />
            </div>
          </div>
        )}
      </div>

      {/* Footer — anchored */}
      <div className="flex-shrink-0 mt-auto">
        <div className="px-3 py-2 bg-gray-50 border-t border-b border-gray-200">
          <p className="text-[13px] font-medium text-gray-900 line-clamp-1">
            {ad.title}
          </p>
          <p className="text-[11px] text-gray-500">
            {ad.destinationUrl || "example.com"}
          </p>
        </div>
        {ad.cta && (
          <div className="px-3 py-2">
            <button className="w-full py-1.5 border-2 border-blue-600 text-blue-600 text-[13px] font-semibold rounded-full hover:bg-blue-50">
              {ad.cta}
            </button>
          </div>
        )}
        <div className="flex border-t border-gray-200 px-2">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">
            <ThumbsUp size={16} /> Like
          </button>
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">
            <MessageCircle size={16} /> Comment
          </button>
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">
            <Repeat2 size={16} /> Repost
          </button>
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-gray-500 hover:bg-gray-50">
            <Send size={16} /> Send
          </button>
        </div>
      </div>
    </CardShell>
  );
};

// ─── Reddit ──────────────────────────────────────────────────────────────────
const RedditPreview = ({ ad, fill }) => {
  return (
    <div
      className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex ${fill ? "w-full h-full" : "max-w-[400px] mx-auto"}`}
    >
      {/* Vote bar */}
      <div className="flex flex-col items-center gap-1 px-2 py-3 bg-gray-50 border-r border-gray-200 flex-shrink-0">
        <ArrowUp
          size={18}
          className="text-gray-400 hover:text-orange-500 cursor-pointer"
        />
        <span className="text-[12px] font-bold text-gray-700">
          {ad.likes || "0"}
        </span>
        <ArrowDown
          size={18}
          className="text-gray-400 hover:text-blue-500 cursor-pointer"
        />
      </div>
      {/* Content — flex column */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-3 flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="px-1.5 py-0.5 text-[9px] font-bold text-blue-600 bg-blue-50 rounded border border-blue-200">
              PROMOTED
            </span>
            <span className="text-[11px] text-gray-500">
              u/{ad.advertiser?.toLowerCase().replace(/\s/g, "_")}
            </span>
          </div>
          <h3 className="text-[15px] font-medium text-gray-900 leading-snug">
            {ad.title}
          </h3>
        </div>
        {/* Image — grows */}
        <div className="relative rounded-lg overflow-hidden bg-gray-100 mx-3 flex-1 min-h-0">
          <img
            src={ad.thumbnail}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => (e.target.style.display = "none")}
          />
        </div>
        {/* Footer */}
        <div className="flex items-center gap-4 p-3 text-[12px] text-gray-500 flex-shrink-0 mt-auto">
          <button className="flex items-center gap-1 hover:text-gray-700">
            <MessageCircle size={14} /> {ad.comments || "0"} Comments
          </button>
          <button className="flex items-center gap-1 hover:text-gray-700">
            <Share2 size={14} /> Share
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Pinterest ───────────────────────────────────────────────────────────────
const PinterestPreview = ({ ad, fill }) => {
  return (
    <div
      className={`bg-white rounded-2xl shadow-md overflow-hidden flex flex-col ${fill ? "w-full h-full" : "max-w-[260px] mx-auto"}`}
    >
      {/* Image — grows */}
      <div className="relative flex-1 min-h-0">
        <img
          src={ad.thumbnail}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute top-2 left-2">
          <span className="px-2 py-0.5 bg-gray-900/70 text-white text-[10px] font-semibold rounded-full">
            Promoted
          </span>
        </div>
        <div className="absolute bottom-2 right-2">
          <button className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
            <Bookmark size={14} className="text-white" fill="white" />
          </button>
        </div>
      </div>
      {/* Footer */}
      <div className="p-3 flex-shrink-0 mt-auto">
        <p className="text-[13px] font-semibold text-gray-900 line-clamp-2 leading-snug">
          {ad.title}
        </p>
        <div className="flex items-center gap-1.5 mt-2">
          {ad.advertiserImage ? (
            <img
              src={ad.advertiserImage}
              alt=""
              className="w-6 h-6 rounded-full object-cover flex-shrink-0"
              onError={(e) => (e.target.style.display = "none")}
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center text-[10px] font-bold text-red-600 flex-shrink-0">
              {(ad.advertiser || "?")[0]}
            </div>
          )}
          <span className="text-[11px] text-gray-500 truncate">
            {ad.advertiser}
          </span>
        </div>
        {ad.cta && (
          <button className="w-full mt-2.5 py-2 bg-red-600 text-white text-[12px] font-semibold rounded-full hover:bg-red-700">
            {ad.cta}
          </button>
        )}
      </div>
    </div>
  );
};

// ─── TikTok ──────────────────────────────────────────────────────────────────
const TikTokPreview = ({ ad, fill }) => {
  return (
    <div
      className={`relative bg-black rounded-2xl overflow-hidden ${fill ? "w-full h-full" : "max-w-[280px] mx-auto"}`}
      style={fill ? {} : { aspectRatio: "9/16" }}
    >
      <img
        src={ad.thumbnail}
        alt=""
        className="w-full h-full object-cover"
        onError={(e) => (e.target.style.display = "none")}
      />
      {/* Play icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
          <Play fill="white" size={28} className="ml-1" />
        </div>
      </div>
      {/* Right sidebar actions */}
      <div className="absolute right-3 bottom-24 flex flex-col items-center gap-5">
        {ad.advertiserImage ? (
          <div className="relative">
            <img
              src={ad.advertiserImage}
              alt=""
              className="w-10 h-10 rounded-full object-cover border-2 border-white"
              onError={(e) => (e.target.style.display = "none")}
            />
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">
              +
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold border-2 border-white">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                <circle cx="12" cy="8" r="4" fill="white" opacity="0.8" />
                <path
                  d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"
                  fill="white"
                  opacity="0.6"
                />
              </svg>
            </div>
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">
              +
            </div>
          </div>
        )}
        <div className="flex flex-col items-center">
          <Heart size={28} className="text-white" />
          <span className="text-white text-[11px] mt-1">{ad.likes || "0"}</span>
        </div>
        <div className="flex flex-col items-center">
          <MessageCircle size={28} className="text-white" />
          <span className="text-white text-[11px] mt-1">
            {ad.comments || "0"}
          </span>
        </div>
        <div className="flex flex-col items-center">
          <Share2 size={28} className="text-white" />
          <span className="text-white text-[11px] mt-1">
            {ad.shares || "0"}
          </span>
        </div>
      </div>
      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center gap-1 mb-1">
          <span className="px-1.5 py-0.5 bg-cyan-400/20 text-cyan-300 text-[9px] font-bold rounded">
            Sponsored
          </span>
        </div>
        <p className="text-white text-[13px] font-semibold mb-0.5">
          @{ad.advertiser?.toLowerCase().replace(/\s/g, "")}
        </p>
        <p className="text-white/80 text-[12px] line-clamp-2 leading-snug">
          {ad.subtitle || ad.title}
        </p>
        {ad.cta && (
          <button className="w-full mt-2 py-2 bg-red-500 text-white text-[13px] font-semibold rounded">
            {ad.cta}
          </button>
        )}
        <div className="flex items-center gap-1.5 mt-2">
          <Music size={12} className="text-white/60" />
          <span className="text-white/60 text-[11px]">
            Original sound - {ad.advertiser}
          </span>
        </div>
      </div>
    </div>
  );
};

export default OriginalPreview;

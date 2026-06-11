import { useState, useRef } from "react";
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

const PLATFORM_ASSET_MAP = {
  facebook: fbIcon,
  fb: fbIcon,
  instagram: igIcon,
  ig: igIcon,
  youtube: ytIcon,
  yt: ytIcon,
  google: gIcon,
  ggl: gIcon,
  gdn: gdnIcon,
  native: nativeIcon,
  ntv: nativeIcon,
  linkedin: linkedinIcon,
  in: linkedinIcon,
  reddit: rdIcon,
  rd: rdIcon,
  quora: quoraIcon,
  qr: quoraIcon,
  pinterest: pinterestIcon,
  pt: pinterestIcon,
  tiktok: tiktokIcon,
  tt: tiktokIcon,
};

const PLATFORM_FULL_NAMES = {
  fb: "Facebook",
  facebook: "Facebook",
  ig: "Instagram",
  instagram: "Instagram",
  yt: "YouTube",
  youtube: "YouTube",
  ggl: "Google",
  google: "Google",
  gdn: "Google Display Network",
  ntv: "Native",
  native: "Native",
  in: "LinkedIn",
  linkedin: "LinkedIn",
  rd: "Reddit",
  reddit: "Reddit",
  qr: "Quora",
  quora: "Quora",
  pt: "Pinterest",
  pinterest: "Pinterest",
  tt: "TikTok",
  tiktok: "TikTok",
  all: "All Platforms",
};

const PlatformTab = ({
  Icon,
  imageUrl,
  label,
  active,
  onClick,
  color,
  activeBg,
  activeBorder,
  onMouseEnter,
  onMouseLeave,
  value,
  disableTooltips,
}) => {
  const assetIcon = PLATFORM_ASSET_MAP[(value || label || "").toLowerCase()];
  const iconSrc = assetIcon || imageUrl;
  const fullName =
    PLATFORM_FULL_NAMES[(value || label || "").toLowerCase()] || label;
  const [showTip, setShowTip] = useState(false);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef(null);

  const handleMouseEnter = (e) => {
    if (disableTooltips) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setTipPos({ x: rect.left + rect.width / 2, y: rect.top - 6 });
    }
    setShowTip(true);
    onMouseEnter?.(e);
  };

  const handleMouseLeave = (e) => {
    setShowTip(false);
    onMouseLeave?.(e);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={
          active
            ? {
                backgroundColor: activeBg || "rgba(99,102,241,0.22)",
                borderColor: activeBorder || "rgba(99,102,241,0.5)",
              }
            : {}
        }
        className={`flex items-center justify-center py-1.5 rounded-lg text-[13px] font-black uppercase tracking-tight transition-all whitespace-nowrap border ${
          active
            ? "text-theme-text shadow-sm px-3"
            : "border-transparent px-2.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-text/[0.06]"
        }`}
      >
        <span className={color || "text-theme-text-muted"}>
          {iconSrc ? (
            <img
              src={iconSrc}
              alt={label}
              className="min-w-[24px] h-[24px] object-contain"
            />
          ) : (
            Icon && <Icon size={24} />
          )}
        </span>
        {!iconSrc && !Icon && label}
      </button>
      {showTip && (
        <div
          className="fixed z-[200] px-3.5 py-2 text-[12px] font-semibold rounded-lg whitespace-nowrap pointer-events-none"
          style={{
            left: tipPos.x,
            top: tipPos.y,
            transform: "translate(-50%, -100%)",
            backgroundColor: "var(--color-surface)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {fullName}
        </div>
      )}
    </>
  );
};

export default PlatformTab;

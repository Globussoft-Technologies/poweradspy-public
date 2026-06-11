import React, { useState } from 'react';
import { X, Link, Check } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';

import fbIcon from '../../../assets/fb.png';
import igIcon from '../../../assets/ig.png';
import ytIcon from '../../../assets/yt.png';
import gIcon from '../../../assets/g.png';
import gdnIcon from '../../../assets/gdn.png';
import linkedinIcon from '../../../assets/linkedin.png';
import nativeIcon from '../../../assets/native.png';
import rdIcon from '../../../assets/rd.png';
import quoraIcon from '../../../assets/quora.png';
import pinterestIcon from '../../../assets/pinterest.png';

const PLATFORM_DISPLAY_NAMES = {
  facebook:  'Facebook',
  instagram: 'Instagram',
  youtube:   'YouTube',
  google:    'Google',
  gdn:       'GDN',
  linkedin:  'LinkedIn',
  native:    'Native',
  reddit:    'Reddit',
  quora:     'Quora',
  pinterest: 'Pinterest',
  tiktok:    'TikTok',
  twitter:   'Twitter',
  taboola:   'Taboola',
  outbrain:  'Outbrain',
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
};

const AnalyticsHeader = ({ adId, platform, onClose }) => {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`sticky top-0 z-[210] flex items-center justify-between px-6 py-3 ${theme === 'light' ? 'bg-theme-card border-b border-theme-border' : 'bg-[#0e0e0e]/80 backdrop-blur-md border-b border-white/5'}`}>
      <div className="flex items-center gap-3">
        <span className={`text-[20px] font-bold tracking-tight ${theme === 'light' ? 'text-theme-text' : 'text-white'}`}>Ad Analytics for {PLATFORM_DISPLAY_NAMES[platform] || platform}</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={handleCopyUrl}
          className={`relative p-2 rounded-lg transition-colors flex items-center gap-1.5 ${copied ? 'text-emerald-400 bg-emerald-500/10' : theme === 'light' ? 'text-theme-text-muted hover:text-theme-text/70 hover:bg-theme-text/5' : 'text-white/35 hover:text-white/70 hover:bg-white/5'}`}
          title="Copy page URL"
        >
          {copied ? <Check size={16} /> : <Link size={16} />}
          {copied && <span className="text-[12px] font-medium">Copied!</span>}
        </button>
        {/* <button className={`p-2 rounded-lg transition-colors ${theme === 'light' ? 'text-theme-text-muted hover:text-theme-text/70 hover:bg-theme-text/5' : 'text-white/35 hover:text-white/70 hover:bg-white/5'}`} title="More">
          <MoreHorizontal size={16} />
        </button> */}
        <button
          onClick={onClose}
          className={`p-2 rounded-lg transition-colors ml-1 hover:text-red-400 hover:bg-red-500/10 ${theme === 'light' ? 'text-theme-text-muted' : 'text-white/35'}`}
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default AnalyticsHeader;

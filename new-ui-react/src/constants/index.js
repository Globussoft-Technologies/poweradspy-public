// ─── Static Data / Constants ──────────────────────────────────────────────────
// NOTE: Icons are stored as component references (not JSX elements) so this
// file stays a plain .js file. Components render them with <Icon size={n} />.

import {
    Facebook, Instagram, Youtube, Linkedin,
    Search, Globe, MessageSquare, Heart, Play
} from 'lucide-react';

export const PLATFORMS = [
    { id: 'Facebook',  label: 'FB',  Icon: Facebook,      color: 'text-blue-400',   activeBg: 'rgba(59,130,246,0.22)',  activeBorder: 'rgba(59,130,246,0.5)'  },
    { id: 'Instagram', label: 'IG',  Icon: Instagram,     color: 'text-pink-400',   activeBg: 'rgba(236,72,153,0.22)', activeBorder: 'rgba(236,72,153,0.5)'  },
    { id: 'YouTube',   label: 'YT',  Icon: Youtube,       color: 'text-red-400',    activeBg: 'rgba(248,113,113,0.22)', activeBorder: 'rgba(248,113,113,0.5)' },
    { id: 'LinkedIn',  label: 'IN',  Icon: Linkedin,      color: 'text-blue-500',   activeBg: 'rgba(59,130,246,0.22)',  activeBorder: 'rgba(59,130,246,0.5)'  },
    { id: 'Google',    label: 'GGL', Icon: Search,        color: 'text-yellow-400', activeBg: 'rgba(250,204,21,0.18)',  activeBorder: 'rgba(250,204,21,0.45)' },
    { id: 'Native',    label: 'NAT', Icon: Globe,         color: 'text-green-400',  activeBg: 'rgba(74,222,128,0.18)',  activeBorder: 'rgba(74,222,128,0.45)' },
    { id: 'Reddit',    label: 'RDT', Icon: MessageSquare, color: 'text-orange-400', activeBg: 'rgba(251,146,60,0.22)',  activeBorder: 'rgba(251,146,60,0.5)'  },
    { id: 'Pinterest', label: 'PIN', Icon: Heart,         color: 'text-rose-400',   activeBg: 'rgba(251,113,133,0.22)', activeBorder: 'rgba(251,113,133,0.5)' },
    { id: 'TikTok',    label: 'TT',  Icon: Play,          color: 'text-cyan-400',   activeBg: 'rgba(34,211,238,0.18)',  activeBorder: 'rgba(34,211,238,0.45)' },
];

export const AD_CATEGORIES = [
    { id: 'all', label: 'All Ads' },
    { id: 'ecom', label: 'Ecommerce' },
    { id: 'finance', label: 'Finance' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'saas', label: 'SaaS' },
    { id: 'health', label: 'Health' },
    { id: 'edu', label: 'Education' },
    { id: 'fashion', label: 'Fashion' },
    { id: 'travel', label: 'Travel' },
    { id: 'realestate', label: 'Real Estate' },
    { id: 'gaming', label: 'Gaming' },
    { id: 'auto', label: 'Automotive' },
];

export const SORT_TABS = ['Newest', 'Popular', 'Running Longest', 'Oldest'];

export const FILTER_OPTIONS = {
    categories: ['Ecommerce', 'Finance & Insurance', 'Crypto', 'Clothing & Accessories', 'Education', 'Software & SaaS', 'Health & Fitness', 'Travel', 'Real Estate', 'Gaming', 'Automotive'],
    adTypes: ['Image', 'Video', 'Carousel', 'Story', 'Reel'],
    ctas: ['Shop Now', 'Learn More', 'Sign Up', 'Download', 'Book Now', 'Contact Us', 'Add to Cart', 'Get Offer', 'Watch More', 'Apply Now'],
    countries: ['United States', 'United Kingdom', 'Canada', 'Australia', 'India', 'Germany', 'France', 'Brazil', 'Singapore', 'UAE', 'South Africa', 'Japan'],
    ecommerce: ['Shopify', 'WooCommerce', 'Magento', 'BigCommerce', 'Wix', 'Squarespace', 'Prestashop'],
    funnels: ['ClickFunnels', 'LeadPages', 'Kajabi', 'Kartra', 'Instapage', 'GetResponse', 'Convertri', 'Builderall'],
    affiliates: ['ClickBank', 'ShareASale', 'Commission Junction', 'Rakuten', 'MaxBounty', 'PeerFly', 'JVZoo'],
    adSeen: ['Anytime', 'Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'This Month', 'Last Month'],
    postDate: ['Anytime', 'Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'This Month', 'Last Month'],
    domainAge: ['All Ages', 'New (< 1 yr)', '1–3 Years', '3–5 Years', '5+ Years'],
};

export const SEARCH_IN_OPTIONS = ['Ad Text', 'Advertiser', 'Keyword', 'Domain'];

// ─── Platform-Aware Engagement Rules ─────────────────────────────────────────
// Determines which engagement metrics are shown per platform + position.
export const ENGAGEMENT_RULES = {
    facebook: {
        'news feed':   { like: true, share: true, comment: true, view: true, impression: true, popularity: true, ad_budget: true },
        'video feed':  { like: true, share: true, comment: true, view: true, impression: true, popularity: true, ad_budget: true },
        'feed':        { like: true, share: true, comment: true, view: true, impression: true, popularity: true, ad_budget: true },
        'side column': {},
        'side':        {},
        'marketplace': {},
        _default:      { like: true, share: true, comment: true, view: true },
    },
    instagram: {
        'image':       { like: true, comment: true, view: true, impression: true, popularity: true, ad_budget: true },
        'stories':     { like: true, comment: true, view: true, impression: true, popularity: true, ad_budget: true },
        _default:      { like: true, comment: true, view: true, impression: true },
        // Instagram has NO share metric
    },
    youtube: {
        'video':     { like: true, comment: true, view: true, impression: true, popularity: true, ad_budget: true },
        'discovery': { like: true, comment: true, view: true },
        'image':     {},
        'banner':    {},
        'display':   {},
        'text-image': {},
    },
    google: {
        // Google has no engagement — uses keywords instead
    },
    gdn: {
        // GDN has no engagement — same as Google
    },
};

// Returns which metrics to show for a given platform + position + adType combo
export const getVisibleMetrics = (network, position, adType) => {
    const platform = (network || '').toLowerCase();
    const pos = (position || '').toLowerCase();
    const type = (adType || '').toLowerCase();

    const platformRules = ENGAGEMENT_RULES[platform];
    if (!platformRules) return { like: true, share: true, comment: true, view: true }; // fallback for unlisted platforms

    // Try exact position match
    if (platformRules[pos]) return platformRules[pos];

    // Try partial position match
    for (const key of Object.keys(platformRules)) {
        if (!key.startsWith('_') && pos.includes(key)) return platformRules[key];
    }

    // Fallback to _default or empty
    return platformRules._default || {};
};

// ─── Ad Type Badges ──────────────────────────────────────────────────────────
export const AD_TYPE_BADGES = {
    video:       { color: 'bg-red-500/15 text-red-400 border-red-500/20',       label: 'Video' },
    carousel:    { color: 'bg-amber-500/15 text-amber-400 border-amber-500/20', label: 'Carousel' },
    image:       { color: 'bg-blue-500/15 text-blue-400 border-blue-500/20',    label: 'Image' },
    banner:      { color: 'bg-purple-500/15 text-purple-400 border-purple-500/20', label: 'Banner' },
    display:     { color: 'bg-teal-500/15 text-teal-400 border-teal-500/20',    label: 'Display' },
    discovery:   { color: 'bg-sky-500/15 text-sky-400 border-sky-500/20',       label: 'Discovery' },
    'text-image': { color: 'bg-gray-500/15 text-gray-400 border-gray-500/20',   label: 'Text-Image' },
    text:           { color: 'bg-gray-500/15 text-gray-400 border-gray-500/20',         label: 'Text' },
    story:          { color: 'bg-pink-500/15 text-pink-400 border-pink-500/20',          label: 'Story' },
    reel:           { color: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/20', label: 'Reel' },
    native_ad:      { color: 'bg-orange-500/15 text-orange-400 border-orange-500/20',    label: 'Native Ad' },
    organic_search: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', label: 'Organic Search' },
};

// ─── Platform Card Accent Colors ─────────────────────────────────────────────
export const PLATFORM_ACCENT = {
    facebook:  { border: 'border-blue-500/20',  glow: 'shadow-blue-500/5',  text: 'text-blue-400',  bg: 'bg-blue-500/10' },
    instagram: { border: 'border-pink-500/20',  glow: 'shadow-pink-500/5',  text: 'text-pink-400',  bg: 'bg-pink-500/10' },
    youtube:   { border: 'border-red-500/20',   glow: 'shadow-red-500/5',   text: 'text-red-400',   bg: 'bg-red-500/10' },
    google:    { border: 'border-sky-500/20',   glow: 'shadow-sky-500/5',   text: 'text-sky-400',   bg: 'bg-sky-500/10' },
    linkedin:  { border: 'border-blue-500/20',  glow: 'shadow-blue-500/5',  text: 'text-blue-500',  bg: 'bg-blue-500/10' },
    native:    { border: 'border-green-500/20', glow: 'shadow-green-500/5', text: 'text-green-400', bg: 'bg-green-500/10' },
    reddit:    { border: 'border-orange-500/20',glow: 'shadow-orange-500/5',text: 'text-orange-400',bg: 'bg-orange-500/10' },
    pinterest: { border: 'border-rose-500/20',  glow: 'shadow-rose-500/5',  text: 'text-rose-400',  bg: 'bg-rose-500/10' },
    tiktok:    { border: 'border-cyan-500/20',  glow: 'shadow-cyan-500/5',  text: 'text-cyan-400',  bg: 'bg-cyan-500/10' },
};

// ─── Star Rating Conversion ──────────────────────────────────────────────────
export const getStarRating = (popularity) => {
    const value = Number(popularity) || 0;
    if (value === 0) return 0.5;
    if (value <= 33.34) return 1.0;
    if (value <= 33.40) return 1.5;
    if (value <= 33.56) return 2.0;
    if (value <= 34.23) return 2.5;
    if (value <= 36.47) return 3.0;
    if (value <= 43.03) return 3.5;
    if (value <= 54.45) return 4.0;
    if (value <= 63.51) return 4.5;
    return 5.0;
};

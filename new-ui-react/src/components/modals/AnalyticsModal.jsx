import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import PlatformBadgesRow from "../shared/PlatformBadgesRow";
import {
  calculateRunningDays,
  normalizeEcommercePlatformKey,
} from "../../utils/helper";
import { getAiColorLabel } from "../../utils/aiColorPalette";
import { getAffiliateNetworkLogo } from "../../utils/affiliateLogos";
import mpAgkn from "../../assets/marketingPlatform/agkn.com.png";
import mpBranch from "../../assets/marketingPlatform/branch.png";
import mpConversionx from "../../assets/marketingPlatform/conversionx.co.png";
import mpDemdex from "../../assets/marketingPlatform/demdex.net.png";
import mpDoubleclick from "../../assets/marketingPlatform/doubleclick.png";
import mpHubspot from "../../assets/marketingPlatform/hubs.ly.png";
import mpHootsuite from "../../assets/marketingPlatform/ow.ly.png";
import mpKenshoo from "../../assets/marketingPlatform/xg4ken.com.png";

const MARKETING_PLATFORM_IMGS = {
  'agkn.com': mpAgkn,
  'branch': mpBranch,
  'conversionx.co': mpConversionx,
  'demdex.net': mpDemdex,
  'doubleclick': mpDoubleclick,
  'hubs.ly': mpHubspot,
  'ow.ly': mpHootsuite,
  'xg4ken.com': mpKenshoo,
};

const MARKET_PLATFORMS = [
  { match: 'demdex.net',    title: 'Adobe Audience Manager' },
  { match: 'branch',        title: 'Branch' },
  { match: 'conversionx.co',title: 'Conversionx' },
  { match: 'doubleclick',   title: 'Google Marketing Platform' },
  { match: 'ow.ly',         title: 'Hootsuite' },
  { match: 'hubs.ly',       title: 'Hubspot' },
  { match: 'xg4ken.com',    title: 'Kenshoo' },
  { match: 'agkn.com',      title: 'Neustar' },
];

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

const ECOMMERCE_PLATFORM_IMGS = {
  'bigcommerce': ecBigCommerce,
  'demandware': ecDemandware,
  'prestashop': ecPrestaShop,
  'shopify': ecShopify,
  'squarespace': ecSquarespace,
  'volusion': ecVolusion,
  'wix': ecWix,
  'woocommerce': ecWooCommerce,
  '3dcart': ec3dCart,
  'magento': ecMagento,
};

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
import fnFgFunnel from "../../assets/funnels/fgfunnel.webp";
import fnFlexi from "../../assets/funnels/flexi.png";
import fnWebflow from "../../assets/funnels/webflow.png";
import fnFacebookPixel from "../../assets/funnels/facebook_pixel.png";

const FUNNEL_IMGS = {
  'builderall': fnBuilderall,
  'clickfunnels': fnClickfunnel,
  'clickfunnel': fnClickfunnel,
  'convertri': fnConvertri,
  'getresponse': fnGetresponse,
  'instapage': fnInstapage,
  'kajabi': fnKajabi,
  'kartra': fnKartra,
  'keap': fnKeap,
  'landingi': fnLandingi,
  'leadpages': fnLeadpages,
  'optimizepress': fnOptimizepress,
  'samcart': fnSamcart,
  'wishpond': fnWishpond,
  'fgfunnel': fnFgFunnel,
  'flexi': fnFlexi,
  'webflow': fnWebflow,
  'facebookpixel': fnFacebookPixel,
};

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Calendar,
  Activity,
  Globe,
  Monitor,
  MapPin,
  Hash,
  ExternalLink,
  ThumbsUp,
  Eye,
  Share2,
  MessageCircle,
  Play,
  Image,
  Film,
  Layers,
  Circle,
  Clock,
  TrendingUp,
  BarChart3,
  Zap,
  DollarSign,
  Star,
  StarHalf,
  Tag,
  Type,
  Search,
  Building2,
  ChevronLeft,
  ChevronRight,
  X,
  FileText,
  Sparkles,
  Youtube,
  Megaphone,
  Info,
} from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { resolveAnalyticsFilterValueLabel } from "../../hooks/useSDUI";
import { useAdInsights } from "../../hooks/useAdInsights";
import { useInterestBehaviour } from "../../hooks/useInterestBehaviour";
import { mapAdToCard, resolveNasUrl, fetchFreshTikTokVideoUrl, getVideoEmbedUrl } from '../../services/api';
import { trackAdAction } from "../../utils/googleAnalytics";
import { getStarRating } from "../../constants";
import { resolveAdCategories } from "../../utils/categoryTaxonomy";
import { iconColorClass } from "../../utils/iconColors";
import he from "he";

const StarRating = ({ value, isLight }) => {
  const rating = getStarRating(value);
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      stars.push(
        <Star key={i} size={14} className="text-amber-400 fill-amber-400" />,
      );
    } else if (i - 0.5 === rating) {
      stars.push(
        <StarHalf
          key={i}
          size={14}
          className="text-amber-400 fill-amber-400"
        />,
      );
    } else {
      stars.push(
        <Star
          key={i}
          size={14}
          strokeWidth={2.5}
          className={isLight ? "text-black/30" : "text-white/50"}
        />,
      );
    }
  }
  return (
    <div className="flex items-center gap-0.5">
      {stars}
      <span
        className={`text-xs ml-1 tabular-nums ${isLight ? "text-black/30" : "text-white/30"}`}
      >
        {rating.toFixed(1)}
      </span>
    </div>
  );
};

import AnalyticsHeader from "./analytics/AnalyticsHeader";
import BasicInfo from "./analytics/BasicInfo";
import CreativeScore from "./analytics/CreativeScore";
import AudienceSection from "./analytics/AudienceSection";
import SocialEngagements from "./analytics/SocialEngagements";
import LanderDetails from "./analytics/LanderDetails";
import Demographics from "./analytics/Demographics";
import CountryAnalytics from "./analytics/CountryAnalytics";
import TikTokTimeAnalysis from "./analytics/TikTokTimeAnalysis";
import TransparencyDelivery from "./analytics/TransparencyDelivery";

// ─── Platform engagement rules ───────────────────────────────────────
const ENGAGEMENT_RULES = {
  facebook: {
    "news feed": {
      like: true,
      share: true,
      comment: true,
      view: true,
      impression: true,
      popularity: true,
      ad_budget: true,
    },
    "video feed": {
      like: true,
      share: true,
      comment: true,
      view: true,
      impression: true,
      popularity: true,
      ad_budget: true,
    },
    "side column": {},
    marketplace: {},
    _default: { like: true, share: true, comment: true, view: true },
    _videoOverride: { view: true },
  },
  instagram: {
    image: {
      like: true,
      comment: true,
      view: true,
      impression: true,
      popularity: true,
      ad_budget: true,
    },
    stories: {
      like: true,
      comment: true,
      view: true,
      impression: true,
      popularity: true,
      ad_budget: true,
    },
    _default: { like: true, comment: true, view: true, impression: true },
  },
  youtube: {
    video: {
      like: true,
      comment: true,
      view: true,
      impression: true,
      popularity: true,
      ad_budget: true,
    },
    discovery: { like: true, comment: true, view: true },
    image: {},
    banner: {},
    display: {},
    "text-image": {},
    _default: {},
  },
  google: {
    image: {},
    text: {},
    _default: {},
  },
};

const AD_TYPE_CONFIG = {
  video: {
    label: "VIDEO",
    icon: Film,
    cls: "text-red-600 bg-red-500/10 border-red-500/20 dark:text-red-300 dark:bg-red-500/20 dark:border-red-500/10",
  },
  carousel: {
    label: "CAROUSEL",
    icon: Layers,
    cls: "text-amber-600 bg-amber-500/10 border-amber-500/20 dark:text-amber-300 dark:bg-amber-500/20 dark:border-amber-500/10",
  },
  image: {
    label: "IMAGE",
    icon: Image,
    cls: "text-blue-600 bg-blue-500/10 border-blue-500/20 dark:text-blue-300 dark:bg-blue-500/20 dark:border-blue-500/10",
  },
  // Instagram's native "Stories" ad format — a distinct `type` value in ES
  // (instagram_ad.type: 'STORIES'), separate from image/video/carousel.
  // Without an entry here, AD_TYPE_CONFIG's substring lookup falls through to
  // its 'image' default, mislabeling every Stories ad as "IMAGE".
  stories: {
    label: "STORIES",
    icon: Circle,
    cls: "text-fuchsia-600 bg-fuchsia-500/10 border-fuchsia-500/20 dark:text-fuchsia-300 dark:bg-fuchsia-500/20 dark:border-fuchsia-500/10",
  },
  banner: {
    label: "BANNER",
    icon: Monitor,
    cls: "text-purple-600 bg-purple-500/10 border-purple-500/20 dark:text-purple-300 dark:bg-purple-500/20 dark:border-purple-500/10",
  },
  // AdMob's own `type` vocabulary (INTERSTITIAL_OR_NATIVE, INTERSTITIAL_WEBVIEW,
  // NATIVE_OR_UNKNOWN, PLAY_STORE_AD, VISUAL_NATIVE_AD) matched none of the
  // keys above, so the substring lookup silently fell through to the 'image'
  // default and mislabeled every one of those ad types as "IMAGE".
  interstitial: {
    label: "INTERSTITIAL",
    icon: Monitor,
    cls: "text-indigo-600 bg-indigo-500/10 border-indigo-500/20 dark:text-indigo-300 dark:bg-indigo-500/20 dark:border-indigo-500/10",
  },
  native: {
    label: "NATIVE",
    icon: Tag,
    cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-300 dark:bg-emerald-500/20 dark:border-emerald-500/10",
  },
  play_store: {
    label: "APP INSTALL",
    icon: Star,
    cls: "text-orange-600 bg-orange-500/10 border-orange-500/20 dark:text-orange-300 dark:bg-orange-500/20 dark:border-orange-500/10",
  },
  display: {
    label: "DISPLAY",
    icon: Monitor,
    cls: "text-teal-600 bg-teal-500/10 border-teal-500/20 dark:text-teal-300 dark:bg-teal-500/20 dark:border-teal-500/10",
  },
  discovery: {
    label: "DISCOVERY",
    icon: Search,
    cls: "text-sky-600 bg-sky-500/10 border-sky-500/20 dark:text-sky-300 dark:bg-sky-500/20 dark:border-sky-500/10",
  },
  "text-image": {
    label: "TEXT-IMAGE",
    icon: Type,
    cls: "text-gray-600 bg-gray-500/10 border-gray-500/20 dark:text-gray-300 dark:bg-gray-500/20 dark:border-gray-500/10",
  },
  text: {
    label: "TEXT",
    icon: Type,
    cls: "text-gray-600 bg-gray-500/10 border-gray-500/20 dark:text-gray-300 dark:bg-gray-500/20 dark:border-gray-500/10",
  },
};

const ASPECT_RATIOS = {
  facebook: {
    "side column": ["16:9", "1:1", "4:5", "9:16"],
    "news feed": ["3:2", "1:1", "4:5"],
    "video feed": ["1:1"],
    marketplace: ["4:5", "3:2", "1:1", "9:16"],
  },
  instagram: { _default: ["1:1", "4:5", "9:16"] },
  youtube: { _default: ["16:9"] },
  google: { _default: ["auto"] },
};

export const normalizePlatformSlug = (platform) => {
  if (Number(platform) === 18) return "google";
  return String(platform ?? "").trim().toLowerCase();
};

export const formatDomainValue = (...values) => {
  const domain = values.find((value) => {
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized !== "" && normalized !== "null" && normalized !== "(none)";
  });

  return domain == null ? "\u2014" : String(domain).trim();
};

export const mergeTransparencyDateContract = (mappedAd, sourceAd) => {
  const merged = { ...mappedAd };
  for (const field of ["firstSeenRaw", "lastSeenRaw", "lastShownRaw", "postDateRaw"]) {
    if (Object.prototype.hasOwnProperty.call(sourceAd || {}, field)) {
      merged[field] = sourceAd[field] ?? null;
    }
  }
  return merged;
};

export const resolveTransparencyContractValue = (details, field, ...fallbacks) => {
  if (Object.prototype.hasOwnProperty.call(details || {}, field)) {
    return details[field] ?? null;
  }
  return fallbacks.find((value) => value != null && value !== "") ?? null;
};

export const formatTransparencyCalendarDate = (value) => {
  if (value == null || value === "") return "--";
  const text = String(value).trim();
  let calendarDate = text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || null;

  if (!calendarDate && /^\d{9,13}$/.test(text)) {
    const number = Number(text);
    const timestamp = text.length === 10 ? number * 1000 : number;
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      calendarDate = parsed.toISOString().slice(0, 10);
    }
  }

  if (!calendarDate) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      calendarDate = parsed.toISOString().slice(0, 10);
    }
  }

  if (
    !calendarDate ||
    calendarDate.startsWith("1970-01-01") ||
    calendarDate.startsWith("1000-01-01") ||
    calendarDate.startsWith("0001-01-01") ||
    calendarDate.startsWith("0000-00-00")
  ) return "--";

  // The Transparency value is a reported calendar date, not a local-time
  // instant. Pin the extracted YYYY-MM-DD to UTC midnight so a SQL string such
  // as "2026-07-27 00:00:00" cannot become 26 Jul after an India→UTC shift.
  const date = new Date(`${calendarDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

export const hasTransparencyDetailValue = (value) => {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(hasTransparencyDetailValue);
  const normalized = String(value).trim().toLowerCase();
  return Boolean(normalized) && ![
    "--",
    "—",
    "-",
    "na",
    "n/a",
    "null",
    "undefined",
  ].includes(normalized);
};

const formatAiMetaToken = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const friendly = {
    no_explicit_offer: "No explicit offer",
    preorder: "Preorder",
    free_quote: "Free quote",
    early_bird_offer: "Early bird offer",
    listed_price: "Listed price",
    trade_in_credit: "Trade-in credit",
  }[lower];
  if (friendly) return friendly;
  return text
    .split(/[_\s]+/)
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
};

const formatAiMetaValue = (value) => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => formatAiMetaValue(item))
      .filter(Boolean)
      .join(", ");
  }
  const text = String(value).trim();
  return text && text !== "null" && text !== "undefined" ? text : "";
};

const normalizeAiMetaColors = (value) => {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\|]/)
      : value != null
        ? [value]
        : [];

  return items
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((token) => {
      const raw = token.replace(/\s+/g, "");
      const hex = raw.startsWith("#") ? raw : `#${raw}`;
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)
        ? hex.toUpperCase()
        : null;
    })
    .filter(Boolean);
};

const normalizeAiMetaTags = (value) => {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\|]/)
      : value != null
        ? [value]
        : [];

  return items
    .map((item) => formatAiMetaToken(item))
    .filter(Boolean);
};

/**
 * Build the two-column 1e scorecard without dropping any field from the former
 * flat AI Insights table. Filterable attributes stay left; reasoning-of-action
 * become evidence cards on the right.
 */
export const buildAiMetaScorecard = (aiMeta) => {
  if (!aiMeta || typeof aiMeta !== "object") {
    return { attributes: [], caption: "", evidence: [] };
  }

  const roa = aiMeta.roa && typeof aiMeta.roa === "object" ? aiMeta.roa : {};
  const offers = Array.isArray(aiMeta.offers) ? aiMeta.offers : [];
  const offerTypeRaw = aiMeta.offer_type ?? offers.find((offer) => offer?.type != null)?.type;
  const offeringTypeRaw = String(aiMeta.offering_type || "").trim().toLowerCase();
  const offeringType = offeringTypeRaw === "both"
    ? "Product & Service"
    : formatAiMetaToken(aiMeta.offering_type);

  const attributes = [
    { label: "Offering", value: formatAiMetaValue(aiMeta.offering) },
    { label: "Ad type", value: formatAiMetaToken(aiMeta.ad_type) },
    { label: "Offering type", value: offeringType },
    { label: "Offer type", value: formatAiMetaToken(offerTypeRaw) },
    { label: "Intent", value: formatAiMetaValue(aiMeta.intent), kind: "intent", tokens: normalizeAiMetaTags(aiMeta.intent) },
    { label: "Hook", value: formatAiMetaValue(aiMeta.hook), kind: "hook", tokens: normalizeAiMetaTags(aiMeta.hook) },
    { label: "Colors", value: formatAiMetaValue(aiMeta.colors), kind: "colors", colors: normalizeAiMetaColors(aiMeta.colors) },
  ].filter(({ value, tokens, colors }) => Boolean(value || tokens?.length || colors?.length));

  const evidence = [
    { label: "Intent reasoning", value: formatAiMetaValue(roa.intent) },
    { label: "Hook reasoning", value: formatAiMetaValue(roa.hook) },
    { label: "Offering type reasoning", value: formatAiMetaValue(roa.offering_type) },
    { label: "Offering reasoning", value: formatAiMetaValue(roa.offering) },
  ].filter(({ value }) => Boolean(value));

  return {
    attributes,
    caption: formatAiMetaValue(aiMeta.caption),
    evidence,
  };
};

export function getAspectStyle(platform, position, adAspectRatio) {
  if (adAspectRatio && adAspectRatio !== "auto") {
    return { aspectRatio: adAspectRatio.replace(":", "/") };
  }
  const p = normalizePlatformSlug(platform);
  const pos = String(position ?? "").toLowerCase();
  const ratioMap = ASPECT_RATIOS[p] || {};
  const ratios = ratioMap[pos] || ratioMap._default || ["4/5"];
  const r = ratios[0];
  if (r === "auto") return {};
  return { aspectRatio: r.replace(":", "/") };
}

// ISO code → full language name (e.g. "id" → "Indonesian", "sv" → "Swedish").
// Guard: Chromium's ICU canonicalizes ANY input as a BCP 47 tag, so passing a
// full name like "Ido"/"Twi" comes back as its 2-letter tag ("io"/"tw") — a
// *shorter* result. Only accept the ICU output when it's actually *longer*
// than the input (i.e. an expansion, not a canonicalization); otherwise
// return the input unchanged (capitalized) so full names survive intact.
const formatLanguage = (raw) => {
  const s = (raw == null ? '' : String(raw)).trim();
  if (!s) return '—';
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    const name = names.of(s);
    if (
      name &&
      name.toLowerCase() !== s.toLowerCase() &&
      name.length > s.length
    ) {
      return name;
    }
  } catch {}
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Format ad position for display (e.g. SEARCHFEED_DISCOVERY → Searchfeed Discovery),
// matching how AdCard/AdDetailModal render this field.
const formatPosition = (pos) => {
  if (!pos) return "";
  return String(pos)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// Render multi-value source fields (e.g. ["android","desktop"]) as a readable,
// comma-separated list instead of React's default concatenation ("androiddesktop").
const formatSource = (v) => {
  if (v == null || v === '' || v === '—') return '';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  if (typeof v === 'string') {
    const cleaned = v.split(/[,|]/).map(s => s.trim()).filter(Boolean);
    return cleaned.length ? cleaned.join(', ') : '';
  }
  return String(v);
};

// Detect marketing platforms from the same URL sources the backend filter uses
// (gdn_ad_url, gdn_ad_outgoing_links, gdn_ad_meta_data). Returns display titles.
function detectMarketingPlatforms(d, ad, insights) {
  const outgoing = Array.isArray(insights?.outgoingLinks)
    ? insights.outgoingLinks[0]
    : insights?.outgoingLinks;
  const mpUrlObj = d?.market_platform_urls || ad?.marketPlatformUrls || {};

  // GDN stores the redirect chain as a pipe-separated string; YouTube stores it
  // as an array in the `redirect_urls` ES field. Normalize both to flat strings.
  const asUrlStrings = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    if (typeof v === 'string' && v) return v.split('||').map(s => s.trim()).filter(Boolean);
    return [];
  };

  const mpRedirects      = asUrlStrings(mpUrlObj?.url_redirects);
  const mpRedirectUrlsArr = asUrlStrings(mpUrlObj?.redirect_urls);
  const topLevelRedirects = asUrlStrings(d?.redirect_urls);

  const urlsToCheck = [
    d?.destination_url, d?.url, d?.redirect_url, d?.final_url, d?.source_url,
    outgoing?.source_url, outgoing?.redirect_url, outgoing?.final_url,
    mpUrlObj?.destination_url,
    mpUrlObj?.url_destination,
    mpUrlObj?.source_url,
    mpUrlObj?.redirect_url,
    mpUrlObj?.final_url,
    ...mpRedirects,
    ...mpRedirectUrlsArr,
    ...topLevelRedirects,
  ].filter(Boolean);
  if (Array.isArray(d?.urlArray)) {
    d.urlArray.forEach(u => u?.url && urlsToCheck.push(u.url));
  }
  const seen = new Set();
  const titles = [];
  for (const url of urlsToCheck) {
    const lower = url.toLowerCase();
    for (const mp of MARKET_PLATFORMS) {
      if (lower.includes(mp.match) && !seen.has(mp.match)) {
        seen.add(mp.match);
        titles.push(mp.title);
      }
    }
  }
  return titles;
}

const AdTextBlock = ({ text, isLight }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const isLong = text.length > 150;
  const textCls = isLight
    ? "text-[13px] text-black/65 leading-relaxed font-semibold"
    : "text-[13px] text-white/60 leading-relaxed font-light";
  return (
    <p className={textCls}>
      {expanded || !isLong ? text : `${text.substring(0, 150)}...`}
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="ml-1 text-[#6b99ff] hover:text-[#7899e0] font-bold focus:outline-none"
        >
          {expanded ? "Show Less" : "Read More"}
        </button>
      )}
    </p>
  );
};

// Renders clamped text and only exposes the toggle button when the text
// actually overflows its clamp (measured, not guessed). Prevents a stray
// "Read More" from appearing next to fully-visible short descriptions.
const ClampedText = ({
  text,
  className = "",
  clampClass = "line-clamp-4",
  buttonClassName = "",
  moreLabel = "Read More",
  lessLabel = "Read Less",
}) => {
  const ref = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      // Only meaningful while clamped; when expanded the clamp is off and
      // scrollHeight === clientHeight, so preserve the last-known result.
      if (expanded) return;
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);

  if (!text) return null;
  return (
    <>
      <p ref={ref} className={`${className} ${expanded ? "" : clampClass}`}>
        {text}
      </p>
      {overflowing && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className={buttonClassName}
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      )}
    </>
  );
};

const TargetedKeywords = ({ adDetails, ad, isLight, competitiveIntelEnabled, onKeywordClick, onOpenAdvertiserProfile, onOpenKeywordsExplorer, advertiser, postOwnerId }) => {
  const keywords =
    adDetails?.target_keyword ||
    ad?.target_keyword ||
    ad?.keywords ||
    ad?.target_keywords;
  // Keyword strings can separate terms with "," or "|" (e.g. Google Ads'
  // "jil sander|puma india" pipe-delimited targeting) — split on either so
  // each term gets its own box instead of one box holding the raw string.
  const kwList = Array.isArray(keywords)
    ? keywords
    : typeof keywords === "string"
      ? keywords
          .split(/[,|]/)
          .map((k) => k.trim())
          .filter(Boolean)
      : [];
  const kwClickable = typeof onKeywordClick === "function";
  const network = String(ad?.network || ad?.platform || "google").toLowerCase();

  return (
    <div className="px-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3
          className={`flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] ${isLight ? "text-gray-800" : "text-white/90"}`}
        >
          <Tag size={16} className="opacity-60" />
          Targeted Keywords
        </h3>
        <div className="flex items-center gap-2">
          {competitiveIntelEnabled && typeof onOpenKeywordsExplorer === "function" ? (
            <button
              type="button"
              onClick={() => {
                trackAdAction('google_ad_analytics_keyword_explorer', { entry_point: 'ad_analytics_modal', feature_name: 'keyword_explorer', network, network_scope: 'single', platform: network, request_context: 'ad_analytics' });
                onOpenKeywordsExplorer();
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${isLight ? "border-blue-200 text-blue-700 hover:bg-blue-50" : "border-blue-500/30 text-blue-300 hover:bg-blue-500/10"}`}
            >
              <Tag size={13} />
              Keywords Explorer
            </button>
          ) : null}
          {competitiveIntelEnabled && typeof onOpenAdvertiserProfile === "function" && (advertiser || postOwnerId) ? (
            <button
              type="button"
              onClick={() => {
                trackAdAction('google_ad_analytics_view_advertiser_profile', { entry_point: 'ad_analytics_modal', feature_name: 'advertiser_profile', network, network_scope: 'single', platform: network, request_context: 'ad_analytics' });
                onOpenAdvertiserProfile({ postOwnerId, advertiserName: advertiser });
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${isLight ? "border-blue-200 text-blue-700 hover:bg-blue-50" : "border-blue-500/30 text-blue-300 hover:bg-blue-500/10"}`}
            >
              <Building2 size={13} />
              View advertiser profile
            </button>
          ) : null}
        </div>
      </div>
      {kwList.length === 0 ? (
        <div
          className={`rounded-xl border py-12 flex items-center justify-center ${isLight ? "bg-gray-50 border-gray-200" : "bg-white/[0.02] border-white/5"}`}
        >
          <span
            className={`text-sm ${isLight ? "text-gray-400" : "text-white/30"}`}
          >
            No keywords found
          </span>
        </div>
      ) : (
        <div
          className={`rounded-xl border p-4 flex flex-wrap gap-2 ${isLight ? "bg-gray-50/50 border-gray-200" : "bg-white/[0.02] border-white/5"}`}
        >
          {kwList.map((kw, i) => (
            <button
              key={i}
              type="button"
              disabled={!kwClickable}
              onClick={kwClickable ? () => onKeywordClick(kw) : undefined}
              title={kwClickable ? `Explore “${kw}”` : undefined}
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm border transition-colors ${isLight ? "bg-white border-blue-200 text-blue-700" : "bg-blue-500/10 border-blue-500/20 text-blue-300"} ${kwClickable ? (isLight ? "hover:bg-blue-50 cursor-pointer" : "hover:bg-blue-500/20 cursor-pointer") : "cursor-default"}`}
            >
              {kw}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const AdDetailsActivity = ({ targetSiteData, isLight }) => {
  const data = Array.isArray(targetSiteData) ? targetSiteData : [];
  const chartData = data.map((d) => ({ date: d.date, count: d.count || 0 }));
  const rawMax =
    chartData.length > 0 ? Math.max(...chartData.map((d) => d.count)) : 0;
  const yMax = Math.ceil(Math.max(rawMax * 1.3, rawMax + 1, 2));
  const axisColor = isLight ? "#9f9f9f" : "rgba(159,159,159)";
  const gridColor = isLight ? "#f3f4f6" : "rgba(255,255,255,0.05)";
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div
        className={`px-3 py-1.5 rounded text-xs font-semibold shadow ${isLight ? "bg-gray-800 text-white" : "bg-white text-gray-900"}`}
      >
        {label}: {payload[0].value}
      </div>
    );
  };
  return (
    <div className="px-6">
      <h3
        className={`flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] mb-4 ${isLight ? "text-gray-800" : "text-white/90"}`}
      >
        <Activity size={16} className="opacity-60" />
        Ad Details Activity
      </h3>
      {targetSiteData === null ? (
        <div
          className={`rounded-xl border py-12 flex items-center justify-center ${isLight ? "bg-gray-50 border-gray-200" : "bg-white/[0.02] border-white/5"}`}
        >
          <span
            className={`text-sm ${isLight ? "text-gray-400" : "text-white/30"}`}
          >
            Loading...
          </span>
        </div>
      ) : data.length === 0 ? (
        <div
          className={`rounded-xl border py-12 flex items-center justify-center ${isLight ? "bg-gray-50 border-gray-200" : "bg-white/[0.02] border-white/5"}`}
        >
          <span
            className={`text-sm ${isLight ? "text-gray-400" : "text-white/30"}`}
          >
            No data found
          </span>
        </div>
      ) : (
        <div
          className={`rounded-xl border p-5 ${isLight ? "bg-white shadow-sm border-gray-200" : "bg-white/[0.02] border-white/5"}`}
        >
          <p
            className={`text-sm font-semibold text-center mb-4 ${isLight ? "text-gray-700" : "text-white/80"}`}
          >
            Daily activity of Ad
          </p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 30, left: 20, bottom: 40 }}
            >
              <CartesianGrid vertical={false} stroke={gridColor} />
              <XAxis
                dataKey="date"
                tick={{ fill: axisColor, fontSize: 12 }}
                axisLine={{ stroke: gridColor }}
                tickLine={false}
                tickFormatter={(v) => {
                  const d = new Date(v);
                  return d.toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  });
                }}
                label={{
                  value: "Ad shown date",
                  position: "insideBottom",
                  offset: -10,
                  fill: axisColor,
                  fontSize: 12,
                }}
              />
              <YAxis
                domain={[0, yMax]}
                tick={{ fill: axisColor, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                label={{
                  value: "No of times ad was shown",
                  angle: -90,
                  position: "center",
                  dx: -20,
                  offset: -3,
                  fill: axisColor,
                  fontSize: 12,
                }}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  fill: isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)",
                }}
              />
              <Bar
                dataKey="count"
                fill="#4f8ef7"
                radius={[4, 4, 0, 0]}
                maxBarSize={80}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

// ─── Creative Preview: thumbnail + video playback ─────────────────────
const CreativePreview = ({
  d,
  ad,
  ctx,
  isTikTok,
  isLight,
  activeIndex,
  setActiveIndex,
  contained = false,
}) => {
  // Backend splits carousel ads across two fields: the cover image lands in
  // `thumbnail` (image_video_url) and the remaining slides in `carouselMedia`
  // (ad_image_video). A 2-image ad therefore arrives with a single entry in
  // `carouselMedia` plus the cover in `thumbnail`. MasonryCard/AdDetailModal
  // prepend the cover into `carouselImages` and gate on its length — mirror that
  // here, otherwise gating on `carouselMedia.length > 1` (== 1 for such ads) hid
  // the arrows and showed only one image while the card/detail views paged fine.
  const isVideo = isTikTok || ctx.adType.includes('video') || d?.type?.toLowerCase() === 'video';
  const carouselImages = useMemo(() => {
    const media = ad?.carouselMedia || [];
    // `carouselMedia` is already DefaultImage-filtered in mapAdToCard; also skip
    // the cover when it's the placeholder so a broken first slide doesn't render.
    const coverOk = ad?.thumbnail && !ad.thumbnail.includes('DefaultImage');
    // The cover/slide split only applies to IMAGE carousels. A VIDEO ad keeps its
    // poster in `ad_image_video` (a single slide) while its `image_video_url` cover
    // is the SAME creative — prepending it turns one video into a bogus 2-slide
    // carousel. Skip the prepend for videos; genuine carousels (≥2 real slides in
    // `carouselMedia`, image or video) are unaffected.
    if (!isVideo && coverOk && media.length > 0 && !media.includes(ad.thumbnail)) {
      return [ad.thumbnail, ...media];
    }
    return media;
  }, [ad?.thumbnail, ad?.carouselMedia, isVideo]);
  const hasCarousel = carouselImages.length > 1;
  const isTextImageAd = ctx.adType === 'text-image';

  // If carousel exists, use its media. Otherwise use single thumbnail/video logic.
  const currentMedia = hasCarousel ? carouselImages[activeIndex] : null;
  // Prefer `ad.thumbnail` (already-cached grid image) over SSE-arriving URLs to
  // avoid a visible re-fetch when adDetails resolves a few hundred ms after open.
  // The backend uses "/DefaultImage.jpg" as the placeholder for ads with no creative
  // (e.g. TEXT ads); it 404s and renders as "Preview unavailable". Strip it from every
  // source so those ads fall through to the title-based text preview below (like a text
  // ad that carried no image at all). Mirrors the DefaultImage filtering in mapAdToCard.
  const noDefault = (u) => (typeof u === 'string' && u.includes('DefaultImage')) ? null : u;
  const computedThumbnailSrc = noDefault(resolveNasUrl(currentMedia)) || noDefault(ad?.thumbnail) || noDefault(resolveNasUrl(d?.image_video_url)) || noDefault(resolveNasUrl(d?.image_url)) || noDefault(resolveNasUrl(d?.video_cover)) || null;
  // Lock to the first non-null URL we ever computed. Otherwise, when SSE
  // arrives and `processedAd` is re-derived via mapAdToCard, the thumbnail
  // URL can swap out from under us — which resets `imgLoaded` to false and
  // makes the already-visible image vanish. The `key={processedAd.id}` on
  // CreativePreview unmounts/remounts this component for a different ad,
  // resetting the ref naturally — so carousel navigation (which keys on
  // activeIndex via currentMedia) still updates correctly.
  const stableSrcRef = useRef(null);
  if (!stableSrcRef.current && computedThumbnailSrc) {
    stableSrcRef.current = computedThumbnailSrc;
  }
  // Carousel paging needs the source to track activeIndex — only use the
  // locked value for the non-carousel case where stability matters.
  const thumbnailSrc = hasCarousel ? computedThumbnailSrc : (stableSrcRef.current || computedThumbnailSrc);
  const isQuora = ctx.platform === 'quora';
  // NAS-first with live-CDN fallback. `ad` here is processedAd (mapped via
  // mapAdToCard), so `ad.videoUrl`/`ad.videoUrlFallback` already encode the
  // NAS→CDN preference — use them directly so this view resolves identically to
  // MasonryCard and AdDetailModal. The `d`-derived URL is a last-ditch primary
  // for the rare case where the mapped card carries no video URL.
  const liveFromDetail = isQuora
    ? (resolveNasUrl(d?.image_url_original || '') || resolveNasUrl(d?.video_url || ''))
    : (resolveNasUrl(d?.video_url || '') || resolveNasUrl(d?.image_url_original || ''));
  const videoSrc = ad?.videoUrl || liveFromDetail || null;
  const videoSrcFallback = ad?.videoUrlFallback
    || (isQuora ? (resolveNasUrl(d?.video_url || '') || null) : null)
    || null;
  // YouTube and Facebook ads ship their playable URL in `ad_url` (mapped to
  // ad.adUrl) — not in ad.videoUrl — so for those we embed via iframe rather
  // than <video> (which can't decode either platform's watch page).
  const embedUrl = getVideoEmbedUrl(ad?.videoOriginalUrl || ad?.adUrl);

  const aspectStyle = contained && Number(ad?.platform) === 18
    ? { width: "100%", height: "100%", maxHeight: "100%" }
    : {
        ...getAspectStyle(ctx.platform, ctx.position, ad?.aspect_ratio),
        maxHeight: "40vh",
      };

  const [playing, setPlaying] = useState(false);
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const refreshAttempted = useRef(false);
  const videoStallTimerRef = useRef(null);

  const clearVideoStallTimer = useCallback(() => {
    if (videoStallTimerRef.current) {
      clearTimeout(videoStallTimerRef.current);
      videoStallTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearVideoStallTimer(), [clearVideoStallTimer]);

  // Image error / retry state (mirrors MasonryCard pattern)
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgRetryCount, setImgRetryCount] = useState(0);
  const imgRetryTimerRef = useRef(null);
  const MAX_IMG_RETRIES = 2;

  const handleImgError = useCallback(() => {
    setImgRetryCount((prev) => {
      if (prev >= MAX_IMG_RETRIES) {
        setImgError(true);
        return prev;
      }
      const delays = [300, 800];
      imgRetryTimerRef.current = setTimeout(() => {
        setImgRetryCount((c) => c + 1);
      }, delays[prev] || 800);
      setImgError(false);
      return prev;
    });
  }, []);

  // Cached images can fire `load` before React attaches `onLoad`, so the
  // handler never runs and imgLoaded stays false → image stuck at opacity-0.
  // Callback ref runs synchronously on mount; check `complete` to catch this.
  const handleImgRef = useCallback((node) => {
    if (node && node.complete && node.naturalWidth > 0) {
      setImgLoaded(true);
    }
  }, []);

  useEffect(() => {
    setImgError(false);
    setImgLoaded(false);
    setImgRetryCount(0);
    if (imgRetryTimerRef.current) clearTimeout(imgRetryTimerRef.current);
  }, [thumbnailSrc]);

  useEffect(() => () => {
    if (imgRetryTimerRef.current) clearTimeout(imgRetryTimerRef.current);
  }, []);

  const effectiveVideoSrc = resolvedVideoUrl || videoSrc;

  const fetchFromLibraryUrl = useCallback(async () => {
    if (!isTikTok || refreshAttempted.current || !ad?.tiktokLibraryUrl) {
      // No (more) recovery options — make the dead state explicit instead of
      // letting the player buffer forever on an expired CDN URL.
      if (isTikTok && refreshAttempted.current) {
        setPlaying(false);
        setVideoUnavailable(true);
      }
      return;
    }
    refreshAttempted.current = true;
    setIsRefreshing(true);
    try {
      const freshUrl = await fetchFreshTikTokVideoUrl(ad.tiktokLibraryUrl);
      if (freshUrl) { setResolvedVideoUrl(freshUrl); setPlaying(true); }
      else { setPlaying(false); setVideoUnavailable(true); }
    } catch {
      setPlaying(false);
      setVideoUnavailable(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [isTikTok, ad?.tiktokLibraryUrl]);

  // Auto-fetch video when no direct URL is available (e.g. CDN URL missing from adDetails)
  useEffect(() => {
    if (!thumbnailSrc && !effectiveVideoSrc && isTikTok && ad?.tiktokLibraryUrl) {
      fetchFromLibraryUrl();
    }
  }, [thumbnailSrc, effectiveVideoSrc, isTikTok, ad?.tiktokLibraryUrl, fetchFromLibraryUrl]);

  const videoFallbackAttempted = useRef(false);
  const handleVideoError = useCallback(async () => {
    clearVideoStallTimer();
    // TikTok: refresh via library URL if we haven't yet. fetchFromLibraryUrl
    // itself sets `videoUnavailable` when its own attempt fails / is exhausted.
    if (isTikTok && ad?.tiktokLibraryUrl) {
      fetchFromLibraryUrl();
      return;
    }
    // Primary source failed (NAS 410/expiry, or Quora image_url_original) —
    // switch to the live CDN fallback once. Guarded so we don't loop on a dead source.
    if (videoSrcFallback && !videoFallbackAttempted.current) {
      videoFallbackAttempted.current = true;
      setResolvedVideoUrl(videoSrcFallback);
      return;
    }
    // No fallback available — stop trying so we don't loop on a dead source.
    setPlaying(false);
    setVideoUnavailable(true);
  }, [clearVideoStallTimer, videoSrcFallback, isTikTok, ad?.tiktokLibraryUrl, fetchFromLibraryUrl]);

  // 12s without first-frame ⇒ treat as expired. HTMLMediaElement won't always
  // raise `error` for a dead URL (the browser keeps retrying at the network
  // layer), so we have to bound the wait ourselves.
  const handleVideoLoadStart = useCallback(() => {
    clearVideoStallTimer();
    videoStallTimerRef.current = setTimeout(() => {
      handleVideoError();
    }, 12000);
  }, [clearVideoStallTimer, handleVideoError]);

  const handleVideoCanPlay = useCallback(() => {
    clearVideoStallTimer();
  }, [clearVideoStallTimer]);

  // Reset video-unavailable verdict when the source actually changes (carousel
  // page or new ad) so a fresh URL gets a clean chance.
  useEffect(() => {
    setVideoUnavailable(false);
    videoFallbackAttempted.current = false;
    refreshAttempted.current = false;
    setResolvedVideoUrl(null);
    clearVideoStallTimer();
  }, [videoSrc, clearVideoStallTimer]);

  if (!thumbnailSrc && !effectiveVideoSrc) {
    if (isRefreshing) {
      return (
        <div
          className="w-full flex items-center justify-center bg-black"
          style={{ aspectRatio: "4/3" }}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <span className="text-[11px] text-white/50">Loading video…</span>
          </div>
        </div>
      );
    }
    const textTitle = ad?.title || ad?.ad_title || d?.ad_title || '';
    const textBody = ad?.adText || ad?.ad_text || d?.ad_text || ad?.subtitle || d?.text || '';
    const isBanner = ctx.adType === 'banner';
    const isTextImage = ctx.adType === 'text-image';
    return (
      <div
        className={`w-full flex items-center justify-center p-8 ${isLight ? 'bg-gradient-to-br from-indigo-100/60 to-slate-100/60' : 'bg-gradient-to-br from-indigo-950/40 to-slate-900/40'}`}
        style={{ aspectRatio: "4/3" }}
      >
        {isTextImage ? (
          <p className={`text-[15px] font-semibold leading-relaxed text-center line-clamp-6 drop-shadow-lg ${isLight ? 'text-gray-800' : 'text-white'}`}>
            {ad?.textImageTitle || textTitle || ad?.adText || 'Text-Image Ad'}
          </p>
        ) : isBanner ? (
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            {(ad?.subtitle || d?.newsfeed_description) && (
              <p className={`text-sm font-bold leading-snug line-clamp-4 ${isLight ? 'text-gray-800' : 'text-zinc-100'}`}>
                {ad?.subtitle || d?.newsfeed_description}
              </p>
            )}
            {(ad?.adText || d?.ad_text) && (
              <p className={`text-xs leading-relaxed line-clamp-3 ${isLight ? 'text-gray-600' : 'text-zinc-400'}`}>
                {ad?.adText || d?.ad_text}
              </p>
            )}
            {textTitle && (
              <p className={`text-xs line-clamp-2 ${isLight ? 'text-gray-500' : 'text-zinc-500'}`}>
                {textTitle}
              </p>
            )}
          </div>
        ) : (
          <div className="flex max-w-xl flex-col items-center gap-2 text-center">
            {textTitle && (
              <h3 className={`text-[17px] font-semibold leading-snug line-clamp-3 ${isLight ? 'text-gray-900' : 'text-zinc-100'}`}>
                {textTitle}
              </h3>
            )}
            {textBody && (
              <p className={`text-[14px] leading-relaxed whitespace-pre-wrap line-clamp-6 ${isLight ? 'text-gray-700' : 'text-zinc-300'}`}>
                {textBody}
              </p>
            )}
            {!textTitle && !textBody && (
              <p className={`text-[14px] ${isLight ? 'text-gray-500' : 'text-zinc-400'}`}>
                Original text is unavailable.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (isVideo && playing && (effectiveVideoSrc || embedUrl)) {
    return (
      <div className="relative bg-black overflow-hidden w-full" style={{ ...aspectStyle, maxWidth: '100%' }}>
        {effectiveVideoSrc ? (
          <video
            key={effectiveVideoSrc}
            src={effectiveVideoSrc}
            autoPlay
            controls
            className="absolute inset-0 w-full h-full object-contain"
            onEnded={() => setPlaying(false)}
            onError={handleVideoError}
            onLoadStart={handleVideoLoadStart}
            onCanPlay={handleVideoCanPlay}
          />
        ) : (
          <iframe
            key={embedUrl}
            src={embedUrl}
            title="Video ad"
            className="absolute inset-0 w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {isRefreshing && (
          <div className="absolute inset-0 z-10 bg-black/70 flex flex-col items-center justify-center gap-2">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <span className="text-[11px] text-white/70 font-medium">Refreshing video…</span>
          </div>
        )}
      </div>
    );
  }

  const handlePlayClick = () => {
    if (!isVideo) return;
    if (videoUnavailable) return;
    if (effectiveVideoSrc || embedUrl) { setPlaying(true); return; }
    if (ad?.tiktokLibraryUrl) { fetchFromLibraryUrl(); return; }
    // Nothing playable — no direct media URL, no YouTube/Facebook embed, no
    // TikTok refresh path. Mark unavailable so the play affordance hides and
    // the thumbnail stands on its own.
    setVideoUnavailable(true);
  };

  return (
    <div className={`relative ${videoUnavailable ? '' : 'cursor-pointer'} group/carousel`} style={aspectStyle} onClick={handlePlayClick}>
      {/* Thumbnail — only render img if we have a src, avoid spurious onError from null src */}
      {thumbnailSrc && !imgError && (
        <img
          key={`${thumbnailSrc}_${imgRetryCount}`}
          ref={handleImgRef}
          src={thumbnailSrc}
          alt="Ad Preview"
          loading="eager"
          decoding="async"
          fetchpriority="high"
          className={`w-full h-full object-contain group-hover/card:scale-105 transition-transform duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImgLoaded(true)}
          onError={handleImgError}
        />
      )}
      {thumbnailSrc && !imgError && !imgLoaded && (
        <div className="absolute inset-0 media-shimmer pointer-events-none" />
      )}
      {/* Text-Image overlay: dark overlay + centered text on top of background image */}
      {isTextImageAd && thumbnailSrc && !imgError && imgLoaded && (
        <>
          <div className="absolute inset-0 bg-black/40 z-10" />
          <p className="absolute inset-0 z-20 flex items-center justify-center text-[14px] font-semibold leading-relaxed text-white text-center px-6 line-clamp-5 drop-shadow-lg">
            {ad?.textImageTitle || ad?.title || ad?.adText || ''}
          </p>
        </>
      )}
      {/* "Preview unavailable" — only when the thumbnail itself failed. If
          just the video URL is dead but the thumbnail loaded fine, we keep
          the thumbnail visible and rely on hiding the play button to signal
          that playback isn't possible. */}
      {imgError && (
        isQuora && isVideo && effectiveVideoSrc && !videoUnavailable ? (
          // Quora video whose thumbnail 404'd — show a real frame from the video (muted,
          // metadata only; "#t=0.1" paints the frame at 0.1s) instead of "Preview
          // unavailable". Clicking anywhere plays it (container onClick); onError →
          // handleVideoError sets videoUnavailable and this falls back to the text below.
          <video
            key={`poster_${effectiveVideoSrc}`}
            src={`${effectiveVideoSrc}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            onError={handleVideoError}
            className="absolute inset-0 w-full h-full object-contain bg-zinc-900"
          />
        ) : (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-900/70 to-zinc-800/40 pointer-events-none">
            <Image size={28} className="text-zinc-500" strokeWidth={1.5} />
            <span className="text-[10px] font-medium text-zinc-400 tracking-wide">Preview unavailable</span>
          </div>
        )
      )}
      {/* Play button — always show for videos regardless of thumbnail state,
          unless the video URL is known-dead. */}
      {isVideo && !videoUnavailable && (
        <div className="absolute inset-0 flex items-center justify-center">
          {isRefreshing ? (
            <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          ) : (
            <div className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 transition-transform group-hover/card:scale-110">
              <Play fill="white" size={16} className="text-white ml-0.5" />
            </div>
          )}
        </div>
      )}

      {/* Carousel Controls */}
      {hasCarousel && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveIndex((prev) => (prev > 0 ? prev - 1 : carouselImages.length - 1));
            }}
            className={`absolute left-2 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full backdrop-blur-md border shadow-lg transition-all hover:scale-110 active:scale-95 ${isLight ? 'bg-white/80 border-black/10 text-black' : 'bg-black/40 border-white/20 text-white'}`}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveIndex((prev) => (prev < carouselImages.length - 1 ? prev + 1 : 0));
            }}
            className={`absolute right-2 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full backdrop-blur-md border shadow-lg transition-all hover:scale-110 active:scale-95 ${isLight ? 'bg-white/80 border-black/10 text-black' : 'bg-black/40 border-white/20 text-white'}`}
          >
            <ChevronRight size={16} />
          </button>

          {/* Indicators */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5 z-20 px-4 flex-wrap">
            {carouselImages.map((_, idx) => (
              <div
                key={idx}
                onClick={(e) => { e.stopPropagation(); setActiveIndex(idx); }}
                className={`h-1 rounded-full transition-all duration-300 cursor-pointer ${idx === activeIndex
                  ? `w-4 ${isLight ? 'bg-indigo-600' : 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'}`
                  : `w-1 ${isLight ? 'bg-black/20 hover:bg-black/40' : 'bg-white/30 hover:bg-white/50'}`
                  }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// Detail-row icon colors are tuned for the dark theme (Tailwind -400 shades +
// opacity-80), which wash out on the light theme's white background. In light
// mode swap each to a darker, higher-contrast shade and drop the opacity fade.
// NOTE: these are explicit literal strings (not a computed `-600` replace) so
// Tailwind's JIT actually generates the classes instead of purging them.

const OwnerAvatar = ({ imageUrl, ownerName, isLight }) => {
  const [imgError, setImgError] = useState(false);
  const letter = (ownerName || "K")[0];

  if (!imageUrl || imgError) {
    return (
      <div
        className={`w-8 h-8 rounded-lg items-center justify-center text-xs font-black shrink-0 flex ${
          isLight
            ? "bg-[#3762c1]/10 text-[#335296]"
            : "bg-[#3762c1]/10 text-[#6b99ff]"
        }`}
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt=""
      className="w-8 h-8 rounded-lg object-cover shrink-0"
      onError={() => setImgError(true)}
    />
  );
};

const AnalyticsModal = ({
  ad,
  categoryOptions = [],
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  competitiveIntelEnabled = false,
  onOpenKeywordExplorer,
  onOpenAdvertiserProfile,
  onOpenKeywordsExplorer,
  sduiConfig,
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
const isAdmob =
  normalizePlatformSlug(ad?.network || ad?.platform) === "admob";
const insightAdId = isAdmob ? (ad?.internalId ?? ad?.id) : ad?.id;
  const { insights, loading: insightsLoading, notFound: adNotFound, notFoundForId, errors: insightErrors } = useAdInsights(
    insightAdId,
    ad?.network,
    281,
    'en',
    ad?.postOwnerId,
    true,
    ad?.internalId,
  );
  const adDetailsData = insights.adDetails?.[0] || insights.adDetails || null;
  const tiktokAnalytics = insights.analytics || null;
  const isTransparency =
    Number(ad?.platform) === 18 ||
    ad?.isGoogleTransparency === true ||
    Number(adDetailsData?.platform) === 18;
  const isTikTok =
    normalizePlatformSlug(ad?.network || ad?.platform) === "tiktok";
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const scrollRef = useRef(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [creativeClosed, setCreativeClosed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [regionExpanded, setRegionExpanded] = useState(false);
  const [openInfoTooltip, setOpenInfoTooltip] = useState(null);

  useEffect(() => {
    setActiveIndex(0);
    setRegionExpanded(false);
    setOpenInfoTooltip(null);
  }, [ad]);

  useEffect(() => {
    if (!openInfoTooltip) return;
    const closeTooltip = () => setOpenInfoTooltip(null);
    document.addEventListener("click", closeTooltip);
    return () => document.removeEventListener("click", closeTooltip);
  }, [openInfoTooltip]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setCreativeClosed(false);
    const onScroll = () => {
      setScrollProgress(el.scrollTop);
      if (el.scrollTop === 0) setCreativeClosed(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ad]);

  useEffect(() => {
    if (!ad) return;
    const handler = (e) => {
      if (e.key === "ArrowLeft" && hasPrev) onPrev?.();
      if (e.key === "ArrowRight" && hasNext) onNext?.();
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ad, hasPrev, hasNext, onPrev, onNext, onClose]);

  const creativeInitialWidth = useMemo(() => {
    const style = getAspectStyle(
      ad?.platform,
      ad?.ad_position || ad?.position,
      ad?.aspect_ratio,
    );
    if (!style.aspectRatio) return 22;
    const parts = style.aspectRatio.split("/");
    const ratio = parseFloat(parts[0]) / parseFloat(parts[1]);
    if (ratio >= 1.4) return 28;
    if (ratio >= 1) return 22;
    return 18;
  }, [ad]);
  const floatingCreativeWidth = Math.max(
    10,
    creativeInitialWidth -
      Math.min(scrollProgress / 8, creativeInitialWidth - 10),
  );
  const transparencyPreviewSpace = creativeClosed
    ? "0%"
    : `${floatingCreativeWidth + 3}%`;

  const processedAd = useMemo(() => {
    if (!ad) return null;
    if (ad.carouselMedia?.length > 1 && !ad._fromUrl) return ad;
    // For TikTok, media fields live in tiktokAnalytics (analytics SSE event), not adDetails
    const rawSource = isTikTok
      ? { ...ad, ...(tiktokAnalytics || {}), ...(adDetailsData || {}) }
      : { ...ad, ...(adDetailsData || {}) };
    if (adDetailsData || tiktokAnalytics) {
      let merged = mapAdToCard(rawSource);
      if (!merged.videoUrl && ad.videoUrl) merged.videoUrl = ad.videoUrl;
      // Always prefer the original `ad.thumbnail` (the URL already cached by
      // MasonryCard / AdDetailModal) over whatever `mapAdToCard` derived from
      // SSE fields. For TikTok specifically, `mapAdToCard` resolves thumbnail
      // from `video_cover` first when `tiktokAnalytics` arrives, producing a
      // different URL than what the grid endpoint returned — and the user
      // ends up seeing a different image in this modal than in the card and
      // detail view. Falling back to `merged.thumbnail` only when there's no
      // original keeps coverage for ads that legitimately had no grid image.
      merged.thumbnail = ad.thumbnail || merged.thumbnail;
      // Popularity must match the grid/card value so the star rating in this
      // modal agrees with MasonryCard and AdDetailModal. The analytics SSE
      // payload can carry a different (or differently-shaped) popularity field,
      // which would otherwise make the same ad show a different rating here.
      merged.popularity = ad.popularity ?? merged.popularity;
      if (isTransparency) {
        if (!merged.countryDetails?.length && ad.countryDetails?.length) {
          merged.countryDetails = ad.countryDetails;
        }
        merged.impressionRange = merged.impressionRange || ad.impressionRange || null;
        // The common search contract distinguishes producer values from SQL
        // operational fallbacks. Keep those nullable card values authoritative
        // even if the legacy insights endpoint returns a generated SQL date.
        // Search-card values are authoritative because they preserve producer
        // nulls. A direct /google/:id visit has only a small URL placeholder,
        // though, so it must keep the values hydrated by getAdInsights instead
        // of overwriting them with missing properties.
        merged = mergeTransparencyDateContract(merged, ad);
        merged.subnetwork = merged.subnetwork || ad.subnetwork || null;
      }
      if (!merged.tiktokLibraryUrl && ad.tiktokLibraryUrl) merged.tiktokLibraryUrl = ad.tiktokLibraryUrl;
      if (!merged.network && ad.network) merged.network = ad.network;
      return merged;
    }
    return ad;
  }, [ad, adDetailsData, tiktokAnalytics, isTikTok, isTransparency]);

  const ctx = useMemo(() => {
    const a = processedAd || ad || {};
    // Prefer platform_network from adDetails (backend canonical), then fall back to card network
    const platform = normalizePlatformSlug((adDetailsData?.platform_network) || a.network || a.platform || 'facebook');
    // `ad_type` is NOT the media-type string on most networks' raw detail rows —
    // e.g. Instagram's `instagram_ad.ad_type` SQL column is an unrelated numeric
    // flag (0/1), while the real IMAGE/VIDEO/STORIES/CAROUSEL value lives in the
    // `type` column (selected as `type` by every network's search controller).
    // `adType` (camelCase) is the frontend's own card-level normalized field
    // (services/api.js) and takes priority when present; `a.type` is the raw
    // fallback so a detail-only fetch (which lacks that normalization) still
    // resolves the real value instead of silently defaulting to 'image'.
    const adType = String(a.adType || a.type || a.ad_type || 'image').toLowerCase();
    const position = String(a.ad_position || a.position || '').toLowerCase();
    const platformRules = ENGAGEMENT_RULES[platform] || ENGAGEMENT_RULES.facebook;
    let rules = platformRules[position] || platformRules[adType] || platformRules._default || {};
    if (platform === 'facebook' && adType.includes('video') && platformRules._videoOverride) rules = platformRules._videoOverride;
    let typeKey = Object.keys(AD_TYPE_CONFIG).find(k => adType.includes(k)) || 'image';
    const typeBadge = AD_TYPE_CONFIG[typeKey];
    const likes = a.likes || 0;
    const views = a.views || 0;
    const impressions = typeof a.impressions === "object" ? 0 : (a.impressions || 0);
    const shares = a.share || a.shares || 0;
    const comments = a.comments || 0;
    const popularity = a.popularity || 0;
    const runningDays = calculateRunningDays({
      lastSeen: a.last_seen ?? a.lastSeenRaw ?? a.lastSeen,
      postDate: a.post_date ?? a.postDateRaw ?? a.date,
      firstSeen: a.first_seen ?? a.firstSeenRaw ?? a.firstSeen,
    });
    const items = [];
    // Engagement icons share MasonryCard's STAT_CONFIG base palette but route through
    // iconColorClass so they darken for good contrast in light theme (same as the Ad
    // Details rows) instead of staying pale on white.
    // dim=false → full-strength icons (higher contrast than the softer detail rows), per tester feedback.
    if (likes) items.push({ key: 'likes', label: 'Likes', value: likes, icon: <ThumbsUp size={13} className={`lucide lucide-thumbs-up ${iconColorClass('text-[#6b99ff]', isLight, false)}`} /> });
    if (comments) items.push({ key: 'comments', label: 'Comments', value: comments, icon: <MessageCircle size={13} className={`lucide lucide-message-circle ${iconColorClass('text-yellow-400', isLight, false)}`} /> });
    if (shares) items.push({ key: 'shares', label: 'Shares', value: shares, icon: <Share2 size={13} className={`lucide lucide-share2 ${iconColorClass('text-emerald-400', isLight, false)}`} /> });
    if (views) items.push({ key: 'views', label: 'Views', value: views, icon: <Eye size={13} className={`lucide lucide-eye ${iconColorClass('text-slate-400', isLight, false)}`} /> });
    if (impressions) items.push({ key: 'impressions', label: 'Impressions', value: impressions, icon: <TrendingUp size={13} className={`lucide lucide-trending-up ${iconColorClass('text-violet-400', isLight, false)}`} /> });
    if (popularity > 0) items.push({ key: 'popularity', label: 'Popularity', value: popularity, isStars: true });
    return { platform, adType, position, typeBadge, runningDays, engagementItems: items, hasEngagement: items.length > 0 };
  }, [processedAd, ad, isLight]);

  // Interests/behaviours for the Target Audience panel. Reads from ES (adDetails)
  // on a cache hit; on a miss it calls the targeting API directly from the browser
  // (visible in the Network tab) and caches the result back to ES.
  const audience = useInterestBehaviour({
    adId: ad?.id,
    network: ctx.platform,
    adDetails: adDetailsData,
  });

  if (!ad) return null;

  // Show 404 immediately when backend sends code:404 for adDetails event — don't wait for SSE stream to finish
  if (adNotFound && notFoundForId === ad?.id) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 text-center p-8">
          <span className="text-7xl font-black text-white/80">404</span>
          <p className="text-lg font-bold text-white/80">Ad not found</p>
          <p className="text-sm font-bold text-white/80">This ad may have been removed or the link is invalid.</p>
          <button
            onClick={() => onClose?.()}
            className="mt-2 px-5 py-2 rounded-lg bg-[#3762c1] text-white text-sm font-semibold hover:bg-[#4a75d4] transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (insightsLoading && !processedAd) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  if (!processedAd) return null;
  const admobCountry = isAdmob
    ? (processedAd.countries || ad?.countries || [])
        .map((country) => ({ country: String(country).trim() }))
        .filter((item) => item.country)
    : null;
  // For TikTok, media fields (video_cover, video_url) come from the analytics SSE event, not adDetails
  const d = isTikTok
    ? { ...(adDetailsData || {}), ...(tiktokAnalytics || {}), ...(ad || {}) }
    : isTransparency
      ? { ...(ad || {}), ...(processedAd || {}), ...(adDetailsData || {}) }
      : (adDetailsData || ad || {});
  // `getAdCategory` provides AI-Meta independently from the SQL-first details
  // stream. Fall back to an inline value for callers that already include it.
  const aiMeta = insights.aiMeta || d.ai_meta || processedAd?.ai_meta || ad?.ai_meta || null;
  const aiMetaScorecard = buildAiMetaScorecard(aiMeta);
  const hasAiMetaScorecard = Boolean(
    aiMetaScorecard.attributes.length ||
    aiMetaScorecard.caption ||
    aiMetaScorecard.evidence.length
  );
  const firstAvailable = (...values) =>
    values.find((value) => value != null && value !== "");
  // AdMob lander data is indexed under dedicated fields instead of the
  // legacy screenshot keys used by Facebook-family payloads.
  const landerScreenshotUrl = firstAvailable(
    adDetailsData?.lander_screen_shot,
    processedAd?.lander_screen_shot,
    ad?.lander_screen_shot,
    adDetailsData?.screenshot_url,
    ad?.screenshot_url,
    adDetailsData?.white_ad_screenshot,
    ad?.white_ad_screenshot,
  );
  const landerVisitUrl = ctx?.platform === "admob"
    ? firstAvailable(
      adDetailsData?.lander_destination_url,
      processedAd?.lander_destination_url,
      ad?.lander_destination_url,
      adDetailsData?.destination_url,
      processedAd?.destination_url,
      ad?.destination_url,
      processedAd?.destinationUrl,
      ad?.destinationUrl,
    )
    : null;
  const landerWhatsappEntries = ctx?.platform === "admob"
    ? firstAvailable(
      adDetailsData?.whatsapp,
      processedAd?.whatsapp,
      ad?.whatsapp,
    )
    : undefined;
  const landerWhatsappRotatorCount = ctx?.platform === "admob"
    ? firstAvailable(
      adDetailsData?.whatsapp_rotator_count,
      adDetailsData?.whatsappRotatorCount,
      processedAd?.whatsapp_rotator_count,
      processedAd?.whatsappRotatorCount,
      ad?.whatsapp_rotator_count,
      ad?.whatsappRotatorCount,
      0,
    )
    : undefined;
  const analyticsRunningDays = calculateRunningDays({
    lastSeen: firstAvailable(
      d.last_seen,
      processedAd?.lastSeenRaw,
      ad?.lastSeenRaw,
      processedAd?.lastSeen,
      ad?.lastSeen,
    ),
    postDate: firstAvailable(
      d.post_date,
      processedAd?.postDateRaw,
      ad?.postDateRaw,
      processedAd?.date,
      ad?.date,
    ),
    firstSeen: firstAvailable(
      d.first_seen,
      processedAd?.firstSeenRaw,
      ad?.firstSeenRaw,
      processedAd?.firstSeen,
      ad?.firstSeen,
    ),
  });
  const analyticsActiveDays = d.days_running
    ?? d.runningDays
    ?? processedAd?.days_running
    ?? processedAd?.runningDays
    ?? ad?.days_running
    ?? ad?.runningDays
    ?? analyticsRunningDays;
  const analyticsOccurrenceCount = d.occurrence_count ?? processedAd?.occurrence_count ?? ad?.occurrence_count
    ?? processedAd?.occurrenceCount ?? ad?.occurrenceCount;
  // Falls back to occurrence_count + active_days (both already shown above
  // and already live-correct) for an ES doc indexed before this field
  // existed, instead of just disappearing until that ad is re-scanned.
  const analyticsPosterIntelligence = d.poster_intelligence_score ?? processedAd?.poster_intelligence_score ?? ad?.poster_intelligence_score
    ?? processedAd?.posterIntelligenceScore ?? ad?.posterIntelligenceScore
    ?? (Number(analyticsOccurrenceCount) > 0 || Number(analyticsActiveDays) > 0
      ? Number(analyticsOccurrenceCount || 0) + Number(analyticsActiveDays || 0)
      : null);
  const admobSessionsData =
    isAdmob && insights.admobSessions && typeof insights.admobSessions === "object"
      ? insights.admobSessions
      : null;
  const admobSessionRows = Array.isArray(admobSessionsData?.sessions)
    ? admobSessionsData.sessions
    : [];
  // Group rows by session_id — the same session can now have more than one
  // row (one per app that reported this ad within it), so the Sighting Log
  // shows one block per session with each app's count listed inside it,
  // instead of flat rows that just happen to repeat the same session_id.
  const admobSessionGroups = (() => {
    const order = [];
    const bySession = new Map();
    for (const row of admobSessionRows) {
      const key = row.session_id || `unknown-${order.length}`;
      let group = bySession.get(key);
      if (!group) {
        group = { session_id: row.session_id, observed_at: row.observed_at, apps: [] };
        bySession.set(key, group);
        order.push(key);
      } else if (row.observed_at && (!group.observed_at || row.observed_at > group.observed_at)) {
        group.observed_at = row.observed_at;
      }
      group.apps.push({ name: row.source_app || null, count: Number(row.repeat_count || 1) });
    }
    return order.map((key) => bySession.get(key));
  })();
  const admobSessionsTotal = Number(
    admobSessionsData?.sessions_total ?? analyticsOccurrenceCount ?? 0,
  );
  const admobTrackedSessionsTotal = Number(admobSessionsData?.total_sessions || 0);
  const admobOccurrenceRatePercent = Number(
    admobSessionsData?.occurrence_rate_percent ?? 0,
  );
  // Same source_app_id-vs-name mismatch as sessions_seen_by_app below — collapse
  // by name so the same app doesn't appear twice with its count split across
  // two internal source_app_id rows.
  const admobTrackedSessionsByApp = Array.from(
    (Array.isArray(admobSessionsData?.tracked_sessions_by_app)
      ? admobSessionsData.tracked_sessions_by_app
      : []
    )
      .filter((row) => row?.name)
      .reduce((map, row) => {
        const existing = map.get(row.name);
        if (existing) {
          existing.count = (existing.count || 0) + (row.count || 0);
        } else {
          map.set(row.name, { ...row });
        }
        return map;
      }, new Map())
      .values()
  );
  // Per-app "how many times THIS ad was seen in THIS app" — sourced from
  // mob_ad_source_apps.appearance_count, which is recorded per (ad, app)
  // pair at ingestion time. Unlike tracked_sessions_by_app (session count
  // scoped by app-wide activity, not this ad specifically), this stays
  // accurate even when an ad is linked to multiple source apps.
  // The backend can emit multiple source_app_id rows for the same app name
  // (e.g. differing package values across observations) — collapse by name
  // so the summary shows one "App: Nx" entry per distinct app, counts merged.
  const admobSessionsSeenByApp = Array.from(
    (Array.isArray(admobSessionsData?.sessions_seen_by_app)
      ? admobSessionsData.sessions_seen_by_app
      : []
    )
      .filter((row) => row?.name)
      .reduce((map, row) => {
        const existing = map.get(row.name);
        if (existing) {
          existing.count = (existing.count || 0) + (row.count || 0);
        } else {
          map.set(row.name, { ...row });
        }
        return map;
      }, new Map())
      .values()
  );
  const hasAdmobSessionHistory =
    isAdmob && (admobSessionRows.length > 0 || admobSessionsTotal > 0);
  const postOwnerId = processedAd.postOwnerId || ad?.postOwnerId || insights.advertiserLCSDataMeta?.post_owner_id || insights.advertiserCountryDataMeta?.post_owner_id || insights.advertiserUserDataMeta?.post_owner_id;
  const availableYears = insights.advertiserLCSDataMeta?.available_years || insights.advertiserCountryDataMeta?.available_years || insights.advertiserUserDataMeta?.available_years || [];

  const rawTitleStr = (processedAd.carouselTitles?.length > activeIndex ? processedAd.carouselTitles[activeIndex] : processedAd.title) || '';
  const currentTitle = rawTitleStr.replace(/^,|,$/g, '').trim();

  const fmtDate = (val) => {
    if (!val) return '—';
    const num = Number(val);
    if (!isNaN(num) && /^\d{9,13}$/.test(String(val).trim())) {
      const ms = num < 1e10 ? num * 1000 : num;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    const s = String(val);
    if (s.includes('T')) return s.split('T')[0];
    if (s.includes(' ')) return s.split(' ')[0];
    return s;
  };
  const fmtFriendlyDateTime = (val) => {
    if (!val) return '-';
    const date = new Date(val);
    if (Number.isNaN(date.getTime())) return String(val);
    return date.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  };
  const fmtDateTime = (val) => {
    if (!val) return '-';
    const date = new Date(val);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 19).replace('T', ' ');
    }
    return String(val);
  };
  const transparencyDate = (val) => {
    return formatTransparencyCalendarDate(val);
  };
  // Domain Reg Date only: WHOIS often has no data → date defaults to the Unix epoch
  // ("1970-01-01", or "1969-12-31" after a tz shift) / a zero-date. No real domain
  // predates the epoch, so show an em-dash for those (the ad itself still lists).
  const fmtDomainRegDate = (val) => {
    const out = fmtDate(val);
    if (out === '—' || out === '0000-00-00' || out === '0001-01-01') return '—';
    const ts = Date.parse(out);
    if (!isNaN(ts) && ts <= 0) return '—';
    return out;
  };
  const renderDetailValueList = (value) => {
    if (value === "—") return "—";

    const items = [...new Set(
      (Array.isArray(value) ? value : String(value).split(","))
        .map((item) => String(item).trim())
        .filter(Boolean),
    )];

    return (
      <div className="flex max-w-[60%] flex-col items-end gap-1.5 text-right">
        {items.map((item) => (
          <span
            key={item}
            className={`rounded-lg border px-2.5 py-1 text-[13px] font-semibold leading-tight ${
              isLight
                ? "border-gray-200 bg-white text-gray-900"
                : "border-white/15 bg-white/5 text-white/85"
            }`}
          >
            {item}
          </span>
        ))}
      </div>
    );
  };
  const hasDisplayableAdmobValue = (value) => {
    if (Array.isArray(value)) return value.some(hasDisplayableAdmobValue);
    if (value === null || value === undefined) return false;
    if (typeof value === "object") return Object.values(value).some(hasDisplayableAdmobValue);
    const normalized = String(value).trim().toLowerCase();
    return !["", "-", "--", "—", "na", "n/a", "null", "undefined"].includes(normalized);
  };
  const hasAdmobDemographics =
    hasDisplayableAdmobValue(insights.userData) ||
    hasDisplayableAdmobValue(insights.advertiserUserData);
  const detailRows = (() => {
    const tt = tiktokAnalytics || {};
    if (isTikTok)
      return [
        {
          label: "FIRST SEEN",
          value: fmtDate(tt.first_seen || d.first_seen),
          icon: Calendar,
          color: "text-blue-400",
        },
        {
          label: "LAST SEEN",
          value: fmtDate(tt.last_seen || d.last_seen),
          icon: Activity,
          color: "text-emerald-400",
        },
        {
          label: "RUNNING DAYS",
          value: analyticsRunningDays ? `${analyticsRunningDays} days` : "—",
          icon: Clock,
          color: "text-orange-400",
        },
        {
          label: "AD LANGUAGE",
          value: formatLanguage(tt.language || d.language || d.lang),
          icon: Globe,
          color: "text-[#6b99ff]",
        },
        {
          label: "AD TYPE",
          // AdMob's own type vocabulary (INTERSTITIAL_OR_NATIVE, PLAY_STORE_AD,
          // etc.) doesn't map onto the shared image/video/carousel badge system
          // below — read the label straight from the SDUI `ad_types` filter
          // (admin-curated, already has a friendly label per raw value) so any
          // future admob type value shows correctly without a code change.
          value: isAdmob ? resolveAnalyticsFilterValueLabel(sduiConfig, 'ad_types', d.type) : ctx.typeBadge.label,
          icon: Monitor,
          color: "text-pink-400",
        },
        {
          label: "REGION",
          value: (tt.countries || ad?.countries || []).slice(0, 8).join(", ") || "—",
          fullValue: (tt.countries || ad?.countries || []).join(", ") || "—",
          expandable: (tt.countries || ad?.countries || []).length > 8,
          icon: MapPin,
          color: "text-yellow-400",
        },
        {
          label: "Category",
          // Prefer the clicked ad's own industry (the same value the card and
          // AdDetailModal show) over the analytics re-fetch. `getAnalytics`
          // resolves the ad by sql_id and can land on a different underlying ES
          // doc when duplicates share a sql_id, giving a category that doesn't
          // match the ad the user opened. Reading `ad.industry` first keeps the
          // Analytics category consistent with the Ad Details popup.
          value: ad?.industry || tt.industry || "—",
          icon: Tag,
          color: "text-cyan-400",
        },
      ];
    const rows = [
      {
        label: "FIRST SEEN",
        value: isTransparency
          ? transparencyDate(processedAd?.firstSeenRaw ?? ad?.firstSeenRaw)
          : fmtDate(d.first_seen),
        icon: Calendar,
        color: "text-blue-400",
      },
      {
        label: "LAST SEEN",
        value: isTransparency
          ? transparencyDate(processedAd?.lastSeenRaw ?? ad?.lastSeenRaw)
          : fmtDate(d.last_seen),
        icon: Activity,
        color: "text-emerald-400",
      },
      // Quora hides POST DATE and RUNNING DAYS: the crawler's post_date for Quora
      // is unreliable, so we surface neither it nor the running-days figure derived
      // from it. Other networks keep both rows.
      ...(ctx.platform === 'quora' ? [] : [{
        label: "POST DATE",
        // Old rows can carry the epoch-0 (1970-01-01), zero-date (0000-00-00) or ES sentinel
        // (0001-01-01) when the crawler never supplied a real publish date — show "—" (no date)
        // instead of the garbage value.
        value: (() => {
          if (isTransparency) return "--";
          const pd = fmtDate(d.post_date);
          if (!pd || pd === '—' || pd.startsWith('1970-01-01') || pd.startsWith('0000-00-00') || pd.startsWith('0001-01-01')) return '—';
          return pd;
        })(),
        icon: Hash,
        color: "text-purple-400",
      }]),
      ...(ctx.platform === 'quora' ? [] : [{
        label: isAdmob ? "ACTIVE DAYS" : "RUNNING DAYS",
        value: (isAdmob ? analyticsActiveDays : analyticsRunningDays) != null
          ? `${isAdmob ? analyticsActiveDays : analyticsRunningDays} days`
          : "—",
        icon: Clock,
        color: "text-orange-400",
      }]),
      ...(isAdmob ? [
        ...(Number(analyticsOccurrenceCount) > 0 ? [{
          label: "AD OCCURRENCE COUNT",
          value: String(analyticsOccurrenceCount),
          icon: Activity,
          color: "text-cyan-400",
          tooltip: "Total times we've seen this ad, adding up every session it showed up in.",
        }] : []),
        ...(Number(analyticsPosterIntelligence) > 0 ? [{
          label: "POSTER INTELLIGENCE",
          value: String(analyticsPosterIntelligence),
          icon: TrendingUp,
          color: "text-violet-400",
          tooltip: "A score based on how often this ad shows up and how long it's stayed active. Higher means a stronger ad.",
        }] : []),
      ] : []),
      {
        label: "AD LANGUAGE",
        value: isTransparency && !(d.language || d.lang || d.adLanguage || d.ad_language)
          ? "--"
          : formatLanguage(d.language || d.lang || d.adLanguage || d.ad_language),
        icon: Globe,
        color: "text-[#6b99ff]",
      },
      {
        label: "AD TYPE",
        // See the other "AD TYPE" row above — same SDUI-driven lookup so
        // AdMob's own type vocabulary always shows its admin-curated label.
        value: isAdmob ? resolveAnalyticsFilterValueLabel(sduiConfig, 'ad_types', d.type) : ctx.typeBadge.label,
        icon: Monitor,
        color: "text-pink-400",
      },
      {
        label: isTransparency ? "PLATFORM" : "AD POSITION",
        value: (() => {
          if (isTransparency) {
            const platformName = d.subnetwork || processedAd?.subnetwork || ad?.subnetwork;
            return platformName ? String(platformName).toUpperCase() : "--";
          }
          const pos = d.ad_position || ad?.adPosition || ad?.position || "";
          return pos ? formatPosition(pos) : "—";
        })(),
        icon: MapPin,
        color: "text-yellow-400",
      },
      ...(isAdmob ? [{
        label: "SUB NETWORK",
        value: (() => {
          const value = d.sub_network || d.subnetwork || ad?.subnetwork || processedAd?.subnetwork;
          return value ? String(value).toUpperCase() : "—";
        })(),
        icon: Share2,
        color: "text-fuchsia-400",
      }] : []),
      // YouTube display ads surfaced under GDN: show their true source platform + placement.
      // ytSourced comes from the card; the placement check also catches deep-link opens
      // (SEARCHFEED/HOMEFEED/DISCOVERY are YouTube-only positions, never native GDN).
      ...((ad?.ytSourced || /SEARCHFEED|HOMEFEED|DISCOVERY/.test(String(d.ad_position || ad?.adPosition || "").toUpperCase())) ? [{
        label: "SHOWN ON",
        value: (() => {
          const pos = String(d.ad_position || ad?.adPosition || "").toUpperCase();
          const place = pos.includes("SEARCHFEED") ? "Search / Discovery feed"
            : pos.includes("HOMEFEED") ? "Home feed"
            : pos.includes("COMPANION") ? "Companion banner"
            : pos.includes("SIDE") ? "Side rail" : "";
          return place ? `YouTube · ${place}` : "YouTube";
        })(),
        icon: Youtube,
        color: "text-red-500",
      }] : []),
      {
        label: "SOURCE",
        value: formatSource(d.source) || "—",
        icon: ExternalLink,
        color: "text-[#5f8ae7]",
      },
      {
        label: "DOMAIN",
        value: formatDomainValue(d.domain, ad?.domain),
        icon: Globe,
        color: "text-cyan-400",
      },
      {
        label: "DOMAIN REG DATE",
        value: fmtDomainRegDate(d.domain_registered_date),
        icon: Calendar,
        color: "text-teal-400",
      },
      {
        label: "CATEGORY",
        value: (() => {
          const p = ctx.platform;
          const cat = processedAd?.category || ad?.[`${p}.category`] || d[`${p}.category`] || d.ad_category || d.category || ad?.category;
          if (!cat || String(cat).trim().toLowerCase() === 'default') return "—";
          const sub = ad?.[`${p}.subCategory`] || d[`${p}.subCategory`] || d.subCategory || ad?.subCategory;
          // An ad stores a single major category, but its subcategory may belong
          // to several (e.g. "Higher education" → "Education" and "Education and
          // Careers"). Show every major category the subcategory falls under, not
          // just the one stored on the ad. Falls back to the stored value when the
          // taxonomy is unavailable or has no match.
          const cats = resolveAdCategories(cat, sub, categoryOptions);
          if (cats.length) return cats.join(", ");
          return Array.isArray(cat) ? cat.join(", ") : String(cat);
        })(),
        renderValue: renderDetailValueList,
        icon: Layers,
        color: "text-violet-400",
      },
      {
        label: "SUB CATEGORY",
        value: (() => {
          const p = ctx.platform;
          const sub = ad?.[`${p}.subCategory`] || d[`${p}.subCategory`] || d.subCategory || ad?.subCategory;
          if (!sub) return "—";
          return Array.isArray(sub) ? sub.join(", ") : String(sub);
        })(),
        renderValue: renderDetailValueList,
        icon: Layers,
        color: "text-fuchsia-400",
      },
      {
        label: "AFFILIATE NETWORK",
        value: (() => {
          const aff = d.affiliate_data;
          if (!aff) return "—";
          const raw = Array.isArray(aff) ? aff.join(", ") : String(aff);
          // Normalize API identifiers and legacy spellings for display.
          return raw
            .replace(/\beBay_Partner_Network\b/gi, "eBay Partner Network")
            .replace(/\bclickbank\b/gi, "ClickBank");
        })(),
        icon: DollarSign,
        color: "text-green-400",
      },
      {
        label: "MARKETING PLATFORM",
        value: (() => {
          const platforms = detectMarketingPlatforms(d, ad, insights);
          return platforms.length ? platforms.join(", ") : "—";
        })(),
        renderValue: (value) => {
          if (value === "—") return "—";
          const platforms = value.split(", ");
          return (
            <div className="flex flex-wrap justify-end gap-1 max-w-[75%]">
              {platforms.map((name, i) => (
                <span
                  key={i}
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border leading-tight ${
                    isLight
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                      : "bg-indigo-500/10 border-indigo-400/30 text-indigo-300"
                  }`}
                  title={name}
                >
                  {name}
                </span>
              ))}
            </div>
          );
        },
        icon: Megaphone,
        color: "text-indigo-400",
      },
      {
        label: "ECOMMERCE PLATFORM",
        value: (() => {
          const ec = d.built_with || processedAd?.builtWith || ad?.builtWith;
          if (!ec) return "—";
          return Array.isArray(ec) ? ec.join(", ") : String(ec);
        })(),
        renderValue: (value) => {
          if (value === "—") return "—";
          const items = value.split(", ");
          return (
            <div className="flex flex-wrap justify-end gap-1 max-w-[75%]">
              {items.map((name, i) => (
                <span
                  key={i}
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border leading-tight ${
                    isLight
                      ? "bg-sky-50 border-sky-200 text-sky-700"
                      : "bg-sky-500/10 border-sky-400/30 text-sky-300"
                  }`}
                  title={name}
                >
                  {name}
                </span>
              ))}
            </div>
          );
        },
        icon: BarChart3,
        color: "text-sky-400",
      },
      {
        label: "FUNNEL",
        value: (() => {
          const funnel = d.built_with_analytics_tracking || processedAd?.builtWithFunnel || ad?.builtWithFunnel;
          if (!funnel) return "—";
          return Array.isArray(funnel) ? funnel.join(", ") : String(funnel);
        })(),
        renderValue: (value) => {
          if (value === "—") return "—";
          const items = value.split(", ");
          return (
            <div className="flex flex-wrap justify-end gap-1 max-w-[75%]">
              {items.map((name, i) => (
                <span
                  key={i}
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border leading-tight ${
                    isLight
                      ? "bg-amber-50 border-amber-200 text-amber-700"
                      : "bg-amber-500/10 border-amber-400/30 text-amber-300"
                  }`}
                  title={name}
                >
                  {name}
                </span>
              ))}
            </div>
          );
        },
        icon: Zap,
        color: "text-amber-400",
      },
    ];
    return isTransparency
      ? rows.filter((item) => hasTransparencyDetailValue(item.value))
      : rows;
  })();
  const visibleDetailRows = detailRows.filter((item) => {
    if (isAdmob) return hasDisplayableAdmobValue(item.value);
    return !(
      ["FUNNEL", "AFFILIATE", "ECOMMERCE PLATFORM", "CATEGORY", "SUB CATEGORY"].includes(item.label) &&
      item.value === "—"
    );
  });

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-xl animate-in fade-in zoom-in-95 ${isLight ? "bg-black/40" : "bg-[#0a0a0a]/90"}`}
    >
      {hasPrev && (
        <button
          onClick={onPrev}
          className={`absolute left-2 top-1/2 -translate-y-1/2 z-[210] w-9 h-9 rounded-full flex items-center justify-center transition-all backdrop-blur-sm border-2 ${isLight ? "bg-white/80 border-black/30" : "bg-white/5 border-white/30"}`}
          title="Previous (←)"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      {hasNext && (
        <button
          onClick={onNext}
          className={`absolute right-2 top-1/2 -translate-y-1/2 z-[210] w-9 h-9 rounded-full flex items-center justify-center transition-all backdrop-blur-sm border-2 ${isLight ? "bg-white/80 border-black/30" : "bg-white/5 border-white/30"}`}
          title="Next (→)"
        >
          <ChevronRight size={18} />
        </button>
      )}
      <div
        className={`w-full max-w-[1240px] rounded-[32px] overflow-hidden flex flex-col relative group border-2 ${isLight ? "bg-white border-black/30 shadow-2xl" : "bg-[#0e0e0e] border-white/30 shadow-[0_0_100px_rgba(0,0,0,0.8)]"}`}
        style={{ maxHeight: "94vh" }}
      >
        {!isLight && (
          <div className="absolute top-0 left-1/4 w-1/2 h-64 bg-[#3762c1]/10 blur-[120px] opacity-50" />
        )}
        {/* platform is a display label only: YouTube DISPLAY ads surfaced under
            GDN show "GDN" here (ad.badgeNetwork), while ctx.platform stays
            'youtube' so the metrics render from the YouTube insights data. */}
        <AnalyticsHeader
          adId={ad?.id}
          platform={ad?.badgeNetwork || ctx.platform}
          onClose={onClose}
        />
        {!creativeClosed && (
          <div
            className="hidden lg:block absolute right-6 top-16 z-30 transition-all duration-300 ease-in-out overflow-hidden"
            style={{
              width: `${floatingCreativeWidth}%`,
              maxWidth: 'calc(100% - 1.5rem)',
            }}
          >
            <div
              className={`rounded-xl overflow-hidden group/card relative shadow-xl ${isLight ? "bg-gray-50 shadow-black/10" : "bg-[#131313] shadow-black/50"}`}
              style={{ maxHeight: "40vh" }}
            >
              <CreativePreview
                key={processedAd.id}
                d={d}
                ad={processedAd}
                ctx={ctx}
                isTikTok={isTikTok}
                isLight={isLight}
                activeIndex={activeIndex}
                setActiveIndex={setActiveIndex}
              />
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto scrollbar-thin modal-scroll py-4 relative z-10"
        >
          {/* ── Hero Section ────────────────────────────────────── */}
          <div
            className="px-6 pb-6"
            style={{ marginRight: `${creativeInitialWidth + 3}%` }}
          >
            <div className="space-y-4">
              {/* Advertiser */}
              <div className="flex items-center gap-2.5">
                <OwnerAvatar
                  imageUrl={resolveNasUrl(d?.post_owner_image) || ad?.advertiserImage || null}
                  ownerName={d?.post_owner || ad?.post_owner || ad?.advertiser}
                  isLight={isLight}
                />
                <span
                  className={`text-[18px] font-semibold block truncate min-w-0 ${isLight ? "text-gray-800" : "text-white/90"}`}
                >
                  {d?.post_owner || ad?.post_owner || ad?.advertiser}
                </span>
              </div>

              {/* Marketing Platform + Ecommerce Platform + Funnel logos below advertiser name */}
              {(() => {
                // --- Marketing Platform logos (detected from URLs) ---
                const outgoing = Array.isArray(insights.outgoingLinks) ? insights.outgoingLinks[0] : insights.outgoingLinks;
                const mpUrlObj = d?.market_platform_urls || ad?.marketPlatformUrls || {};
                const mpRedirects = (mpUrlObj?.url_redirects || '').split('||').map(s => s.trim()).filter(Boolean);
                const mpRedirectUrlsArr = Array.isArray(mpUrlObj?.redirect_urls)
                  ? mpUrlObj.redirect_urls
                  : typeof mpUrlObj?.redirect_urls === 'string' && mpUrlObj.redirect_urls
                    ? [mpUrlObj.redirect_urls]
                    : [];
                const urlsToCheck = [
                  d?.destination_url, d?.url, d?.redirect_url, d?.final_url, d?.source_url,
                  outgoing?.source_url, outgoing?.redirect_url, outgoing?.final_url,
                  mpUrlObj?.destination_url,
                  mpUrlObj?.url_destination,
                  mpUrlObj?.source_url,
                  mpUrlObj?.redirect_url,
                  mpUrlObj?.final_url,
                  ...mpRedirects,
                  ...mpRedirectUrlsArr,
                ].filter(Boolean);
                if (Array.isArray(d?.urlArray)) {
                  d.urlArray.forEach(u => u?.url && urlsToCheck.push(u.url));
                }
                const seen = new Set();
                const mpLogos = [];
                for (const url of urlsToCheck) {
                  const lower = url.toLowerCase();
                  for (const mp of MARKET_PLATFORMS) {
                    if (lower.includes(mp.match) && !seen.has(mp.match)) {
                      seen.add(mp.match);
                      const src = MARKETING_PLATFORM_IMGS[mp.match];
                      if (src) mpLogos.push({ key: mp.match, src, title: mp.title });
                    }
                  }
                }

                // --- Ecommerce Platform logos (from built_with) ---
                const ecRaw = d.built_with || processedAd?.builtWith || ad?.builtWith || ad?.built_with;
                const ecList = Array.isArray(ecRaw) ? ecRaw : ecRaw ? [ecRaw] : [];
                const ecLogos = ecList.map(name => {
                  const src = ECOMMERCE_PLATFORM_IMGS[normalizeEcommercePlatformKey(name)];
                  return src ? { key: `ec_${name}`, src, title: name } : null;
                }).filter(Boolean);

                // --- Funnel logos (from built_with_analytics_tracking) ---
                const fnRaw = d.built_with_analytics_tracking || processedAd?.builtWithFunnel || ad?.builtWithFunnel || ad?.built_with_analytics_tracking;
                const fnList = Array.isArray(fnRaw) ? fnRaw : fnRaw ? [fnRaw] : [];
                const fnLogos = fnList.map(name => {
                  const src = FUNNEL_IMGS[name.toLowerCase().replace(/\s+/g, '')];
                  return src ? { key: `fn_${name}`, src, title: name } : null;
                }).filter(Boolean);

                // --- Affiliate network logos (from affiliate_data) ---
                const afRaw = d.affiliate_data || ad?.affiliateData;
                const afList = Array.isArray(afRaw) ? afRaw : afRaw ? [afRaw] : [];
                const afLogos = afList.map(name => {
                  const src = getAffiliateNetworkLogo(name);
                  return src ? { key: `af_${name}`, src, title: name } : null;
                }).filter(Boolean);

                const allLogos = [...mpLogos, ...ecLogos, ...fnLogos, ...afLogos];
                if (allLogos.length === 0) return null;

                return <PlatformBadgesRow allLogos={allLogos} />;
              })()}

              {/* Title */}
              <div className="flex items-center gap-2.5">
                <h3 className={`text-[16px] font-bold leading-snug ${isLight ? 'text-gray-900' : 'text-white/70'}`}>
                  {he.decode(currentTitle || d?.ad_title || ad?.title || '')}
                </h3>
              </div>

              {/* Description */}
              <div>
                {(d?.ad_text || ad?.adText || ad?.description) && (
                  <AdTextBlock
                    text={he.decode(
                      d?.ad_text || ad?.adText || ad?.description || ""
                    )}
                    isLight={isLight}
                  />
                )}
              </div>

              {/* News Feed Description */}
              {(d?.newsfeed_description || d?.news_feed_description) && (
                <div>
                  <h4
                    className={`text-[11px] font-bold uppercase tracking-wider mb-2 flex items-center gap-2 ${
                      isLight ? "text-gray-700" : "text-white/80"
                    }`}
                  >
                    <MessageCircle size={14} className={isLight ? "text-gray-500" : "text-white/50"} />
                    News Feed Description
                  </h4>
                  <AdTextBlock
                    text={he.decode(
                      d?.newsfeed_description || d?.news_feed_description || ""
                    )}
                    isLight={isLight}
                  />
                </div>
              )}

              {/* Google keywords */}
              {ctx.platform === "google" && ctx.keywords && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag size={14} className="text-sky-400/60 shrink-0" />
                  {ctx.keywords.split(",").map((kw, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-0.5 bg-sky-500/10 text-sky-300/70 rounded border border-sky-500/10"
                    >
                      {kw.trim()}
                    </span>
                  ))}
                </div>
              )}

              {/* Engagement — likes/comments/shares/views/impressions. Zero-value
                  metrics are filtered out upstream (formatNumber → null), so an ad
                  with only likes shows just that. Quora carries likes/comments/shares
                  like every other network, so it's included here too. */}
              {ctx.hasEngagement ? (
                <div className="flex items-center gap-5">
                  {ctx.engagementItems.map((stat, i) =>
                    stat.isStars ? (
                      <div key={i} className="relative group/stat inline-flex items-center">
                        <StarRating value={stat.value} isLight={isLight} />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#1a1a1a] text-white text-[10px] font-semibold rounded-md border border-white/10 whitespace-nowrap opacity-0 group-hover/stat:opacity-100 pointer-events-none transition-opacity z-50">
                          {stat.label}
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="relative group/stat flex items-center gap-1.5">
                        {stat.icon}
                        <span
                          className={`text-[13px] font-semibold tabular-nums ${isLight ? "text-gray-900" : "text-white/85"}`}
                        >
                          {stat.value}
                        </span>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#1a1a1a] text-white text-[10px] font-semibold rounded-md border border-white/10 whitespace-nowrap opacity-0 group-hover/stat:opacity-100 pointer-events-none transition-opacity z-50">
                          {stat.label}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <span className="text-[12px] italic text-[#9f9f9f]"> </span>
              )}
            </div>

            {/* Ad Details table */}
            {!isTransparency && visibleDetailRows.length > 0 && <div className="pt-4 mt-4">
              <h2
                className={`flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] mb-4 ${isLight ? "text-gray-800" : "text-white/90"}`}
              >
                <FileText size={16} />
                Ad Details
              </h2>
              <div
                className={`rounded-2xl border-2 ${isLight ? "bg-gray-50/50 border-gray-200" : "bg-white/[0.02] border-white/10"}`}
              >
                <div
                  className={`grid grid-cols-2 divide-x ${
                    isLight ? "divide-gray-200" : "divide-white/10"
                  }`}
                >
                  {visibleDetailRows.map((item, i, arr) => {
                    // A lone last item (odd count) stays in its single column so its
                    // label/value keep the same spacing as every other cell, instead of
                    // stretching full-width and slamming the value to the far-right edge.
                    const isEvenRow = Math.floor(i / 2) < Math.floor((arr.length - 1) / 2);
                    return (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-4 py-3 ${
                        isEvenRow
                          ? isLight
                            ? "border-b border-gray-200"
                            : "border-b border-white/10"
                          : ""
                      }`}
                    >
                      <div className={`flex items-center gap-2.5 ${item.tooltip ? "relative group/row" : ""}`}>
                        <item.icon
                          size={14}
                          className={iconColorClass(item.color, isLight)}
                        />
                        <span className="text-[12px] font-bold text-[#aaa]">
                          {item.label}
                        </span>
                        {item.tooltip && (
                          <div className="absolute bottom-full left-0 mb-1.5 w-52 px-2.5 py-1.5 bg-white text-gray-800 text-[11px] leading-snug font-normal normal-case rounded-md border border-gray-200 shadow-lg opacity-0 group-hover/row:opacity-100 pointer-events-none transition-opacity z-50">
                            {item.tooltip}
                          </div>
                        )}
                      </div>
                      {item.expandable ? (
                        <div className="flex items-center gap-1.5 max-w-[60%]">
                          <span className={`text-[14px] font-semibold ${isLight ? "text-gray-900" : "text-white/85"}`}>
                            {regionExpanded ? item.fullValue : item.value}
                          </span>
                          <button
                            onClick={() => setRegionExpanded(e => !e)}
                            className={`text-[11px] font-bold px-1.5 py-0.5 rounded border transition-colors flex-shrink-0 ${isLight ? "border-gray-300 text-gray-500 hover:bg-gray-100" : "border-white/20 text-white/50 hover:bg-white/10"}`}
                          >
                            {regionExpanded ? "less" : "..."}
                          </button>
                        </div>
                      ) : item.renderValue ? (
                        item.renderValue(item.value)
                      ) : item.wrap ? (
                        <span
                          className={`text-[14px] font-semibold whitespace-normal break-words text-right leading-tight max-w-[60%] ${isLight ? "text-gray-900" : "text-white/85"}`}
                        >
                          {item.value}
                        </span>
                      ) : (
                        <span
                          className={`text-[14px] font-semibold truncate max-w-[60%] ${isLight ? "text-gray-900" : "text-white/85"}`}
                        >
                          {item.value}
                        </span>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>}

            {hasAdmobSessionHistory && (
              <div className="pt-4 mt-4">
                <h2
                  className={`flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] mb-4 ${isLight ? "text-gray-800" : "text-white/90"}`}
                >
                  <BarChart3 size={16} />
                  Session History
                </h2>
                <div
                  className={`rounded-2xl border-2 ${isLight ? "bg-gray-50/50 border-gray-200" : "bg-white/[0.02] border-white/10"}`}
                >
                  <div className="px-4 pt-4 flex flex-col gap-2.5">
                    {/* Sessions Seen — how many times we've actually found this ad. */}
                    {admobSessionsTotal > 0 && (
                      <div className="relative group/sessionsSeen inline-flex items-center w-fit">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
                            isLight ? "bg-blue-50 text-blue-700" : "bg-blue-500/10 text-blue-300"
                          }`}
                        >
                          Sessions Seen: {admobSessionsTotal}
                          <Info size={11} className="opacity-60 cursor-default" />
                        </span>
                        <div className="absolute bottom-full left-0 mb-1.5 w-52 px-2.5 py-1.5 bg-white text-gray-800 text-[11px] leading-snug font-normal normal-case rounded-md border border-gray-200 shadow-lg z-50 opacity-0 group-hover/sessionsSeen:opacity-100 pointer-events-none transition-opacity">
                          This ad has been found {admobSessionsTotal}x so far.
                        </div>
                      </div>
                    )}

                    {/* Tracked Sessions — same pattern: labeled total first, then a chip per
                        app. If this ad gets linked to more apps later, each one shows up here
                        as its own chip automatically, no code change needed. */}
                    {(() => {
                    const trackedTooltip = admobTrackedSessionsByApp.length > 0
                      ? admobTrackedSessionsByApp
                          .map((row) => `${row.name} has been scanned ${row.count}x`)
                          .join(", ")
                          + "."
                      : "How many times we've scanned the app(s) this ad appears in.";
                    return (admobTrackedSessionsByApp.length > 0 || admobTrackedSessionsTotal > 0) && (
                      <div
                        className={`relative group/trackedSessions inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full px-3 py-1 w-fit ${
                          isLight ? "bg-violet-50" : "bg-violet-500/10"
                        }`}
                      >
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide shrink-0 ${isLight ? "text-violet-700" : "text-violet-300"}`}>
                          Tracked Sessions: {admobTrackedSessionsTotal}
                          <Info size={11} className="opacity-60 cursor-default" />
                        </span>
                        {admobTrackedSessionsByApp.map((row) => (
                          <span
                            key={`tracked-${row.name}`}
                            className={`text-[11px] font-semibold ${isLight ? "text-violet-700/70" : "text-violet-300/70"}`}
                          >
                            · {row.name} {row.count}x
                          </span>
                        ))}
                        <div className="absolute bottom-full left-0 mb-1.5 w-52 px-2.5 py-1.5 bg-white text-gray-800 text-[11px] leading-snug font-normal normal-case rounded-md border border-gray-200 shadow-lg z-50 opacity-0 group-hover/trackedSessions:opacity-100 pointer-events-none transition-opacity">
                          {trackedTooltip}
                        </div>
                      </div>
                    );
                    })()}

                    {/* Occurrence Rate — bar reveals on hover instead of always sitting on screen */}
                    {admobOccurrenceRatePercent > 0 && (
                      <div className="relative group/rate inline-flex items-center gap-2 w-fit">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide cursor-default ${
                            isLight ? "bg-emerald-50 text-emerald-700" : "bg-emerald-500/10 text-emerald-300"
                          }`}
                        >
                          Occurrence Rate: {admobOccurrenceRatePercent}%
                          <Info size={11} className="opacity-60" />
                        </span>
                        <div className="grid grid-cols-[0fr] group-hover/rate:grid-cols-[1fr] transition-[grid-template-columns] duration-200 ease-out">
                          <div className="overflow-hidden">
                            <div className={`h-1.5 w-28 rounded-full overflow-hidden ${isLight ? "bg-gray-200" : "bg-white/10"}`}>
                              <div
                                className={`h-full rounded-full ${isLight ? "bg-emerald-500" : "bg-emerald-400"}`}
                                style={{ width: `${Math.min(100, Math.max(2, admobOccurrenceRatePercent))}%` }}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="absolute bottom-full left-0 mb-1.5 w-52 px-2.5 py-1.5 bg-white text-gray-800 text-[11px] leading-snug font-normal normal-case rounded-md border border-gray-200 shadow-lg z-50 opacity-0 group-hover/rate:opacity-100 pointer-events-none transition-opacity">
                          Out of {admobTrackedSessionsTotal} times we scanned, this ad showed up {admobSessionsTotal}x — that's {admobOccurrenceRatePercent}%.
                        </div>
                      </div>
                    )}
                  </div>

                  {admobSessionRows.length > 0 ? (
                    <div className="group/sightings">
                      {/* Header row — badge + count. */}
                      <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className={`relative group/badge inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide shrink-0 transition-colors cursor-default ${
                            isLight
                              ? "bg-fuchsia-50 text-fuchsia-600 group-hover/sightings:bg-fuchsia-100"
                              : "bg-fuchsia-500/10 text-fuchsia-400 group-hover/sightings:bg-fuchsia-500/20"
                          }`}
                        >
                          Sighting Log
                          <Info
                            size={11}
                            className="opacity-60 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenInfoTooltip((t) => (t === "sightingLog" ? null : "sightingLog"));
                            }}
                          />
                          {openInfoTooltip === "sightingLog" && (
                            <div className="absolute bottom-full left-0 mb-1.5 w-52 px-2.5 py-1.5 bg-white text-gray-800 text-[11px] leading-snug font-normal normal-case rounded-md border border-gray-200 shadow-lg z-50">
                              Every time we've found this ad, most recent first.
                            </div>
                          )}
                        </button>
                        {admobSessionGroups.length < admobSessionsTotal && (
                          <span className={`text-[11px] font-medium ${isLight ? "text-gray-400" : "text-white/30"}`}>
                            Showing {admobSessionGroups.length} of {admobSessionsTotal}
                          </span>
                        )}
                      </div>

                      {/* Per-app breakdown — how many times THIS ad has specifically
                          been seen in each linked source app individually. */}
                      {admobSessionsSeenByApp.length > 0 && (
                        <div className="px-4 pb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {admobSessionsSeenByApp.map((row) => (
                            <span
                              key={`sighting-app-${row.name}`}
                              title={`Total number of times this ad has shown up in ${row.name}, added up across every session.`}
                              className={`text-[11px] font-medium cursor-default ${isLight ? "text-gray-500" : "text-white/40"}`}
                            >
                              {row.name}: <span className={`font-bold ${isLight ? "text-fuchsia-600" : "text-fuchsia-400"}`}>{row.count}x</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Always expanded — stays inside the Session History block instead of
                          floating outside it, capped + scrollable past max-h-96. */}
                      <div className="grid grid-rows-[1fr]">
                        <div className="overflow-hidden">
                          <div className="px-4 pb-4">
                            <div
                              className={`max-h-96 overflow-y-auto rounded-xl border ${
                                isLight ? "border-gray-200 bg-white" : "border-white/10 bg-black/10"
                              }`}
                            >
                              {admobSessionGroups.map((group, index) => {
                                const groupTotal = group.apps.reduce((sum, a) => sum + a.count, 0);
                                return (
                                <div
                                  key={`${group.session_id || "session"}-${index}-${group.observed_at || ""}`}
                                  className={`flex items-start justify-between gap-4 px-4 py-3 ${
                                    index < admobSessionGroups.length - 1
                                      ? isLight
                                        ? "border-b border-gray-200"
                                        : "border-b border-white/10"
                                      : ""
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-[13px] font-semibold ${isLight ? "text-gray-900" : "text-white/85"}`}>
                                        {fmtFriendlyDateTime(group.observed_at)}
                                      </span>
                                      <span className="relative group/repeat shrink-0 inline-flex items-center">
                                        <span
                                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide cursor-default ${
                                            isLight ? "bg-blue-50 text-blue-700" : "bg-blue-500/10 text-blue-300"
                                          }`}
                                        >
                                          viewed {groupTotal}x
                                        </span>
                                        <div className="absolute top-full right-0 mt-1.5 w-48 px-2.5 py-1.5 bg-white text-gray-800 text-[11px] leading-snug font-normal normal-case rounded-md border border-gray-200 shadow-lg opacity-0 group-hover/repeat:opacity-100 pointer-events-none transition-opacity z-50">
                                          We saw this ad {groupTotal} time{groupTotal === 1 ? "" : "s"} during this particular session.
                                        </div>
                                      </span>
                                    </div>
                                    {group.apps.some((a) => a.name) && (
                                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                        {group.apps.map((a, i) => (
                                          <span
                                            key={`${a.name || "app"}-${i}`}
                                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide cursor-default ${
                                              isLight ? "bg-violet-50 text-violet-700" : "bg-violet-500/10 text-violet-300"
                                            }`}
                                          >
                                            {a.name || "Unknown app"}: {a.count}x
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    <div className={`mt-1 text-[11px] font-mono break-all ${isLight ? "text-gray-400" : "text-white/30"}`}>
                                      {group.session_id || "Unknown session"}
                                    </div>
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={`px-4 py-4 text-[13px] ${isLight ? "text-gray-500" : "text-white/50"}`}>
                      Session counts are available, but individual session rows are not returned yet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Sections below hero ────────────────────────────── */}
          <div className="space-y-6 pt-6">
            <CreativeScore adDetails={adDetailsData} />
            {!isTransparency && <BasicInfo
              adDetails={adDetailsData}
              outgoingLinks={insights.outgoingLinks}
              platform={ctx.platform}
              tiktokAnalytics={tiktokAnalytics}
              ad={processedAd || ad}
              isTransparency={isTransparency}
              hideEmpty={isAdmob}
            />}

            {hasAiMetaScorecard && (
              <section className="px-6" data-testid="ai-insights-scorecard">
                <div
                  className={`overflow-hidden rounded-2xl border ${
                    isLight
                      ? "border-gray-200 bg-white shadow-sm"
                      : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div
                    className={`flex items-center border-b px-5 py-4 ${
                      isLight ? "border-gray-200" : "border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Sparkles size={17} className="text-violet-500" aria-hidden="true" />
                      <h2 className={`text-[18px] font-bold ${isLight ? "text-gray-900" : "text-white/90"}`}>
                        AI Insights
                      </h2>
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[9px] font-extrabold leading-none tracking-[0.16em] ${
                          isLight
                            ? "border-violet-200 bg-violet-50 text-violet-700"
                            : "border-violet-400/25 bg-violet-500/10 text-violet-300"
                        }`}
                      >
                        NEW
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2">
                    <div className={`px-5 py-5 lg:border-r ${
                      isLight ? "border-gray-200" : "border-white/10"
                    }`}>
                      <div className={`mb-4 font-mono text-[10px] font-semibold tracking-[0.12em] ${
                        // Use a restrained gray in both themes; the global light
                        // remap otherwise makes this near-black on white.
                        isLight ? "text-[#9aa0ae]" : "text-[#8f95a3]"
                      }`}>
                        WHAT THE AI READ
                      </div>
                      <div className="space-y-3">
                        {aiMetaScorecard.attributes.map(({ label, value, kind, tokens, colors }) => (
                          <div key={label} className="flex items-start justify-between gap-4">
                            <span className={`shrink-0 text-[11px] font-medium ${
                              isLight ? "text-gray-500" : "text-white/45"
                            }`}>
                              {label}
                            </span>
                            {kind === "colors" && colors?.length ? (
                              <div className="flex flex-wrap justify-end gap-1.5" aria-label="Detected color palette">
                                {colors.map((color, index) => {
                                  const configuredLabel = getAiColorLabel(color);
                                  const colorLabel = configuredLabel === color ? `Color ${index + 1}` : configuredLabel;
                                  return (
                                    <span
                                      key={`${color}-${index}`}
                                      className={`h-4 w-4 rounded border shadow-sm ${
                                        isLight ? "border-gray-300" : "border-white/20"
                                      }`}
                                      style={{ backgroundColor: color }}
                                      title={colorLabel}
                                      aria-label={colorLabel}
                                    />
                                  );
                                })}
                              </div>
                            ) : kind === "intent" || kind === "hook" ? (
                              <div className="flex flex-wrap justify-end gap-1.5">
                                {tokens.map((token) => (
                                  <span
                                    key={token}
                                    className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                                      kind === "intent"
                                        ? isLight
                                          ? "bg-violet-50 text-violet-700"
                                          : "bg-violet-500/10 text-violet-300"
                                        : isLight
                                          ? "bg-amber-50 text-amber-700"
                                          : "bg-amber-400/10 text-amber-300"
                                    }`}
                                  >
                                    {token}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className={`min-w-0 text-right text-[12px] font-semibold leading-relaxed ${
                                isLight ? "text-gray-900" : "text-white/85"
                              }`}>
                                {value}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      {aiMetaScorecard.caption && (
                        <div className={`mt-5 rounded-xl px-3.5 py-3 ${
                          isLight ? "bg-gray-50" : "bg-white/[0.035]"
                        }`}>
                          <div className={`mb-2 font-mono text-[9px] font-semibold tracking-[0.12em] ${
                            isLight ? "text-gray-400" : "text-white/35"
                          }`}>
                            CAPTION
                          </div>
                          <p className={`text-[12px] leading-relaxed ${
                            isLight ? "text-gray-700" : "text-white/70"
                          }`}>
                            {aiMetaScorecard.caption}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className={`border-t px-5 py-5 lg:border-t-0 ${
                      isLight
                        ? "border-gray-200 bg-violet-50/40"
                        : "border-white/10 bg-violet-500/[0.035]"
                    }`}>
                      <div className={`mb-4 font-mono text-[10px] font-semibold tracking-[0.12em] ${
                        // Evidence is a restrained lavender accent, not the
                        // brighter interactive violet used by buttons and chips.
                        isLight ? "text-[#8b7fb0]" : "text-[#a99bc8]"
                      }`}>
                        EVIDENCE FROM THE CREATIVE
                      </div>
                      {aiMetaScorecard.evidence.length > 0 ? (
                        <div className="space-y-3">
                          {aiMetaScorecard.evidence.map(({ label, value }) => (
                            <div
                              key={label}
                              className={`rounded-xl border px-3.5 py-3 ${
                                isLight
                                  ? "border-violet-100 bg-white shadow-sm"
                                  : "border-violet-400/15 bg-white/[0.035]"
                              }`}
                            >
                              <div className={`mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
                                isLight ? "text-violet-700" : "text-violet-300"
                              }`}>
                                {label}
                              </div>
                              <p className={`text-[12px] leading-relaxed ${
                                isLight ? "text-gray-700" : "text-white/70"
                              }`}>
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`rounded-xl border border-dashed px-4 py-5 text-[12px] leading-relaxed ${
                          isLight
                            ? "border-violet-200 text-gray-500"
                            : "border-violet-400/20 text-white/45"
                        }`}>
                          No supporting evidence was returned for this creative.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {isTransparency && (
              <TransparencyDelivery
                previewSpace={transparencyPreviewSpace}
                isLight={isLight}
                subnetwork={d.subnetwork || processedAd?.subnetwork || ad?.subnetwork}
                impressions={d.impressions || processedAd?.impressionRange || ad?.impressionRange}
                countryDetails={
                  (Array.isArray(d.country_details) && d.country_details.length
                    ? d.country_details
                    : null) ||
                  (processedAd?.countryDetails?.length ? processedAd.countryDetails : null) ||
                  ad?.countryDetails ||
                  []
                }
                firstSeen={processedAd?.firstSeenRaw ?? ad?.firstSeenRaw}
                lastSeen={resolveTransparencyContractValue(
                  d,
                  "last_seen",
                  processedAd?.lastSeenRaw,
                  ad?.lastSeenRaw,
                )}
                lastShown={resolveTransparencyContractValue(
                  d,
                  "last_shown",
                  processedAd?.lastShownRaw,
                  ad?.lastShownRaw,
                )}
                adType={d.type || processedAd?.adType || ad?.adType}
                source={d.source || processedAd?.source || ad?.source}
                language={d.language || processedAd?.language || ad?.language}
                adUrl={d.ad_url || processedAd?.adUrl || ad?.adUrl}
                destinationUrl={
                  d.destination_url ??
                  processedAd?.destinationUrl ??
                  ad?.destinationUrl ??
                  null
                }
                redirectUrl={
                  d.redirect_url ??
                  processedAd?.redirectUrl ??
                  ad?.redirectUrl ??
                  null
                }
              />
            )}

            {/* Target Audience — Facebook & Instagram (right after Basic Info) */}
            {["facebook", "instagram"].includes(ctx.platform) && (
              <AudienceSection
                interests={audience.interests}
                behaviours={audience.behaviours}
                confidenceScore={audience.confidenceScore}
                loading={audience.loading}
              />
            )}

            {/* Lander Details */}
            {![
              "google",
              "gdn",
              "native",
              "linkedin",
              "reddit",
              "quora",
              "pinterest",
              "tiktok",
            ].includes(ctx.platform) && (
              <LanderDetails
                screenshotUrl={landerScreenshotUrl}
                pageUrl={landerVisitUrl}
                downloadId={processedAd?.internalId ?? ad?.internalId ?? adDetailsData?.id ?? adDetailsData?.sql_id ?? null}
                whatsappEntries={landerWhatsappEntries}
                whatsappRotatorCount={landerWhatsappRotatorCount}
              />
            )}

            {/* Social Engagements — Facebook, Instagram, YouTube, LinkedIn, Reddit, TikTok & Quora */}
            {['facebook', 'instagram', 'youtube', 'linkedin', 'reddit', 'tiktok', 'quora'].includes(ctx.platform) && !((['facebook', 'instagram'].includes(ctx.platform) && adDetailsData?.platform === 15)) && (
              <SocialEngagements
                adId={ad?.id}
                adLcs={insights.lcs}
                advertiserLcs={insights.advertiserLCSData}
                postOwnerId={postOwnerId}
                availableYears={availableYears}
                network={ctx.platform}
              />
            )}

            {/* Demographics / TikTok time analysis / Google keywords / Native TargetSite */}
            {isTikTok ? (
              <TikTokTimeAnalysis analytics={tiktokAnalytics} />
            ) : ctx.platform === "google" && !isTransparency ? (
              <TargetedKeywords
                adDetails={adDetailsData}
                ad={ad}
                isLight={isLight}
                competitiveIntelEnabled={competitiveIntelEnabled}
                onKeywordClick={onOpenKeywordExplorer}
                onOpenAdvertiserProfile={onOpenAdvertiserProfile}
                onOpenKeywordsExplorer={onOpenKeywordsExplorer}
                advertiser={adDetailsData?.post_owner || ad?.post_owner || ad?.advertiser}
                postOwnerId={postOwnerId}
              />
            ) : ctx.platform === "native" ? (
              <AdDetailsActivity
                targetSiteData={insights.targetSite}
                isLight={isLight}
              />
            ) : !isTransparency && (!isAdmob || hasAdmobDemographics) && !["gdn", "pinterest", "reddit", "linkedin", "youtube", "quora"].includes(
                ctx.platform,
              ) && !(insightErrors.userData && !insights.advertiserUserData) ? (
              <Demographics
                adUserData={insights.userData}
                advertiserUserData={insights.advertiserUserData}
                platform={ctx.platform}
                network={ctx.platform}
                postOwnerId={postOwnerId}
                availableYears={availableYears}
              />
            ) : null}

            <CountryAnalytics
              adId={ad?.id}
              adCountry={insights.country || admobCountry}
              advertiserCountry={insights.advertiserCountryData}
              platform={ctx.platform}
              network={ctx.platform}
              tiktokAnalytics={tiktokAnalytics}
              postOwnerId={postOwnerId}
              availableYears={availableYears}
            />
          </div>
          <div className="h-12" />
        </div>
      </div>
    </div>
  );
};

export default AnalyticsModal;

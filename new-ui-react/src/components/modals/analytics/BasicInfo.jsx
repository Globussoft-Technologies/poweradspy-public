import {
  ExternalLink,
  Copy,
  Check,
  Link2,
  ArrowRightLeft,
  Globe,
  RefreshCw,
  BookOpen,
  Layout,
  Network,
  MapPin,
  ArrowRight,
  Target,
} from "lucide-react";
import { useTheme } from "../../../hooks/useTheme";
import { useState, useRef } from "react";

const BasicInfo = ({
  adDetails,
  outgoingLinks,
  platform,
  tiktokAnalytics,
  ad,
}) => {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const p = (platform || "").toLowerCase();
  const isTikTok = p === "tiktok";
  const tt = tiktokAnalytics || {};

  // Platforms that show only initial + redirect URL (no fb_post_url, no outgoing links)
  const urlOnlyPlatforms = ["linkedin", "reddit", "quora", "pinterest"];
  // Platforms that hide outgoing links section
  const hideOutgoingLinks = [
    "tiktok",
    "google",
    "reddit",
    "quora",
    "pinterest",
    "native",
  ];

  const sanitizeUrl = (val) => {
    const s = (val || "").trim();
    return s === "null" || s === "undefined" ? "" : s;
  };

  // Split URLs by || separator if present
  const splitUrls = (url) => {
    if (!url) return [];
    return url.split('||').map(u => u.trim()).filter(Boolean);
  };

  // market_platform_urls fallback (present in Pinterest, Native, etc.)
  const mpUrls = adDetails?.market_platform_urls || {};

  // Map adDetails fields — fall back to market_platform_urls then ad card fields
  const initialUrl = isTikTok
    ? sanitizeUrl(tt.destination_url)
    : sanitizeUrl(adDetails?.destination_url)
      || sanitizeUrl(mpUrls?.url_destination)
      || sanitizeUrl(mpUrls?.source_url)
      || sanitizeUrl(String(ad?.destinationUrl ?? ""));
  // Get raw redirect_url preserving || separator (don't use sanitizeUrl with OR operator)
  let redirectUrl = "";
  if (!isTikTok) {
    const url1 = (adDetails?.url ?? "").trim();
    const url2 = (adDetails?.redirect_url ?? "").trim();
    const url3 = (mpUrls?.redirect_url ?? "").trim();
    const url4 = (mpUrls?.final_url ?? "").trim();

    redirectUrl = url1 || url2 || url3 || url4;

    // Only remove literal "null"/"undefined" strings
    if (redirectUrl === "null" || redirectUrl === "undefined") {
      redirectUrl = "";
    }
  }
  const fbPostLink = isTikTok ? sanitizeUrl(tt.library_url) : sanitizeUrl(adDetails?.ad_url) || sanitizeUrl(ad?.adUrl);
  // Native: placement_url instead of fb_post_url
  const placementUrl = sanitizeUrl(adDetails?.placement_url || ad?.placement_url);
  // Native: network field
  const nativeNetwork =
    adDetails?.network || ad?.network_name || ad?.network || "";

  // Map outgoingLinks (array of { source_url, redirect_url, final_url })
  const outgoing = Array.isArray(outgoingLinks)
    ? outgoingLinks[0]
    : outgoingLinks;
  const sourceUrl = outgoing?.source_url || "";
  const stepRedirect = outgoing?.redirect_url || "";
  const targetUrl = outgoing?.final_url || "";

  const CopyBtn = ({ text }) => {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef(null);

    const handleCopy = () => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    };

    return (
      <button
        onClick={handleCopy}
        className={`p-1.5 rounded-lg transition-colors ${copied ? (isLight ? "text-green-500" : "text-green-400") : isLight ? "hover:bg-gray-100 text-gray-400 hover:text-gray-500" : "hover:bg-white/10 text-white/30 hover:text-white/60"}`}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    );
  };

  // Build basic rows based on platform
  let basicRows;
  if (isTikTok) {
    basicRows = [
      {
        label: "INITIAL URL",
        icon: Globe,
        value: initialUrl,
        href: initialUrl,
        hoverColor: "hover:text-[#6b99ff]",
      },
      {
        label: "AD LIBRARY LINK",
        icon: BookOpen,
        value: fbPostLink,
        href: fbPostLink,
        hoverColor: "hover:text-emerald-400",
      },
    ];
  } else if (p === "native") {
    basicRows = [
      {
        label: "NETWORK",
        icon: Network,
        value: nativeNetwork,
        href: null,
        hoverColor: "",
      },
      {
        label: "INITIAL URL",
        icon: Globe,
        value: initialUrl,
        href: initialUrl,
        hoverColor: "hover:text-[#6b99ff]",
      },
      {
        label: "PLACEMENT URL",
        icon: MapPin,
        value: placementUrl,
        href: placementUrl,
        hoverColor: "hover:text-emerald-400",
      },
    ];
  } else if (urlOnlyPlatforms.includes(p)) {
    basicRows = [
      {
        label: "INITIAL URL",
        icon: Globe,
        value: initialUrl,
        href: initialUrl,
        hoverColor: "hover:text-[#6b99ff]",
      },
      {
        label: "REDIRECT URL",
        icon: RefreshCw,
        value: redirectUrl,
        href: redirectUrl,
        hoverColor: "hover:text-white/60",
      },
    ];
  } else if (p === "google") {
    basicRows = [
      {
        label: "INITIAL URL",
        icon: Globe,
        value: initialUrl,
        href: initialUrl,
        hoverColor: "hover:text-[#6b99ff]",
      },
      {
        label: "REDIRECT URL",
        icon: RefreshCw,
        value: redirectUrl,
        href: redirectUrl,
        hoverColor: "hover:text-white/60",
      },
    ];
  } else {
    basicRows = [
      {
        label: "INITIAL URL",
        icon: Globe,
        value: initialUrl,
        href: initialUrl,
        hoverColor: "hover:text-[#6b99ff]",
      },
      {
        label: "REDIRECT URL",
        icon: RefreshCw,
        value: redirectUrl,
        href: redirectUrl,
        hoverColor: "hover:text-white/60",
      },
      {
        label: "Ad Url",
        icon: BookOpen,
        value: fbPostLink,
        href: fbPostLink,
        hoverColor: "hover:text-emerald-400",
      },
    ];
  }

  const hasOutgoingData = sourceUrl || stepRedirect || targetUrl;
  const showOutgoingLinks = !hideOutgoingLinks.includes(p) && hasOutgoingData;

  return (
    <div
      className={`grid grid-cols-1 ${showOutgoingLinks ? "lg:grid-cols-2" : ""} gap-4 px-6`}
    >
      {/* Basic URLs */}
      <div>
        <h3
          className={`flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] mb-4 ${isLight ? "text-gray-800" : "text-white/90"}`}
        >
          <Link2 size={16} className="opacity-60" />
          Basic Info
        </h3>
        <div
          className={`rounded-xl overflow-hidden border border-l-2 border-l-[#3759a3]/40 ${isLight ? "bg-gray-50/50 border-gray-200" : "bg-white/[0.02] border-white/5"}`}
        >
          {basicRows.map((url, i, arr) => {
            const urlList = splitUrls(url.value);
            const isMultiUrl = urlList.length > 1;

            return (
              <div key={i}>
                {isMultiUrl ? (
                  // Multiple URLs — show label once, then each URL on its own row
                  <>
                    <div
                      className={`flex items-center gap-3 px-4 py-3 transition-all group ${isLight ? "hover:bg-black/[0.01]" : "hover:bg-white/[0.03]"}`}
                    >
                      <div className="flex items-center gap-2 shrink-0 w-44">
                        {url.icon && (
                          <url.icon
                            size={13}
                            className="text-[#9f9f9f] opacity-70 shrink-0"
                          />
                        )}
                        <span className="text-[12px] font-bold uppercase text-[#9f9f9f]">
                          {url.label} ({urlList.length})
                        </span>
                      </div>
                    </div>
                    {urlList.map((singleUrl, j) => (
                      <div
                        key={j}
                        className={`flex items-center gap-3 px-4 py-2 pl-12 transition-all group ${isLight ? "bg-gray-50/30 border-t border-gray-100 hover:bg-black/[0.01]" : "bg-white/[0.01] border-t border-white/3 hover:bg-white/[0.02]"}`}
                      >
                        <span
                          className={`text-[13px] truncate max-w-[60%] text-right ${isLight ? "font-semibold text-gray-800" : "font-medium text-white/80"}`}
                          title={singleUrl}
                        >
                          {singleUrl}
                        </span>
                        <div className="flex items-center shrink-0">
                          {singleUrl && <CopyBtn text={singleUrl} />}
                          {singleUrl && (
                            <a
                              href={singleUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={`p-1.5 rounded-md transition-colors ${isLight ? "text-gray-400 hover:text-gray-500 hover:bg-gray-100" : `text-white/30 ${url.hoverColor} hover:bg-white/10`}`}
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  // Single URL — original display logic
                  <div
                    className={`flex items-center gap-3 px-4 py-3 transition-all group ${i < arr.length - 1 ? (isLight ? "border-b border-gray-200" : "border-b border-white/5") : ""} ${isLight ? "hover:bg-black/[0.01]" : "hover:bg-white/[0.03]"}`}
                  >
                    <div className="flex items-center gap-2 shrink-0 w-44">
                      {url.icon && (
                        <url.icon
                          size={13}
                          className="text-[#9f9f9f] opacity-70 shrink-0"
                        />
                      )}
                      <span className="text-[12px] font-bold uppercase text-[#9f9f9f]">
                        {url.label}
                      </span>
                    </div>
                    <span
                      className={`text-[14px] truncate max-w-[60%] text-right ${isLight ? "font-bold text-gray-900" : "font-semibold text-white/85"}`}
                    >
                      {url.value || "—"}
                    </span>

                    <div className="flex items-center shrink-0">
                      {url.href !== null && url.value && <CopyBtn text={url.value} />}
                      {url.href && (
                        <a
                          href={url.href}
                          target="_blank"
                          rel="noreferrer"
                          className={`p-1.5 rounded-md transition-colors ${isLight ? "text-gray-400 hover:text-gray-500 hover:bg-gray-100" : `text-white/30 ${url.hoverColor} hover:bg-white/10`}`}
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Out Going Links Flow — platform-conditional */}
      {showOutgoingLinks && (
        <div>
          <h3
            className={`flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] mb-4 ${isLight ? "text-gray-800" : "text-white/90"}`}
          >
            <ArrowRightLeft size={16} className="opacity-60" />
            Out Going Links Flow
          </h3>
          <div
            className={`rounded-xl overflow-hidden border border-l-2 border-l-[#3759a3]/40 ${isLight ? "bg-gray-50/50 border-gray-200" : "bg-white/[0.02] border-white/5"}`}
          >
            {[
              {
                label: "SOURCE URL",
                icon: Globe,
                value: sourceUrl,
                href: sourceUrl,
              },
              {
                label: "STEP REDIRECT",
                icon: RefreshCw,
                value: stepRedirect,
                href: stepRedirect,
              },
              {
                label: "TARGET URL",
                icon: Target,
                value: targetUrl,
                href: targetUrl,
              },
            ].map((url, i, arr) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 transition-all group ${i < arr.length - 1 ? (isLight ? "border-b border-gray-200" : "border-b border-white/5") : ""} ${isLight ? "hover:bg-black/[0.01]" : "hover:bg-white/[0.03]"}`}
              >
                <div className="flex items-center gap-2 shrink-0 w-44">
                  {url.icon && (
                    <url.icon
                      size={13}
                      className="text-[#9f9f9f] opacity-70 shrink-0"
                    />
                  )}
                  <span className="text-[12px] font-bold uppercase text-[#9f9f9f]">
                    {url.label}
                  </span>
                </div>
                <span
                  className={`text-[14px] truncate flex-1 min-w-0 ${isLight ? "text-gray-800" : "text-white/80"}`}
                >
                  {url.value || "—"}
                </span>
                <div className="flex items-center shrink-0">
                  {url.value && <CopyBtn text={url.value} />}
                  {url.href && (
                    <a
                      href={url.href}
                      target="_blank"
                      rel="noreferrer"
                      className={`p-1.5 rounded-md transition-colors ${isLight ? "text-gray-400 hover:text-gray-500 hover:bg-gray-100" : "text-white/30 hover:text-white/60 hover:bg-white/10"}`}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BasicInfo;

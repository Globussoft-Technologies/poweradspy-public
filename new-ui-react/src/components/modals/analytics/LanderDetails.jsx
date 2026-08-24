import { useState, useEffect, useRef } from "react";
import { ExternalLink, ShieldCheck, Monitor } from "lucide-react"; // Monitor kept for section header
import { useTheme } from "../../../hooks/useTheme";
import { resolveNasUrl } from "../../../services/api";

function parseDisplayUrl(raw) {
  if (!raw) return null;
  let url = raw;
  // white_ad_screenshot arrives already parsed into a real array (the backend
  // JSON-parses any DB string that looks like an array before responding).
  if (Array.isArray(url)) {
    url = url.find(Boolean) || null;
  } else if (typeof url === "string" && url.startsWith("[")) {
    // Some endpoints still send the raw JSON-array string, e.g. '["//path/to/img.png"]'.
    try {
      const arr = JSON.parse(url);
      if (Array.isArray(arr) && arr.length > 0) url = arr[0];
    } catch {
      /* fall through */
    }
  }
  if (typeof url !== "string" || !url) return null;
  const resolved = resolveNasUrl(url);
  if (typeof resolved !== "string" || !resolved) return null;
  // Clean double slashes (but not the protocol ://) — the backend always sends
  // a fully-qualified URL, so no base-URL prepending is needed here.
  return resolved.replace(/([^:])\/\//g, "$1/");
}

const LanderDetails = ({ screenshotUrl, pageUrl = null }) => {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const resolvedScreenshotUrl = parseDisplayUrl(screenshotUrl);
  const resolvedPageUrl = parseDisplayUrl(pageUrl) || resolvedScreenshotUrl;
  const [hasError, setHasError] = useState(false);
  const settledRef = useRef(false); // set by onLoad/onError once the image resolves

  // Set timeout to hide if image doesn't load within 15 seconds. A cold CDN
  // cache (cf-cache-status: MISS on first fetch) can take a few seconds past
  // the old 5s budget, so this only needs to catch genuinely dead URLs.
  useEffect(() => {
    setHasError(false);
    settledRef.current = false;
    if (!resolvedScreenshotUrl) return;
    const timer = setTimeout(() => {
      if (!settledRef.current) setHasError(true);
    }, 15000);
    return () => clearTimeout(timer);
  }, [resolvedScreenshotUrl]);

  // processing.gif or null/empty means screenshot not ready
  const isProcessing =
    !screenshotUrl ||
    (typeof screenshotUrl === "string" &&
      screenshotUrl.includes("processing.gif")) ||
    (typeof screenshotUrl === "string" && screenshotUrl.includes("[null]"));

  // Hide if no valid URL, processing, or image failed to load
  if (isProcessing || hasError || !resolvedScreenshotUrl) return null;

  return (
    <div className="px-6">
      <div className="flex items-center justify-between mb-2">
        <h3
          className={`flex items-center gap-2 text-[18px] font-bold tracking-wider ${isLight ? "text-gray-800" : "text-white/90"}`}
        >
          <Monitor size={16} className="opacity-60" />
          Lander Details
        </h3>
        {!isProcessing && (
          <a
            href={resolvedPageUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#3762c1]/10 hover:bg-[#3762c1]/20 text-[#6b99ff] rounded-lg text-[10px] font-bold border border-[#3759a3]/20 transition-all"
          >
            Visit <ExternalLink size={11} />
          </a>
        )}
      </div>

      <div
        className={`rounded-xl overflow-hidden border ${isLight ? "bg-white shadow-sm border-gray-200" : "bg-white/[0.02] border-white/8"}`}
      >
        {/* Address bar */}
        <div
          className={`flex items-center gap-2 px-3 py-2 border-b ${isLight ? "bg-gray-50 border-gray-200" : "bg-white/[0.03] border-white/5"}`}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
          </div>
          <div
            className={`flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] truncate ${isLight ? "bg-gray-200/60 text-gray-500" : "bg-white/5 text-white/30"}`}
          >
            <ShieldCheck size={10} className="text-emerald-400 shrink-0" />
            <span className="truncate">{resolvedPageUrl || "No URL"}</span>
          </div>
        </div>
        {/* Scrollable screenshot */}
        <div
          className="relative group"
          style={{ height: "320px", overflowY: "auto", overflowX: "hidden" }}
        >
          <img
            src={resolvedScreenshotUrl}
            alt="Lander Screenshot"
            className="w-full opacity-90 group-hover:opacity-100 transition-opacity duration-300"
            style={{ display: "block" }}
            onError={() => {
              settledRef.current = true;
              setHasError(true);
            }}
            onLoad={() => {
              settledRef.current = true;
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default LanderDetails;

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, ShieldCheck, Monitor, Maximize2, X } from "lucide-react"; // Monitor kept for section header
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
  const [showPreview, setShowPreview] = useState(false);
  const settledRef = useRef(false); // set by onLoad/onError once the image resolves

  // Close the enlarged preview on Escape.
  useEffect(() => {
    if (!showPreview) return;
    const onKeyDown = (e) => { if (e.key === "Escape") setShowPreview(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showPreview]);

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#3762c1]/10 hover:bg-[#3762c1]/20 text-[#6b99ff] rounded-lg text-[10px] font-bold border border-[#3759a3]/20 transition-all"
            >
              Preview <Maximize2 size={11} />
            </button>
            <a
              href={resolvedPageUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#3762c1]/10 hover:bg-[#3762c1]/20 text-[#6b99ff] rounded-lg text-[10px] font-bold border border-[#3759a3]/20 transition-all"
            >
              Visit <ExternalLink size={11} />
            </a>
          </div>
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
          className="relative cursor-zoom-in"
          style={{ height: "320px", overflowY: "auto", overflowX: "hidden" }}
          onClick={() => setShowPreview(true)}
        >
          <img
            src={resolvedScreenshotUrl}
            alt="Lander Screenshot"
            className="w-full"
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

      {showPreview &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
            onClick={() => setShowPreview(false)}
          >
            {/* Sized to match AnalyticsModal's own footprint (w-full max-w-[1240px], 94vh)
                so the preview reads as "the same modal, filled with the lander" rather than
                a full-viewport lightbox. The image renders at natural width and the container
                scrolls — the full page height is reachable, not squeezed to fit. */}
            <div
              className="relative w-full max-w-[1240px] rounded-[32px] overflow-hidden bg-[#0e0e0e] border-2 border-white/30 shadow-2xl"
              style={{ maxHeight: "94vh" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                aria-label="Close preview"
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
              >
                <X size={18} />
              </button>
              <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: "94vh" }}>
                <img
                  src={resolvedScreenshotUrl}
                  alt="Lander Screenshot — enlarged"
                  className="w-full"
                  style={{ display: "block" }}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default LanderDetails;

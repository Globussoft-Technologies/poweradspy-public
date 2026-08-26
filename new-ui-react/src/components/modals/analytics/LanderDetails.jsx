import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, ShieldCheck, Monitor, Maximize2, Download, X, MessageCircle, Phone } from "lucide-react";
import { useTheme } from "../../../hooks/useTheme";
import { fetchImageBlob, resolveNasUrl } from "../../../services/api";

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
  // Clean double slashes (but not the protocol ://) - the backend always sends
  // a fully-qualified URL, so no base-URL prepending is needed here.
  return resolved.replace(/([^:])\/\//g, "$1/");
}

function screenshotFilename(url, downloadId = null) {
  const preferredId = downloadId == null ? "" : String(downloadId).trim();
  const defaultName = preferredId ? `lander-${preferredId}.png` : "lander-screenshot.png";
  if (!url) return defaultName;

  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    const ext = name && /\.[a-z0-9]+$/i.test(name) ? name.match(/\.[a-z0-9]+$/i)?.[0] : "";
    return preferredId ? `lander-${preferredId}${ext || ".png"}` : (name || defaultName);
  } catch {
    const name = String(url).split("/").filter(Boolean).pop();
    const ext = name && /\.[a-z0-9]+$/i.test(name) ? name.match(/\.[a-z0-9]+$/i)?.[0] : "";
    return preferredId ? `lander-${preferredId}${ext || ".png"}` : (name || defaultName);
  }
}

function asWhatsappEntries(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
      return [];
    }
  }
  if (typeof value === "object") return [value];
  return [];
}

function readWhatsappUrl(entry) {
  if (!entry || typeof entry !== "object") return null;
  for (const key of ["url", "href", "link", "path"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizePhoneNumber(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function extractPhoneFromWhatsappUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split("/").filter(Boolean).pop();
    return normalizePhoneNumber(path);
  } catch {
    return null;
  }
}

function collectWhatsappPhoneNumbers(value) {
  const seen = new Set();
  const phoneNumbers = [];

  for (const entry of asWhatsappEntries(value)) {
    const directPhone = normalizePhoneNumber(
      entry?.phone ?? entry?.phone_number ?? entry?.msisdn
    );
    const fallbackPhone = extractPhoneFromWhatsappUrl(readWhatsappUrl(entry));
    const phone = directPhone || fallbackPhone;
    if (!phone) continue;

    const key = phone.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phoneNumbers.push(phone);
  }

  return phoneNumbers;
}

const LanderDetails = ({
  screenshotUrl,
  pageUrl = null,
  downloadId = null,
  whatsappEntries = undefined,
  whatsappRotatorCount = undefined,
}) => {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const resolvedScreenshotUrl = parseDisplayUrl(screenshotUrl);
  const resolvedPageUrl = parseDisplayUrl(pageUrl) || resolvedScreenshotUrl;
  const phoneNumbers = collectWhatsappPhoneNumbers(whatsappEntries);
  const parsedRotatorCount = Number(whatsappRotatorCount);
  const hasRotatorCount = Number.isFinite(parsedRotatorCount);
  const rotatorCount = hasRotatorCount ? parsedRotatorCount : phoneNumbers.length;
  const showPhoneNumbers = rotatorCount > 0;
  const showWhatsappDetails = hasRotatorCount || phoneNumbers.length > 0;
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

  async function handleDownload() {
    if (!resolvedScreenshotUrl) return;

    const filename = screenshotFilename(resolvedScreenshotUrl, downloadId);
    try {
      // Download the authenticated proxy bytes so the browser never falls back
      // to opening the raw CDN screenshot URL in a new tab.
      const blob = await fetchImageBlob(resolvedScreenshotUrl);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      console.error("Failed to download lander screenshot", error);
    }
  }

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
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#3762c1]/10 hover:bg-[#3762c1]/20 text-[#6b99ff] rounded-lg text-[10px] font-bold border border-[#3759a3]/20 transition-all"
            >
              Download <Download size={11} />
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

      {showWhatsappDetails && (
        <div
          className={`mt-4 rounded-xl border px-4 py-4 ${isLight ? "bg-white shadow-sm border-gray-200" : "bg-white/[0.02] border-white/8"}`}
        >
          <h4
            className={`flex items-center gap-2 text-[13px] font-bold tracking-[0.18em] uppercase ${isLight ? "text-gray-700" : "text-white/80"}`}
          >
            <MessageCircle size={14} className="opacity-70" />
            WhatsApp Details
          </h4>

          <div className={`mt-3 grid gap-3 ${showPhoneNumbers ? "md:grid-cols-[180px_1fr]" : ""}`}>
            <div
              className={`rounded-lg border px-3 py-3 ${isLight ? "bg-emerald-50/70 border-emerald-200 text-emerald-900" : "bg-emerald-500/10 border-emerald-400/20 text-emerald-100"}`}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">
                Rotator Count
              </div>
              <div className="mt-1 text-[22px] font-black tabular-nums">
                {rotatorCount}
              </div>
            </div>

            {showPhoneNumbers && (
              <div
                className={`rounded-lg border px-3 py-3 ${isLight ? "bg-gray-50 border-gray-200" : "bg-white/[0.03] border-white/8"}`}
              >
                <div
                  className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] ${isLight ? "text-gray-500" : "text-white/45"}`}
                >
                  <Phone size={12} />
                  Phone Numbers Found
                </div>

                {phoneNumbers.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {phoneNumbers.map((phone) => (
                      <span
                        key={phone}
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-semibold ${isLight ? "bg-white border-gray-200 text-gray-700" : "bg-white/5 border-white/10 text-white/85"}`}
                      >
                        {phone}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className={`mt-3 text-[12px] ${isLight ? "text-gray-500" : "text-white/45"}`}>
                    No phone numbers found.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showPreview &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
            onClick={() => setShowPreview(false)}
          >
            {/* Sized to match AnalyticsModal's own footprint (w-full max-w-[1240px], 94vh)
                so the preview reads as "the same modal, filled with the lander" rather than
                a full-viewport lightbox. The image renders at natural width and the container
                scrolls - the full page height is reachable, not squeezed to fit. */}
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
              {/* Address bar — sits outside the scrollable image container below,
                  so it stays fixed at the top of the preview instead of scrolling
                  away with the screenshot. */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-[#1a1a1a] border-white/10">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                </div>
                <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] truncate bg-white/10 text-white mr-10">
                  <ShieldCheck size={11} className="text-emerald-400 shrink-0" />
                  <span className="truncate">{resolvedPageUrl || "No URL"}</span>
                </div>
              </div>
              <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: "calc(94vh - 41px)" }}>
                <img
                  src={resolvedScreenshotUrl}
                  alt="Lander Screenshot - enlarged"
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

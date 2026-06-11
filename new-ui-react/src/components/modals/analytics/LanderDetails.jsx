import { useState } from "react";
import { ExternalLink, ShieldCheck, Monitor } from "lucide-react"; // Monitor kept for section header
import { useTheme } from "../../../hooks/useTheme";

const NAS_BASE_URL = import.meta.env.VITE_NAS_BASE_URL;
//  const NAS_BASE_URL = 'https://content-dev.poweradspy.com';
console.log("NAS_BASE_URL:", NAS_BASE_URL);

function parseScreenshotUrl(raw) {
  if (!raw) return null;
  let url = raw;
  // API may return a JSON array string like '["//path/to/img.png"]'
  if (typeof url === "string" && url.startsWith("[")) {
    try {
      const arr = JSON.parse(url);
      if (Array.isArray(arr) && arr.length > 0) url = arr[0];
    } catch {
      /* fall through */
    }
  }
  if (typeof url !== "string" || !url) return null;
  // Clean double slashes (but not the protocol ://)
  url = url.replace(/([^:])\/\//g, "$1/");
  // If it's a relative path, prepend NAS base URL
  if (url.startsWith("/") && !url.startsWith("//")) {
    return NAS_BASE_URL + url;
  }
  if (!url.startsWith("http")) {
    return NAS_BASE_URL + "/" + url;
  }
  return url;
}

const LanderDetails = ({ screenshotUrl }) => {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const resolvedUrl = parseScreenshotUrl(screenshotUrl);
  const [hasError, setHasError] = useState(false);

  // processing.gif or null/empty means screenshot not ready
  const isProcessing =
    !screenshotUrl ||
    (typeof screenshotUrl === "string" &&
      screenshotUrl.includes("processing.gif")) ||
    (typeof screenshotUrl === "string" && screenshotUrl.includes("[null]"));

  if (isProcessing || hasError) return null;

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
            href={resolvedUrl || "#"}
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
            <span className="truncate">{resolvedUrl || "No URL"}</span>
          </div>
        </div>
        {/* Scrollable screenshot */}
        <div
          className="relative group"
          style={{ height: "320px", overflowY: "auto", overflowX: "hidden" }}
        >
          <img
            src={resolvedUrl}
            alt="Lander Screenshot"
            className="w-full opacity-90 group-hover:opacity-100 transition-opacity duration-300"
            style={{ display: "block" }}
            onError={() => setHasError(true)}
          />
        </div>
      </div>
    </div>
  );
};

export default LanderDetails;

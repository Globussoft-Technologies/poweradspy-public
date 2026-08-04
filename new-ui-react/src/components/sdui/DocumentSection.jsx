import { useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import SDUIIcon from "./SDUIIcon";
import { useTheme } from "../../hooks/useTheme";

/**
 * Renders a single SDUIDocument as a collapsible section.
 * Shows title bar with icon + chevron. Sections start collapsed on every page
 * load so a server-side presentation hint cannot unexpectedly open the whole
 * filter sidebar.
 */
const DocumentSection = ({ document: doc, children, clickOnly = false, onHeaderClick }) => {
  const { theme } = useTheme();
  const isLightTheme = theme === "light";
  const [isCollapsed, setIsCollapsed] = useState(true);
  const contentRef = useRef(null);

  if (!doc) return null;

  // SDUI titles are normalized for the existing title-case presentation, but
  // product acronyms must retain their canonical capitalization.
  const displayTitle = doc.title?.toLowerCase().replace(/\bai\b/g, "AI");
  const isAiSignalsSection =
    doc._id === "ai_meta" || /ai signals/i.test(String(doc.title || ""));

  const handleToggle = () => {
    if (clickOnly) {
      onHeaderClick?.(doc);
      return;
    }

    const willExpand = isCollapsed;
    setIsCollapsed(!isCollapsed);
    if (willExpand) {
      // Wait for the max-h transition (200ms) so the content has its real height,
      // then scroll it into view if it's clipped by the sidebar's scroll container.
      setTimeout(() => {
        contentRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 220);
    }
  };

  return (
    <div className={`mb-1`}>
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-3 pt-3 pb-1.5 group"
      >
        <div className="flex items-center gap-1.5">
          {doc.icon && doc.icon.type !== "none" && (
            <SDUIIcon
              icon={doc.icon}
              size={11}
              className={`transition-colors ${isAiSignalsSection ? (isLightTheme ? "text-[#335296] group-hover:text-[#6b99ff]" : "text-[#f5c86a] group-hover:text-[#ffd77f]") : "text-theme-text-muted group-hover:text-[#6b99ff]"}`}
            />
          )}
          <span className={`text-[14px] tracking-wider transition-colors capitalize ${isAiSignalsSection ? "text-theme-text group-hover:text-[#6b99ff]" : "text-theme-text-secondary group-hover:text-theme-text"}`}>
            {displayTitle}
          </span>
          {isAiSignalsSection && (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] shadow-[0_0_0_1px_rgba(55,89,163,0.06)] ${isLightTheme ? "border-[#3759a3]/30 bg-[#3762c1]/10 text-[#335296]" : "border-[#f5c86a]/40 bg-[#f5c86a]/10 text-[#f5c86a]"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isLightTheme ? "bg-[#335296] shadow-[0_0_8px_rgba(51,82,150,0.45)]" : "bg-[#f5c86a] shadow-[0_0_8px_rgba(245,200,106,0.55)]"}`} />
              New
            </span>
          )}
        </div>
        <ChevronDown
          size={12}
          className={`text-theme-text-muted group-hover:text-theme-text transition-all duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!clickOnly && (
        <div
          ref={contentRef}
          className={`sdui-section-scroll transition-all duration-200 ${isCollapsed ? "max-h-0 overflow-hidden opacity-0" : "max-h-[320px] overflow-y-auto opacity-100 mb-2"}`}
        >
          {children}
        </div>
      )}
      <style>{`
        .sdui-section-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(71, 85, 105, 0.75) transparent;
        }
        .sdui-section-scroll::-webkit-scrollbar { width: 5px; }
        .sdui-section-scroll::-webkit-scrollbar-track { background: transparent; }
        .sdui-section-scroll::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.75);
          border-radius: 9999px;
        }
      `}</style>
    </div>
  );
};

export default DocumentSection;

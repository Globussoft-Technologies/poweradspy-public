import { useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import SDUIIcon from "./SDUIIcon";

/**
 * Renders a single SDUIDocument as a collapsible section.
 * Shows title bar with icon + chevron, collapse/expand based on collapsed_by_default.
 */
const DocumentSection = ({ document: doc, children, clickOnly = false, onHeaderClick }) => {
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
              className={`transition-colors ${isAiSignalsSection ? "text-[#f5c86a] group-hover:text-[#ffd77f]" : "text-theme-text-muted group-hover:text-[#6b99ff]"}`}
            />
          )}
          <span className={`text-[14px] tracking-wider transition-colors capitalize ${isAiSignalsSection ? "text-theme-text group-hover:text-[#ffd77f]" : "text-theme-text-secondary group-hover:text-theme-text"}`}>
            {displayTitle}
          </span>
          {isAiSignalsSection && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#f5c86a]/40 bg-[#f5c86a]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#f5c86a] shadow-[0_0_0_1px_rgba(245,200,106,0.06)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#f5c86a] shadow-[0_0_8px_rgba(245,200,106,0.55)]" />
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
          className={`transition-all duration-200 overflow-hidden ${isCollapsed ? "max-h-0 opacity-0" : "max-h-[300px] overflow-y-auto opacity-100 mb-2"}`}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default DocumentSection;

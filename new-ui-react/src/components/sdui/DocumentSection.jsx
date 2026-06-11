import { useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import SDUIIcon from "./SDUIIcon";

/**
 * Renders a single SDUIDocument as a collapsible section.
 * Shows title bar with icon + chevron, collapse/expand based on collapsed_by_default.
 */
const DocumentSection = ({ document: doc, children }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const contentRef = useRef(null);

  if (!doc) return null;

  const handleToggle = () => {
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
              className="text-theme-text-muted group-hover:text-[#6b99ff] transition-colors"
            />
          )}
          <span className="text-[14px] text-theme-text-secondary tracking-wider group-hover:text-theme-text transition-colors capitalize">
            {doc.title?.toLowerCase()}
          </span>
        </div>
        <ChevronDown
          size={12}
          className={`text-theme-text-muted group-hover:text-theme-text transition-all duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
        />
      </button>
      <div
        ref={contentRef}
        className={`transition-all duration-200 overflow-hidden ${isCollapsed ? "max-h-0 opacity-0" : "max-h-[300px] overflow-y-auto opacity-100 mb-2"}`}
      >
        {children}
      </div>
    </div>
  );
};

export default DocumentSection;

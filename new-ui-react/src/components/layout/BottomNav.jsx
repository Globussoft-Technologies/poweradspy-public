import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Library, Hash, TrendingUp, Bookmark, SlidersHorizontal, MoreHorizontal, MessageCircle } from "lucide-react";

/**
 * BottomNav — app-style navigation for the installed PWA on phones.
 *
 * Rendered by App only when useInstalledMobile() is true. Mirrors the
 * Sidebar's nav items and their access checks; the Sidebar itself becomes a
 * filters-only drawer opened from the "Filters" tab.
 */
let chatCloseListenerAdded = false;

const TabButton =({ icon, label, active, onClick, badge }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 h-full transition-colors ${
      active ? "text-[#3762c1]" : "text-theme-text-muted"
    }`}
  >
    <span className="relative">
      {icon}
      {badge ? (
        <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-[#3762c1] text-white text-[9px] font-bold leading-none">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </span>
    <span className="max-w-full truncate px-1 text-[10px] font-semibold">{label}</span>
  </button>
);

const BottomNav = ({
  activePage = "ads",
  showSavedAdsPage = false,
  onPageChange,
  onShowSavedAdsPage,
  onOpenKeywordsExplorer,
  onOpenFilters,
  activeFilterCount = 0,
  guest,
  onRestricted,
  canAccessProjects = false,
  projectsAccessResolved = true,
  projectsAccessUnavailable = false,
  intelligenceEnabled = false,
  keywordExplorerEnabled = false,
  isLoggedIn = false,
  allowedPlatforms,
}) => {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);

  const onAdsLibrary = activePage === "ads" && !showSavedAdsPage;
  const showSaved = isLoggedIn && (allowedPlatforms == null || allowedPlatforms.length > 0);
  // Always shown: it also holds "Chat with us" (Freshchat's floating launcher
  // is hidden in the installed app — see ChatbotWidget).
  const showMore = true;

  // index.css hides #fc_frame in the installed app unless body has
  // .pwa-chat-open; drop the class again once the chat window is closed.
  const openChat = () => {
    setMoreOpen(false);
    const widget = window.fcWidget;
    if (!widget) return;
    document.body.classList.add("pwa-chat-open");
    if (!chatCloseListenerAdded && widget.on) {
      widget.on("widget:closed", () => document.body.classList.remove("pwa-chat-open"));
      chatCloseListenerAdded = true;
    }
    widget.open?.();
  };

  // Same rules as the Sidebar's "All Projects" item.
  const openProjects = () => {
    if (guest?.isRestricted) {
      onRestricted?.();
      return;
    }
    if (!projectsAccessResolved || projectsAccessUnavailable || canAccessProjects) {
      onPageChange?.("projects");
    } else {
      onRestricted?.();
    }
  };

  const openMarketTrends = () => {
    setMoreOpen(false);
    if (guest?.isRestricted) {
      onRestricted?.();
      return;
    }
    onPageChange?.("intelligence");
  };

  const openKeywordsExplorer = () => {
    setMoreOpen(false);
    onOpenKeywordsExplorer?.();
  };

  const iconSize = 20;

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-[44]" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute right-2 w-52 rounded-xl border border-theme-border bg-theme-card shadow-2xl py-1"
            style={{ bottom: "calc(64px + env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            {intelligenceEnabled && (
              <button
                type="button"
                onClick={openMarketTrends}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold ${
                  activePage === "intelligence" ? "text-[#3762c1]" : "text-theme-text"
                }`}
              >
                <TrendingUp size={18} />
                <span className="flex-1 text-left">{t("market_trends", "Market Trends")}</span>
              </button>
            )}
            {keywordExplorerEnabled && (
              <button
                type="button"
                onClick={openKeywordsExplorer}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold ${
                  activePage === "keywords-explorer" ? "text-[#3762c1]" : "text-theme-text"
                }`}
              >
                <Hash size={18} />
                <span className="flex-1 text-left">{t("keywords_explorer")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={openChat}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-theme-text"
            >
              <MessageCircle size={18} />
              <span className="flex-1 text-left">{t("chat_with_us", "Chat with us")}</span>
            </button>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-theme-border bg-theme-card"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex h-14 items-stretch">
          <TabButton
            icon={<Library size={iconSize} />}
            label={t("ads_library")}
            active={onAdsLibrary}
            onClick={() => onPageChange?.("ads")}
          />
          <TabButton
            icon={<LayoutGrid size={iconSize} />}
            label={t("all_projects")}
            active={activePage === "projects"}
            onClick={openProjects}
          />
          {showSaved && (
            <TabButton
              icon={<Bookmark size={iconSize} />}
              label={t("saved", "Saved")}
              active={showSavedAdsPage}
              onClick={() => { if (!showSavedAdsPage) onShowSavedAdsPage?.(); }}
            />
          )}
          {onAdsLibrary && (
            <TabButton
              icon={<SlidersHorizontal size={iconSize} />}
              label={t("filters")}
              onClick={onOpenFilters}
              badge={activeFilterCount}
            />
          )}
          {showMore && (
            <TabButton
              icon={<MoreHorizontal size={iconSize} />}
              label={t("more", "More")}
              active={moreOpen || activePage === "intelligence" || activePage === "keywords-explorer"}
              onClick={() => setMoreOpen((open) => !open)}
            />
          )}
        </div>
      </nav>
    </>
  );
};

export default BottomNav;

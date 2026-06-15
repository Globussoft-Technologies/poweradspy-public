import { describe, it, expect } from "vitest";
import reducer, {
  openModal, closeModal,
  setActivePage, setShowSavedAdsPage, setSidebarOpen,
  setSearchQuery, setSearchIn, setExactSearch, setActiveTab,
  setPreviewMode, setSpecificPlatforms, setSavedAdsTab,
} from "../../src/store/uiSlice.js";

describe("store/uiSlice > initial state", () => {
  it("returns the initial state when called with undefined + unknown action", () => {
    const s = reducer(undefined, { type: "@@INIT" });
    expect(s).toMatchObject({
      isAIAnalysisModalOpen: false,
      isCampaignModalOpen: false,
      isPricingModalOpen: false,
      isAnalyticsModalOpen: false,
      isSubscriptionModalOpen: false,
      activePage: "ads",
      showSavedAdsPage: false,
      isSidebarOpen: true,
      searchQuery: "",
      searchIn: "keyword",
      exactSearch: false,
      activeTab: "",
      previewMode: false,
      specificPlatforms: [],
      savedAdsTab: "favourites",
    });
  });
});

describe("store/uiSlice > openModal/closeModal", () => {
  it("openModal sets the named key true", () => {
    const s = reducer(undefined, openModal("isCampaignModalOpen"));
    expect(s.isCampaignModalOpen).toBe(true);
  });
  it("closeModal sets the named key false", () => {
    const opened = reducer(undefined, openModal("isPricingModalOpen"));
    const closed = reducer(opened, closeModal("isPricingModalOpen"));
    expect(closed.isPricingModalOpen).toBe(false);
  });
});

describe("store/uiSlice > setters", () => {
  it.each([
    [setActivePage, "activePage", "saved"],
    [setShowSavedAdsPage, "showSavedAdsPage", true],
    [setSidebarOpen, "isSidebarOpen", false],
    [setSearchQuery, "searchQuery", "hello"],
    [setSearchIn, "searchIn", "domain"],
    [setExactSearch, "exactSearch", true],
    [setActiveTab, "activeTab", "Oldest"],
    [setPreviewMode, "previewMode", true],
    [setSpecificPlatforms, "specificPlatforms", ["facebook", "google"]],
    [setSavedAdsTab, "savedAdsTab", "lists"],
  ])("%s assigns the payload to its field", (action, key, value) => {
    const s = reducer(undefined, action(value));
    expect(s[key]).toEqual(value);
  });
});

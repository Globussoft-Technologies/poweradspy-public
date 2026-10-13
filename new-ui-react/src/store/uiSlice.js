import { createSlice } from '@reduxjs/toolkit';

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    // Modal states
    isAIAnalysisModalOpen: false,
    isCampaignModalOpen: false,
    isPricingModalOpen: false,
    isAnalyticsModalOpen: false,
    isSubscriptionModalOpen: false,
    isOnboardingModalOpen: false,
    // Page states
    activePage: 'ads',
    showSavedAdsPage: false,
    showMySpacePage: false,
    // /profile/<tab> — one page, several tabs (see profile-spec.md). Replaces
    // the old standalone showCreditsPage/CreditsPage with a tab of this.
    showProfilePage: false,
    profileTab: 'credits',
    // Sidebar
    isSidebarOpen: true,
    // Search
    searchQuery: '',
    // Keyword/advertiser list from AI Search ({ searchIn, query, terms }), kept
    // beside searchQuery so the request can send it as an array.
    searchList: null,
    aiPrompt: '',
    searchIn: 'keyword',
    exactSearch: false,
    activeTab: '',
    // Other
    previewMode: false,
    specificPlatforms: [],
    savedAdsTab: 'favourites',
  },
  reducers: {
    openModal: (state, action) => {
      state[action.payload] = true;
    },
    closeModal: (state, action) => {
      state[action.payload] = false;
    },
    setActivePage: (state, action) => {
      state.activePage = action.payload;
    },
    setShowSavedAdsPage: (state, action) => {
      state.showSavedAdsPage = action.payload;
    },
    setShowMySpacePage: (state, action) => {
      state.showMySpacePage = action.payload;
    },
    setShowProfilePage: (state, action) => {
      state.showProfilePage = action.payload;
    },
    setProfileTab: (state, action) => {
      state.profileTab = action.payload;
    },
    setSidebarOpen: (state, action) => {
      state.isSidebarOpen = action.payload;
    },
    setSearchQuery: (state, action) => {
      state.searchQuery = action.payload;
    },
    setSearchList: (state, action) => {
      state.searchList = action.payload;
    },
    setAiPrompt: (state, action) => {
      state.aiPrompt = action.payload;
    },
    setSearchIn: (state, action) => {
      state.searchIn = action.payload;
    },
    setExactSearch: (state, action) => {
      state.exactSearch = action.payload;
    },
    setActiveTab: (state, action) => {
      state.activeTab = action.payload;
    },
    setPreviewMode: (state, action) => {
      state.previewMode = action.payload;
    },
    setSpecificPlatforms: (state, action) => {
      state.specificPlatforms = action.payload;
    },
    setSavedAdsTab: (state, action) => {
      state.savedAdsTab = action.payload;
    },
  },
});

export const {
  openModal,
  closeModal,
  setActivePage,
  setShowSavedAdsPage,
  setShowMySpacePage,
  setShowProfilePage,
  setProfileTab,
  setSidebarOpen,
  setSearchQuery,
  setSearchList,
  setAiPrompt,
  setSearchIn,
  setExactSearch,
  setActiveTab,
  setPreviewMode,
  setSpecificPlatforms,
  setSavedAdsTab,
} = uiSlice.actions;
export default uiSlice.reducer;

import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer } from 'redux-persist';
import storage from 'redux-persist/lib/storage'; // defaults to localStorage for web
import uiReducer from './uiSlice';

// If opened via email link (?advertiser=...), wipe persisted activePage so it
// doesn't override the ads page we're about to navigate to. Normal visits are unaffected.
if (new URLSearchParams(window.location.search).get('advertiser')) {
  try {
    const raw = localStorage.getItem('persist:root');
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.activePage = '"ads"';
      parsed.showSavedAdsPage = 'false';
      localStorage.setItem('persist:root', JSON.stringify(parsed));
    }
  } catch {}
}

// One-time cleanup: older builds persisted `activeTab` (default "Newest"), which
// rehydrates a highlighted quick-sort pill on load even though no sort is applied.
// redux-persist's blacklist only blocks writes, not reads, so strip any stale value
// here so existing users start with no pill selected.
try {
  const raw = localStorage.getItem('persist:root');
  if (raw) {
    const parsed = JSON.parse(raw);
    if ('activeTab' in parsed) {
      delete parsed.activeTab;
      localStorage.setItem('persist:root', JSON.stringify(parsed));
    }
  }
} catch {}

const persistConfig = {
  key: 'root',
  storage,
  // Modal states must not be persisted — they should always start closed on fresh load
  blacklist: [
    'isPricingModalOpen',
    // activeTab (quick sort) must not be persisted — the actual sort value (sortBy)
    // is non-persisted React state, so persisting activeTab left a pill highlighted
    // on reload while no sort was applied. Always start unselected.
    'activeTab',
    // 'isAIAnalysisModalOpen',
    // 'isCampaignModalOpen',
    // 'isAnalyticsModalOpen',
    // 'isSubscriptionModalOpen',
    // 'activePage',
  ],
};

const persistedReducer = persistReducer(persistConfig, uiReducer);

export const store = configureStore({
  reducer: {
    ui: persistedReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    }),
});

export const persistor = persistStore(store);
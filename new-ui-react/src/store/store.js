import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer } from 'redux-persist';
import sessionStorage from 'redux-persist/lib/storage/session';
import uiReducer from './uiSlice';

// If opened via email link (?advertiser=...), wipe persisted activePage so it
// doesn't override the ads page we're about to navigate to. Normal visits are unaffected.
if (new URLSearchParams(window.location.search).get('advertiser')) {
  try {
    const raw = window.sessionStorage.getItem('persist:root');
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.activePage = '"ads"';
      parsed.showSavedAdsPage = 'false';
      window.sessionStorage.setItem('persist:root', JSON.stringify(parsed));
    }
  } catch {}
}

// redux-persist's blacklist blocks future writes but does not remove values
// written by older builds. Clear every transient value before rehydration so a
// stale pricing/subscription modal cannot reopen on a paid user's next login.
try {
  const raw = window.sessionStorage.getItem('persist:root');
  if (raw) {
    const parsed = JSON.parse(raw);
    const transientKeys = [
      'activeTab',
      'isAIAnalysisModalOpen',
      'isCampaignModalOpen',
      'isPricingModalOpen',
      'isAnalyticsModalOpen',
      'isSubscriptionModalOpen',
      'isOnboardingModalOpen',
    ];
    let changed = false;
    transientKeys.forEach((key) => {
      if (key in parsed) {
        delete parsed[key];
        changed = true;
      }
    });
    if (changed) {
      window.sessionStorage.setItem('persist:root', JSON.stringify(parsed));
    }
  }
} catch {}

const persistConfig = {
  key: 'root',
  // Every Redux UI/navigation value belongs to one tab. Keeping the complete
  // slice in sessionStorage prevents activePage and navigation state in one tab
  // from racing or overriding a second tab.
  storage: sessionStorage,
  // Modal states must not be persisted — they should always start closed on fresh load
  blacklist: [
    'isAIAnalysisModalOpen',
    'isCampaignModalOpen',
    'isPricingModalOpen',
    'isAnalyticsModalOpen',
    'isSubscriptionModalOpen',
    'isOnboardingModalOpen',
    // activeTab (quick sort) must not be persisted — the actual sort value (sortBy)
    // is non-persisted React state, so persisting activeTab left a pill highlighted
    // on reload while no sort was applied. Always start unselected.
    'activeTab',
    // 'isAIAnalysisModalOpen',
    // 'isCampaignModalOpen',
    // 'isAnalyticsModalOpen',
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

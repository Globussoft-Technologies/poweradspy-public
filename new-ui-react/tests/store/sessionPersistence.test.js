import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { persistReducer, persistStore } from 'redux-persist';
import sessionStorageAdapter from 'redux-persist/lib/storage/session';
import uiReducer, {
  setActivePage,
  setSearchQuery,
  setSpecificPlatforms,
} from '../../src/store/uiSlice';

const STORAGE_KEY = 'persist:integration';

const createPersistedUiStore = async () => {
  const reducer = persistReducer({
    key: 'integration',
    storage: sessionStorageAdapter,
  }, uiReducer);
  const store = configureStore({
    reducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE', 'persist/FLUSH'],
      },
    }),
  });
  const persistor = persistStore(store);

  await new Promise((resolve) => {
    if (persistor.getState().bootstrapped) {
      resolve();
      return;
    }
    const unsubscribe = persistor.subscribe(() => {
      if (!persistor.getState().bootstrapped) return;
      unsubscribe();
      resolve();
    });
  });

  return { store, persistor };
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('tab-scoped Redux persistence', () => {
  it('ignores UI/navigation state left in localStorage by another tab', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      activePage: '"projects"',
      searchQuery: '"other-tab-search"',
      specificPlatforms: '["google"]',
    }));

    const { store, persistor } = await createPersistedUiStore();
    try {
      expect(store.getState().activePage).toBe('ads');
      expect(store.getState().searchQuery).toBe('');
      expect(store.getState().specificPlatforms).toEqual([]);
    } finally {
      persistor.pause();
    }
  });

  it('restores and writes the complete UI state only in the current tab', async () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      activePage: '"projects"',
      searchQuery: '"this-tab-search"',
      specificPlatforms: '["google"]',
    }));

    const { store, persistor } = await createPersistedUiStore();
    try {
      expect(store.getState().activePage).toBe('projects');
      expect(store.getState().searchQuery).toBe('this-tab-search');
      expect(store.getState().specificPlatforms).toEqual(['google']);

      store.dispatch(setActivePage('ads'));
      store.dispatch(setSearchQuery('updated-search'));
      store.dispatch(setSpecificPlatforms(['youtube']));
      await persistor.flush();

      const tabState = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      expect(tabState.activePage).toBe('"ads"');
      expect(tabState.searchQuery).toBe('"updated-search"');
      expect(tabState.specificPlatforms).toBe('["youtube"]');
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      persistor.pause();
    }
  });
});

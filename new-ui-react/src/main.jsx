import React from 'react'
import ReactDOM from 'react-dom/client'

// Suppress Google Translate floating badge.
// CSS alone misses it when GT injects its elements after the page loads.
// The MutationObserver fires the instant any new node is added to the DOM
// and immediately hides anything GT-related before it becomes visible.
;(function suppressGoogleTranslateBadge() {
  function hide() {
    // Only hide the floating badge — do NOT touch .skiptranslate or GT iframes
    // because GT needs them to initialise and process language changes.
    document.querySelectorAll('[class*="VIpgJd"], #goog-gt-tt')
      .forEach(function(el) { el.style.setProperty('display', 'none', 'important'); });
    /* v8 ignore next -- document.body is always present when this runs; the guard is defensive */
    if (document.body) document.body.style.setProperty('top', '0', 'important');
  }
  const obs = new MutationObserver(hide);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  hide(); // run once immediately for anything already present
}());
import i18n from './i18n.js'
import App from './App.jsx'
import { ThemeProvider } from './hooks/useTheme.jsx'
import { AuthProvider } from './hooks/useAuth.jsx'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { BrowserRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { store, persistor } from './store/store.js'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <Provider store={store}>
          <PersistGate loading={null} persistor={persistor}>
            <AuthProvider>
              <ThemeProvider>
                <App />
              </ThemeProvider>
            </AuthProvider>
          </PersistGate>
        </Provider>
      </BrowserRouter>
    </I18nextProvider>
  </React.StrictMode>,
)

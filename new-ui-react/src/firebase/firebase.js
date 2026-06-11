// Firebase Cloud Messaging (Web Push) initialization.
// All config comes from the frontend .env (VITE_FIREBASE_*) so there is a single
// source of truth. The same values are forwarded to the service worker via its
// registration query string (see usePushNotifications.js) because a service worker
// cannot read Vite env vars at runtime.
import { initializeApp } from 'firebase/app';
import { getMessaging, isSupported } from 'firebase/messaging';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

// True only when every required value is present (not blank / not the placeholder).
export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (v) => v && !String(v).startsWith('REPLACE_WITH_')
) && VAPID_KEY && !String(VAPID_KEY).startsWith('REPLACE_WITH_');

let app;
function getFirebaseApp() {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

// Returns a Messaging instance, or null if the browser/config does not support FCM.
export async function getMessagingIfSupported() {
  try {
    if (!isFirebaseConfigured) {
      console.warn('[firebase] Missing VITE_FIREBASE_* config — push disabled');
      return null;
    }
    if (!(await isSupported())) return null;
    return getMessaging(getFirebaseApp());
  } catch (err) {
    console.warn('[firebase] Messaging not supported:', err?.message || err);
    return null;
  }
}

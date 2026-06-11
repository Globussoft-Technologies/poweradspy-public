import { useEffect, useState } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
import { useAuth } from './useAuth';
import {
  firebaseConfig,
  VAPID_KEY,
  isFirebaseConfigured,
  getMessagingIfSupported,
} from '../firebase/firebase';

const API_BASE_URL = import.meta.env.VITE_PAS_API_BASE_URL || 'http://localhost:3000';

// The service worker cannot read Vite env vars, so we pass the Firebase web config
// in via its registration query string (base64 JSON). Single source of truth = .env.
const SW_URL = `/firebase-messaging-sw.js?fb=${btoa(JSON.stringify(firebaseConfig))}`;

export const usePushNotifications = () => {
  const { user } = useAuth();
  const [permission, setPermission] = useState('default');
  const [isSupported, setIsSupported] = useState(false);
  const [tokenRegistered, setTokenRegistered] = useState(false);
  const [error, setError] = useState(null);

  // Check if browser supports service workers, notifications AND Firebase is configured
  useEffect(() => {
    const supported =
      'serviceWorker' in navigator && 'Notification' in window && isFirebaseConfigured;
    setIsSupported(supported);

    if (!supported) {
      console.warn('[usePushNotifications] Push not supported (browser or Firebase config missing)');
      return;
    }

    setPermission(Notification.permission);
  }, []);

  // Register the Firebase messaging service worker + listen for foreground messages
  useEffect(() => {
    if (!isSupported || !user) return;

    let unsubscribe;

    const setup = async () => {
      try {
        await navigator.serviceWorker.register(SW_URL, { scope: '/' });
        console.log('[usePushNotifications] Firebase messaging SW registered');

        // Foreground messages: the SW's onBackgroundMessage only fires when the tab
        // is NOT focused, so show the notification here when it is.
        // NOTE: when a service worker controls the page, Chrome forbids `new Notification()`
        // (illegal constructor) — we MUST use registration.showNotification() instead.
        const messaging = await getMessagingIfSupported();
        if (messaging) {
          unsubscribe = onMessage(messaging, async (payload) => {
            const d = payload.data || {};
            if (Notification.permission !== 'granted') return;
            try {
              const reg = await navigator.serviceWorker.ready;
              reg.showNotification(d.title || 'PowerAdSpy', {
                body: d.body || '',
                icon: d.icon || '/assets/imgs/icon-192x192.png',
                badge: '/assets/imgs/icon-192x192.png',
                tag: 'pas-notification',
                data: { link: d.action_button || '/' },
              });
            } catch (e) {
              console.warn('[usePushNotifications] showNotification failed:', e);
            }
          });
        }

        // If permission was already granted in a previous session, silently fetch a
        // fresh (real) FCM token and re-register it. This upgrades any user who was
        // previously stored with a placeholder token — no extra click needed.
        if (Notification.permission === 'granted') {
          try {
            const fcmToken = await getFCMToken();
            await registerTokenWithBackend(fcmToken);
            setTokenRegistered(true);
            setError(null);
          } catch (err) {
            console.warn('[usePushNotifications] Auto re-register failed:', err.message);
          }
        }
      } catch (err) {
        console.error('[usePushNotifications] SW setup failed:', err);
        setError(err.message);
      }
    };

    setup();
    return () => { if (unsubscribe) unsubscribe(); };
  }, [isSupported, user]);

  // Request notification permission and register token with backend
  const requestPermissionAndRegister = async () => {
    if (!isSupported) {
      setError('Notifications not supported in this browser');
      return false;
    }
    if (!user) {
      setError('User not logged in');
      return false;
    }

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        console.warn('[usePushNotifications] Notification permission denied');
        return false;
      }

      const fcmToken = await getFCMToken();
      await registerTokenWithBackend(fcmToken);

      setTokenRegistered(true);
      setError(null);
      return true;
    } catch (err) {
      console.error('[usePushNotifications] Error requesting permission:', err);
      setError(err.message);
      return false;
    }
  };

  // Get a REAL FCM registration token from Firebase using the VAPID key.
  const getFCMToken = async () => {
    const messaging = await getMessagingIfSupported();
    if (!messaging) {
      throw new Error('Firebase Cloud Messaging is not available in this browser');
    }

    // Use the SW we registered (with config in its query string).
    const swRegistration = await navigator.serviceWorker.ready;

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swRegistration,
    });

    if (!token) {
      throw new Error('No FCM token returned — check notification permission / VAPID key');
    }

    localStorage.setItem('fcmToken', token);
    return token;
  };

  // Register token with backend
  const registerTokenWithBackend = async (fcmToken) => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        throw new Error('Auth token not found');
      }

      const response = await fetch(`${API_BASE_URL}/api/v1/common/register-push-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: user.id || user.user_id,
          fcmToken: fcmToken,
          browserInfo: {
            userAgent: navigator.userAgent,
            language: navigator.language,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('[usePushNotifications] Token registered successfully:', data);
      return data;
    } catch (err) {
      console.error('[usePushNotifications] Error registering token:', err);
      throw err;
    }
  };

  return {
    isSupported,
    permission,
    tokenRegistered,
    error,
    requestPermissionAndRegister,
  };
};

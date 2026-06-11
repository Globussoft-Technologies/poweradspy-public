/* Firebase Cloud Messaging service worker.
 *
 * Handles background push messages (when the tab is closed / not focused).
 * The Firebase web config is passed in via the registration query string
 * (?fb=<base64 JSON>) from usePushNotifications.js, so all values live in one
 * place — the frontend .env — and are never duplicated here.
 */
/* global firebase, importScripts, clients */
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js');

try {
  const cfgParam = new URL(self.location).searchParams.get('fb');
  if (cfgParam) {
    const config = JSON.parse(atob(cfgParam));
    firebase.initializeApp(config);
    const messaging = firebase.messaging();

    // Backend sends a DATA-only FCM message (see FirebaseService.sendNotification),
    // so we build and show the notification ourselves here.
    messaging.onBackgroundMessage((payload) => {
      const d = payload.data || {};
      const title = d.title || 'PowerAdSpy';
      const options = {
        body: d.body || '',
        icon: d.icon || '/assets/imgs/icon-192x192.png',
        badge: '/assets/imgs/icon-192x192.png',
        tag: 'pas-notification',
        data: { link: d.action_button || '/' },
      };
      if (d.image) options.image = d.image;
      self.registration.showNotification(title, options);
    });
  }
} catch (err) {
  // Config not provided yet (or parse failure) — SW still installs so click handling works.
  // eslint-disable-next-line no-console
  console.error('[firebase-messaging-sw] init failed:', err);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === link && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});

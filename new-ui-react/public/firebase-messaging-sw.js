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
        icon: d.icon || '/assets/favicon.png',
        badge: '/assets/favicon.png',
        // Same tag on every push so a new "ads found" alert replaces the last
        // one in the OS notification center instead of piling them up — but
        // without `renotify`, a same-tag replacement is SILENT (no popup/sound),
        // it just updates the existing entry, which is why a push could show
        // up in the notification center with no toast ever appearing.
        tag: 'pas-notification',
        renotify: true,
        data: { link: d.action_button || '/' },
        actions: [
          { action: 'open', title: 'Open' },
          { action: 'close', title: 'Close' },
        ],
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
  if (event.action === 'close') return; // "Close" action button — just dismiss, no navigation
  const link = (event.notification.data && event.notification.data.link) || '/';
  // Backend sends a relative link (/?keyword=...) — resolve it so it can be compared
  // with client.url (always absolute) and navigated to.
  const url = new URL(link, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      // Reuse an already-open PowerAdSpy tab: focus it and load the link there, so
      // the page's deep-link handling (App.jsx) runs the search in that tab.
      const appClient = clientList.find((c) => c.url.startsWith(self.location.origin) && 'navigate' in c);
      if (appClient) {
        try {
          await appClient.focus();
          const navigated = await appClient.navigate(url);
          if (navigated) return navigated;
        } catch (e) {
          // Uncontrolled tab (navigate() rejects) — fall back to a new window below.
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

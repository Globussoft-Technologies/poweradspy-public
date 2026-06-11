// Service Worker for Push Notifications
// Handles incoming push notifications and displays them to the user

self.addEventListener('push', event => {
  try {
    const data = event.data.json();
    const { title, body, icon, badge, image, link = '/' } = data;

    const options = {
      body: body,
      icon: icon || '/assets/imgs/icon-192x192.png',
      badge: badge || '/assets/imgs/icon-192x192.png',
      image: image,
      tag: 'notification',
      requireInteraction: false,
      actions: [
        {
          action: 'open',
          title: 'Open',
          icon: '/assets/imgs/icon-192x192.png'
        },
        {
          action: 'close',
          title: 'Close'
        }
      ],
      data: {
        link: link,
        timestamp: new Date().toISOString()
      }
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (error) {
    console.error('Error handling push notification:', error);
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const link = event.notification.data?.link || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Check if there's already a window/tab open with the target URL
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === link && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window/tab with the target URL
      if (clients.openWindow) {
        return clients.openWindow(link);
      }
    })
  );
});

// Handle notification close
self.addEventListener('notificationclose', event => {
  console.log('Notification closed:', event.notification.tag);
});

// Background sync for offline push notifications
self.addEventListener('sync', event => {
  if (event.tag === 'sync-notifications') {
    event.waitUntil(syncNotifications());
  }
});

async function syncNotifications() {
  try {
    // Implementation for syncing notifications when offline
    console.log('Syncing notifications...');
  } catch (error) {
    console.error('Error syncing notifications:', error);
  }
}

// Periodic background sync (if supported)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', event => {
    if (event.tag === 'check-notifications') {
      event.waitUntil(checkNotifications());
    }
  });
}

async function checkNotifications() {
  try {
    // Implementation for checking notifications periodically
    console.log('Checking for notifications...');
  } catch (error) {
    console.error('Error checking notifications:', error);
  }
}

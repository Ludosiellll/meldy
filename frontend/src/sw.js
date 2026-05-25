import { precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

// Precache static assets injected by Vite
precacheAndRoute(self.__WB_MANIFEST || []);

// Force immediate activation of new service worker
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Setup offline fallback using NetworkFirst strategy
const navigationRoute = new NavigationRoute(
  new NetworkFirst({
    cacheName: 'navigations',
    plugins: [
      {
        handlerDidError: async () => {
          return (await caches.match('/offline.html')) || Response.error();
        }
      }
    ]
  }),
  {
    denylist: [
      /^\/api/,      // Exclude API requests
      /^\/supabase/  // Exclude Supabase requests
    ]
  }
);
registerRoute(navigationRoute);

// Push notifications event listener
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'StudyForge', body: event.data.text() };
    }
  }

  const title = data.title || 'Напоминание о повторении';
  const options = {
    body: data.body || 'Пора повторить карточки!',
    icon: '/pwa-192x192.svg',
    badge: '/pwa-192x192.svg',
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event listener
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data.url;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there is already a window/tab open with the target URL
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window/tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

import { matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

// Force immediate activation of new service worker
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // «navigations» held copies of pages from older releases (see the page route below): no longer read.
  event.waitUntil(Promise.all([self.clients.claim(), caches.delete('navigations')]));
});

// Pages always come from the network; without it, the offline page. A cached copy of a page would
// name the hashed files of its own release, which the precache drops when a new release arrives, so
// it could open blank.
const navigationRoute = new NavigationRoute(
  new NetworkOnly({
    plugins: [
      {
        handlerDidError: async () => {
          // Precache keys carry ?__WB_REVISION__=…, so caches.match('/offline.html') never finds the page.
          return (await matchPrecache('/offline.html')) || Response.error();
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
// Pages first, before the precache: routes match in the order they are registered, and the precache
// route answers «/» with its own copy of index.html (directoryIndex). That copy is the release the
// browser cached, so the start page stayed old after a release until a lucky reload, while the other
// pages, which only this route serves, were fresh (owner, 2026-10-04: «почему не обновился основной
// экран?»).
registerRoute(navigationRoute);

// Precache static assets injected by Vite: the hashed files, the offline page.
precacheAndRoute(self.__WB_MANIFEST || []);

// Push notifications event listener
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Meldy', body: event.data.text() };
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

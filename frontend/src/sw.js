import { getCacheKeyForURL, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { UPDATE_MESSAGE } from './lib/appUpdate';

// A new release waits: no skipWaiting on install. It takes over when a page of its own release asks
// (SKIP_WAITING) and every other open window agrees, so no page reloads in front of a student
// (lib/appUpdate.ts, components/PWAUpdater.tsx). A first install has no worker to wait for: it
// activates at once, and clients.claim() below takes the page, as before.
//
// The way over from the releases before 2026-10-07 (autoUpdate: their worker skipped waiting on
// install, and their page reloaded itself whenever a new worker activated). A tab still running that
// code meets this worker as a waiting one, and nothing there asks it to take over. The tab keeps its old
// worker, and that worker's precache still holds the tab's files (a waiting worker only adds its own to
// the cache; the old ones go when it activates), so its screens keep opening. A page that tab reloads or
// opens is of the new release: pages come from the network (the page route below), and the new
// release's file names are not in the old precache, so they come from the network too. Such a page asks
// this worker to take over, but the old tab never answers MAY_ACTIVATE, so the worker waits until the
// old tabs are closed or reloaded: the old code's own reload on activation never fires in front of anyone.
const ANSWER_MS = 1500;

function precached(url) {
  try {
    return typeof url === 'string' && Boolean(getCacheKeyForURL(url));
  } catch {
    return false;
  }
}

/** Asks one open window whether this worker may take over now; no answer in time counts as no. */
function askWindow(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), ANSWER_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    try {
      client.postMessage({ type: UPDATE_MESSAGE.mayActivate }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Every window but the asking one is of this release, or could reload unnoticed right now. */
async function othersAgree(asking) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const others = windows.filter((client) => !asking || client.id !== asking.id);
  const answers = await Promise.all(others.map(askWindow));
  return answers.every((answer) => Boolean(answer) && (answer.free === true || precached(answer.url)));
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = event.ports && event.ports[0];
  if (data.type === UPDATE_MESSAGE.precaches) {
    // A page asks whether it is of this release (it came from the network after the release).
    if (reply) reply.postMessage({ precached: precached(data.url) });
  } else if (data.type === UPDATE_MESSAGE.skipWaiting) {
    event.waitUntil(
      othersAgree(event.source).then((agree) => {
        if (reply) reply.postMessage({ activating: agree });
        // The browser still lets the old worker finish the requests it is handling first (a page's
        // last statistics as it reloads, say), and Chrome resolves this only once the worker activates.
        return agree ? self.skipWaiting() : undefined;
      }),
    );
  }
});

self.addEventListener('activate', (event) => {
  // «navigations» held copies of pages from older releases (see the page route below): no longer read.
  event.waitUntil(Promise.all([self.clients.claim(), caches.delete('navigations')]));
});

/**
 * Pages that open without network (spec decision 31): «Сегодня» (/ and /dashboard), «Экзамены» and an exam
 * container with its subject, «занятие» and «Как на экзамене». They draw from the device: the exam's questions and the
 * last overview and plan in IndexedDB, the answer queue in localStorage (lib/containers).
 */
const OFFLINE_APP_PAGES = [/^\/$/, /^\/dashboard\/?$/, /^\/exams\/?$/, /^\/exams\/c\/[^/]+(?:\/.*)?$/];

function opensOffline(url) {
  try {
    const { pathname } = new URL(url);
    return OFFLINE_APP_PAGES.some((page) => page.test(pathname));
  } catch {
    return false;
  }
}

// Pages always come from the network. Without it, the pages above get the app itself — the precached index.html of
// this worker's release, whose hashed files are in the same precache, so it never opens blank — and every other page
// the offline page. A copy of a page cached as it was served would name the hashed files of its own release, which
// the precache drops when a new release arrives, so it could open blank: no page is cached that way.
const navigationRoute = new NavigationRoute(
  new NetworkOnly({
    plugins: [
      {
        handlerDidError: async ({ request }) => {
          // Precache keys carry ?__WB_REVISION__=…, so caches.match('/offline.html') never finds the page.
          if (request && opensOffline(request.url)) {
            const app = await matchPrecache('/index.html');
            if (app) return app;
          }
          return (await matchPrecache('/offline.html')) || Response.error();
        }
      }
    ]
  }),
  {
    denylist: [
      /^\/api/,      // Exclude API requests
      /^\/sb\//,     // The fallback way to Supabase (backend/supabase_proxy.py)
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

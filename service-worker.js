// App-shell cache for offline use, plus a fallback path for showNotification()
// on platforms that require a Service Worker to display notifications.
//
// Bump this version whenever the cached assets change. It's what makes the
// browser recognize this file as different from the one it already has
// installed, which is what triggers install/activate to run again and
// refresh the cache -- without it, an installed app can keep serving old
// content indefinitely even after new code is deployed.
const CACHE_NAME = 'patient-tracker-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/notifications.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: always try to serve the latest deployed version when
// online, and only fall back to the cache (keeping the app usable offline)
// if the network request fails. This also means the cache no longer goes
// stale between deploys even if CACHE_NAME is forgotten -- a successful
// network response always overwrites the cached copy.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./index.html');
    })
  );
});

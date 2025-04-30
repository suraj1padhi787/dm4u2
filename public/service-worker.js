const CACHE_NAME = 'chatapp-v1';
const urlsToCache = [
  '/',
  '/chat',
  '/css/style.css',
  '/socket.io/socket.io.js'
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Fetch
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

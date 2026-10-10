// 離線快取（以 PWA 方式安裝到 iPhone 主畫面時使用）
const CACHE = 'meow-sudoku-v1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'css/style.css', 'js/levels.js', 'js/audio.js', 'js/game.js',
  'fonts/huninn-subset.woff2',
  'img/bg_home.jpg', 'img/bg_game.jpg',
  'img/cat_wave.png', 'img/cat_think.png', 'img/cat_star.png', 'img/cat_sad.png',
  'img/apple-touch-icon.png', 'img/icon-192.png', 'img/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 先拿網路上的最新版本，離線時才用快取
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

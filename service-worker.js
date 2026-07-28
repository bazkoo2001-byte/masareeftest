const CACHE_NAME = 'masareef-v19';
const ASSETS = [
  './index.html',
  './manifest.json',
  './styles.css',
  './app.js',
  './icon-192.png',
  './icon-512.png'
];

// التثبيت — تخزين الملفات الأساسية
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// التفعيل — حذف الكاش القديم
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// الطلبات — الشبكة أولاً للبيانات، الكاش احتياطي
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // لا تتدخل في طلبات Firebase أو الخطوط — دعها تمر مباشرة للشبكة
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('firebase')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // خزّن نسخة من الملفات الناجحة
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

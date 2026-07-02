// v3 — passthrough fetch, no caching (see v2 note below), plus:
//  - notificationclick now actually opens/focuses the app into the reflection
//    screen (previously only postMessage'd already-open tabs, so a click with
//    no window open did nothing).
//  - a real 'push' handler for server-sent web push (see functions/index.js).
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))),
  ]));
});
self.addEventListener('fetch', e => { e.respondWith(fetch(e.request)); });

// server-sent push (FCM / web-push) — arrives even when no tab is open
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || 'Time to reflect';
  const body = data.body || 'Your questions are ready.';
  e.waitUntil(self.registration.showNotification(title, { body, tag: 'reflect' }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = self.registration.scope + '?reflect=1';
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if ('focus' in c) {
        c.postMessage({ type: 'notif-confirmed' });
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(targetUrl); } catch (_) {} }
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

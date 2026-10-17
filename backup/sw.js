// 매칭 알림을 띄우기 위한 서비스 워커. 알림을 누르면 사이트 창으로 돌아간다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(c => new URL(c.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if (client) return client.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});

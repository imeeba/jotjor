/* เก็บไฟล์หน้าเว็บ (ไฟล์ของเว็บนี้เท่านั้น ไม่แตะการเรียก Apps Script) ไว้ในเครื่อง:
 * เปิดจากแคชทันที แล้วโหลดตัวใหม่เบื้องหลัง ถ้า index.html เปลี่ยนจะส่งข้อความให้หน้าเว็บขึ้นปุ่ม "มีเวอร์ชันใหม่" */
var CACHE = 'jotjor-shell';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function notify() {
  self.clients.matchAll().then(function (cs) { cs.forEach(function (c) { c.postMessage('jotjor-updated'); }); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res.ok) {
          var old = hit && hit.headers.get('etag'), now = res.headers.get('etag');
          cache.put(req, res.clone());
          if (req.mode === 'navigate' && old && now && old !== now) notify();
        }
        return res;
      });
      if (hit) { net.catch(function () { /* ออฟไลน์: ใช้ของในแคชต่อ */ }); return hit; }
      return net;
    });
  }));
});

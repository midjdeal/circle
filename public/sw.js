// sw.js — CreatorCircle service worker
//
// This file MUST be served from the domain root (e.g. https://yourapp.com/sw.js),
// not from a /static or /assets subfolder — a service worker can only control
// pages within its own scope, and registering it from a subfolder would limit
// it to that subfolder. In a Vite project, drop this in /public and it will be
// copied to the build output root automatically.
//
// This is what makes push notifications work even when the app/tab is
// closed: the browser keeps this worker alive in the background and wakes
// it up whenever a push arrives, regardless of whether CreatorCircle is open.

const CACHE_NAME = "creatorcircle-v1";

// Minimal app-shell caching so the icon/manifest are available offline-ish.
// This is intentionally light — CreatorCircle is a single-page app, so there's
// no long list of routes to precache.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(["/", "/manifest.json", "/icon-192.png", "/icon-512.png"])
    ).catch(() => {
      // Don't fail install if one of these isn't found yet — these paths
      // are placeholders until the real build output is in place.
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// The actual background push handler. This fires whenever the push service
// (e.g. FCM, or whatever endpoint web-push picked) delivers a message to this
// browser — including while CreatorCircle is fully closed. The payload shape
// here (type/title/body/targetScreen) intentionally mirrors the in-app
// pushNotification(type, title, body, prefKey, targetScreen) helper in the
// main app, so a single payload format works for both foreground toasts and
// background OS notifications.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "CreatorCircle", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "CreatorCircle";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Carries the deep-link target through to notificationclick below.
    data: { targetScreen: data.targetScreen || null, type: data.type || null },
    // Same-tag pushes replace each other in the notification tray instead of
    // stacking — adjust if CreatorCircle should allow multiple simultaneous
    // notifications of the same type.
    tag: data.type || "creatorcircle-notification",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handles the user tapping the OS notification. Focuses an already-open
// CreatorCircle tab if one exists (and tells it which screen to jump to via
// postMessage), otherwise opens a new tab at that screen.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetScreen = event.notification.data && event.notification.data.targetScreen;
  const targetUrl = targetScreen ? `/?screen=${encodeURIComponent(targetScreen)}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.postMessage({ type: "PUSH_NAVIGATE", targetScreen });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

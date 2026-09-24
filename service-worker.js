/**
 * DSPDF — Service Worker
 * ----------------------
 * A deliberately simple cache-first service worker.
 *
 * Strategy:
 *   - Pre-cache the shell (styles, core JS, offline fallback).
 *   - Cache-first for our own static assets.
 *   - Network-first for HTML pages so content stays fresh.
 *   - Never cache CDN resources we don't control (browser cache handles them).
 *
 * We keep it minimal: no dynamic caching of user files (they're in memory,
 * not in URLs), no background sync, no push. Just a modest offline shell.
 *
 * 👉 OWNER: If you later add new top-level pages, add them to PRECACHE_URLS
 *    below to make them work offline.
 */

var CACHE_VERSION = "dspdf-v4";
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./404.html",
  "./css/style.css",
  "./css/tools.css",
  "./css/blog.css",
  "./js/config.js",
  "./js/main.js",
  "./js/tools-engine.js",
  "./images/logo.svg",
  "./images/favicon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // addAll fails if any URL 404s — use individual adds with catch.
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () { /* ignore missing */ });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_VERSION) return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);

  // Don't touch CDN resources — let the browser handle them.
  if (url.origin !== self.location.origin) return;

  // HTML pages: network-first, fall back to cache, fall back to 404.
  var accept = req.headers.get("accept") || "";
  if (accept.indexOf("text/html") !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match("./404.html") || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // Everything else (CSS, JS, SVG, JSON): cache-first.
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (!res || res.status !== 200 || res.type === "opaque") return res;
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match("./404.html");
      });
    })
  );
});
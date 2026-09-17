/**
 * DSPDF — Shared UI (navigation, theme, toasts, small helpers).
 * Loaded on every page. Keep it small and dependency-free.
 */
(function () {
  "use strict";

  var CFG = window.DSPDF_CONFIG;
  var log = window.dspdfLog || function () {};

  /* ---------- Theme (dark default, light toggle, remembers choice) ---------- */
  var THEME_KEY = "dspdf_theme";

  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function storeTheme(v) {
    try { localStorage.setItem(THEME_KEY, v); } catch (e) {}
  }
  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    var btns = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-label",
        theme === "light" ? "Switch to dark mode" : "Switch to light mode");
      btns[i].textContent = theme === "light" ? "🌙" : "☀️";
    }
  }
  function initTheme() {
    var stored = getStoredTheme();
    if (!stored) {
      var prefersLight = window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches;
      stored = prefersLight ? "light" : "dark";
    }
    applyTheme(stored);
  }
  window.dspdfToggleTheme = function () {
    var current = document.documentElement.getAttribute("data-theme") === "light"
      ? "light" : "dark";
    var next = current === "light" ? "dark" : "light";
    storeTheme(next);
    applyTheme(next);
  };

  /* ---------- Mobile nav toggle ---------- */
  function initNav() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var menu = document.querySelector("[data-nav-menu]");
    if (!toggle || !menu) return;
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    // Close when a link is clicked (mobile)
    menu.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------- Footer year ---------- */
  function initYear() {
    var els = document.querySelectorAll("[data-year]");
    var y = CFG ? CFG.buildYear : new Date().getFullYear();
    for (var i = 0; i < els.length; i++) els[i].textContent = y;
  }

  /* ---------- Toast ---------- */
  var toastHost = null;
  function ensureToastHost() {
    if (toastHost) return toastHost;
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
    return toastHost;
  }
  /**
   * window.dspdfToast("Message", "success" | "error" | "info", ms)
   */
  window.dspdfToast = function (msg, kind, ms) {
    var host = ensureToastHost();
    var el = document.createElement("div");
    el.className = "toast toast--" + (kind || "info");
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.textContent = msg;
    host.appendChild(el);
    var t = setTimeout(function () {
      el.classList.add("toast--out");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    }, ms || 3800);
    el.addEventListener("click", function () {
      clearTimeout(t);
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  };

  /* ---------- FAQ accordion (simple, accessible) ---------- */
  function initFaq() {
    var items = document.querySelectorAll(".faq-accordion details");
    // Native <details> handles open/close — nothing to do.
    // Hook left for future enhancements.
    return items.length;
  }

  /* ---------- SPA-like smooth scroll for hash links ---------- */
  function initHashScroll() {
    if (!location.hash) return;
    var target = document.querySelector(location.hash);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- Inject basePath into links marked data-path ---------- */
  // For build-time simplicity we mostly write correct relative URLs,
  // but this helper allows pages to request absolute site paths when needed.
  function initPathRewrites() {
    if (!CFG) return;
    var els = document.querySelectorAll("[data-path]");
    for (var i = 0; i < els.length; i++) {
      var p = els[i].getAttribute("data-path");
      var full = CFG.url(p);
      if (els[i].tagName === "A") els[i].setAttribute("href", full);
      else if (els[i].tagName === "IMG") els[i].setAttribute("src", full);
    }
  }

  /* ---------- Register service worker (Batch 7 will ship it) ---------- */
  function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // Only attempt on http(s), not file://
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    var swUrl = (CFG ? CFG.url("service-worker.js") : "/service-worker.js");
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(swUrl).catch(function (err) {
        log("SW registration failed", err && err.message);
      });
    });
  }

  /* ---------- Boot ---------- */
  function boot() {
    initTheme();
    initNav();
    initYear();
    initFaq();
    initPathRewrites();
    initHashScroll();
    initServiceWorker();
    log("main.js ready on", location.pathname);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Expose theme helpers for header button
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-theme-toggle]");
    if (t) { e.preventDefault(); window.dspdfToggleTheme(); }
  });
})();
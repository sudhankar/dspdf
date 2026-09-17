/**
 * DSPDF — Shared Tools Engine
 * -------------------------------------------------
 * Handles: file input, drag-drop, size formatting, progress UI,
 * download (via FileSaver), memory cleanup, error display.
 * Every tool page loads this BEFORE its own tool script.
 */
(function () {
  "use strict";

  var CFG = window.DSPDF_CONFIG || {};
  var log = window.dspdfLog || function () {};

  /* ---------- File size formatting ---------- */
  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  /* ---------- Human error messages ---------- */
  function humanError(err, fallback) {
    if (!err) return fallback || "Something went wrong.";
    var m = String(err.message || err);
    if (/password|encrypt/i.test(m)) return "This PDF is password-protected. Unlock it first, then try again.";
    if (/invalid|corrupt|not a pdf/i.test(m)) return "That file doesn't look like a valid PDF. Try another file.";
    if (/memory|allocation/i.test(m)) return "Your device ran out of memory for this file. Try a smaller file or a device with more RAM.";
    return fallback || m;
  }

  /* ---------- Download a Blob ---------- */
  function downloadBlob(blob, filename) {
    if (window.saveAs) {
      window.saveAs(blob, filename);
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser a moment before revoking.
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- Progress bar controller ---------- */
  function ProgressUI(el) {
    this.el = el;
    this.bar = el ? el.querySelector(".progress__bar") : null;
    this.label = el ? el.querySelector("[data-progress-label]") : null;
  }
  ProgressUI.prototype.show = function () {
    if (this.el) this.el.hidden = false;
  };
  ProgressUI.prototype.hide = function () {
    if (this.el) this.el.hidden = true;
  };
  ProgressUI.prototype.set = function (pct, label) {
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    if (this.bar) {
      this.bar.style.width = p + "%";
      this.bar.classList.remove("is-success", "is-error");
      if (p === 100) this.bar.classList.add("is-success");
    }
    if (this.label && label != null) this.label.textContent = label;
    if (this.el) this.el.setAttribute("aria-valuenow", String(p));
  };
  ProgressUI.prototype.error = function (label) {
    if (this.bar) {
      this.bar.classList.remove("is-success");
      this.bar.classList.add("is-error");
    }
    if (this.label && label) this.label.textContent = label;
  };

  /* ---------- Upload zone controller ----------
   * Usage:
   *   const uz = DSPDF.uploadZone("#zone", {
   *     accept: ".pdf,application/pdf",
   *     multiple: true,
   *     onFiles: files => { ... }
   *   });
   */
  function UploadZone(selector, opts) {
    opts = opts || {};
    var root = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!root) throw new Error("UploadZone: root not found: " + selector);
    this.root = root;
    this.input = root.querySelector("input[type=file]");
    this.accept = opts.accept || "*";
    this.multiple = !!opts.multiple;
    this.onFiles = opts.onFiles || function () {};

    var self = this;
    if (this.input) {
      this.input.setAttribute("accept", this.accept);
      if (this.multiple) this.input.setAttribute("multiple", "");
      else this.input.removeAttribute("multiple");
      this.input.addEventListener("change", function (e) {
        self._handle(Array.prototype.slice.call(e.target.files || []));
        // Reset so re-selecting the same file fires change again
        e.target.value = "";
      });
    }

    // Click anywhere in zone (except buttons/links) opens the picker
    root.addEventListener("click", function (e) {
      if (e.target.closest("a, button")) return;
      if (self.input) self.input.click();
    });
    root.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (self.input) self.input.click();
      }
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      root.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        root.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      root.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        root.classList.remove("is-dragover");
      });
    });
    root.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      self._handle(Array.prototype.slice.call(dt.files || []));
    });
  }
  UploadZone.prototype._handle = function (files) {
    if (!files.length) return;
    if (!this.multiple && files.length > 1) files = [files[0]];
    this.onFiles(files);
  };

  /* ---------- Read a File as ArrayBuffer (Promise) ---------- */
  function fileToArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error("Could not read file.")); };
      r.readAsArrayBuffer(file);
    });
  }
  function fileToDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error("Could not read file.")); };
      r.readAsDataURL(file);
    });
  }

  /* ---------- Show/hide helpers ---------- */
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  /* ---------- Alert helper ---------- */
  function showError(target, message) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) { if (window.dspdfToast) window.dspdfToast(message, "error"); return; }
    el.className = "alert alert-error";
    el.textContent = "⚠ " + message;
    el.hidden = false;
  }
  function showInfo(target, message) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    el.className = "alert alert-info";
    el.textContent = message;
    el.hidden = false;
  }
  function clearAlert(target) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (el) { el.hidden = true; el.textContent = ""; }
  }

  /* ---------- Sortable list (simple drag reorder) ----------
   * Attaches HTML5 draggable reordering to <li data-id> elements.
   * onReorder(orderedIdsArray) called after every drop.
   */
  function makeSortable(listEl, onReorder) {
    if (!listEl) return;
    var dragEl = null;
    listEl.querySelectorAll("[draggable=true]").forEach(function (li) {
      li.addEventListener("dragstart", function () {
        dragEl = li;
        li.style.opacity = "0.4";
      });
      li.addEventListener("dragend", function () {
        li.style.opacity = "";
        dragEl = null;
        if (onReorder) onReorder(getIds(listEl));
      });
    });
    listEl.addEventListener("dragover", function (e) {
      e.preventDefault();
      var after = getDragAfterElement(listEl, e.clientY);
      if (!dragEl) return;
      if (after == null) listEl.appendChild(dragEl);
      else listEl.insertBefore(dragEl, after);
    });
    function getIds(el) {
      return Array.prototype.slice.call(el.querySelectorAll("[data-id]"))
        .map(function (n) { return n.getAttribute("data-id"); });
    }
    function getDragAfterElement(container, y) {
      var els = Array.prototype.slice.call(
        container.querySelectorAll("[draggable=true]:not([style*='opacity: 0.4'])")
      );
      return els.reduce(function (closest, child) {
        var box = child.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
  }

  /* ---------- Public API ---------- */
  window.DSPDF = window.DSPDF || {};
  Object.assign(window.DSPDF, {
    formatBytes: formatBytes,
    humanError: humanError,
    downloadBlob: downloadBlob,
    ProgressUI: ProgressUI,
    UploadZone: UploadZone,
    fileToArrayBuffer: fileToArrayBuffer,
    fileToDataURL: fileToDataURL,
    show: show,
    hide: hide,
    showError: showError,
    showInfo: showInfo,
    clearAlert: clearAlert,
    makeSortable: makeSortable
  });

  log("tools-engine.js loaded");
})();
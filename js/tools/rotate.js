/**
 * Rotate PDF — page thumbnails via pdf.js, rotation via pdf-lib worker.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = {
    file: null,
    buffer: null,
    pdfDoc: null,        // pdf.js document
    pageCount: 0,
    selected: {},        // { pageIndex: true }
    pendingRotations: {} // { pageIndex: delta } accumulated per session
  };
  var worker = null;
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Failed to load " + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("../pdf-worker.js", document.currentScript.src));
    return worker;
  }
  function runWorker(op, payload, transfer) {
    return new Promise(function (resolve, reject) {
      var w = ensureWorker();
      var id = "w" + Math.random().toString(36).slice(2);
      function handler(e) {
        if (e.data.id !== id) return;
        w.removeEventListener("message", handler);
        if (e.data.ok) resolve(e.data.result);
        else reject(new Error(e.data.error));
      }
      w.addEventListener("message", handler);
      w.postMessage({ id: id, op: op, payload: payload }, transfer || []);
    });
  }

  async function loadPdf(file) {
    D.clearAlert("rotate-alert");
    var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) { D.showError("rotate-alert", "Please choose a PDF file."); return; }

    el("rotate-toolbar").hidden = true;
    D.showInfo("rotate-alert", "Loading PDF…");

    try {
      await loadScript(PDFJS_URL);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

      var buf = await D.fileToArrayBuffer(file);
      state.buffer = buf.slice(0); // keep pristine copy
      state.file = file;
      state.selected = {};
      state.pendingRotations = {};

      var loadingTask = window.pdfjsLib.getDocument({ data: buf });
      state.pdfDoc = await loadingTask.promise;
      state.pageCount = state.pdfDoc.numPages;

      await renderThumbs();
      el("rotate-toolbar").hidden = false;
      D.clearAlert("rotate-alert");
    } catch (err) {
      log("loadPdf failed", err);
      D.showError("rotate-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function renderThumbs() {
    var grid = el("rotate-grid");
    grid.innerHTML = "";
    for (var i = 1; i <= state.pageCount; i++) {
      var wrapper = document.createElement("div");
      wrapper.className = "thumb";
      wrapper.setAttribute("role", "button");
      wrapper.setAttribute("tabindex", "0");
      wrapper.setAttribute("aria-label", "Page " + i);
      wrapper.setAttribute("data-page", String(i - 1));
      wrapper.innerHTML =
        '<div class="skeleton" style="width:100%;height:100%;position:absolute;inset:0;"></div>' +
        '<span class="thumb__label">' + i + '</span>';
      grid.appendChild(wrapper);
    }

    // Render sequentially to avoid memory spikes
    for (var p = 1; p <= state.pageCount; p++) {
      try {
        var page = await state.pdfDoc.getPage(p);
        var vp = page.getViewport({ scale: 0.4 });
        var canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        var wrap = grid.querySelector('[data-page="' + (p - 1) + '"]');
        if (wrap) {
          var sk = wrap.querySelector(".skeleton");
          if (sk) sk.remove();
          wrap.insertBefore(canvas, wrap.firstChild);
        }
      } catch (err) {
        log("thumb render error page " + p, err);
      }
    }
  }

  function toggleSelect(idx) {
    if (state.selected[idx]) delete state.selected[idx];
    else state.selected[idx] = true;
    var node = el("rotate-grid").querySelector('[data-page="' + idx + '"]');
    if (node) node.classList.toggle("is-selected", !!state.selected[idx]);
  }

  function applyRotation(delta, scope) {
    var indices = Object.keys(state.selected).map(Number);
    var targets;
    if (scope === "all" || indices.length === 0) {
      targets = [];
      for (var i = 0; i < state.pageCount; i++) targets.push(i);
    } else {
      targets = indices;
    }
    targets.forEach(function (idx) {
      state.pendingRotations[idx] = ((state.pendingRotations[idx] || 0) + delta) % 360;
    });
    // Visual hint: apply CSS transform to thumbnails
    targets.forEach(function (idx) {
      var node = el("rotate-grid").querySelector('[data-page="' + idx + '"]');
      if (!node) return;
      var deg = (state.pendingRotations[idx] || 0);
      node.style.setProperty("--rot", deg + "deg");
      var c = node.querySelector("canvas");
      if (c) c.style.transform = "rotate(" + deg + "deg)";
    });
  }

  async function save() {
    if (!state.buffer) return;
    var pending = state.pendingRotations;
    if (Object.keys(pending).length === 0) {
      D.showInfo("rotate-alert", "No rotations chosen yet. Click a thumbnail then use a rotate button.");
      return;
    }
    progressUI.show();
    progressUI.set(15, "Preparing rotation…");
    try {
      var rotations = {};
      Object.keys(pending).forEach(function (k) {
        var v = ((pending[k] % 360) + 360) % 360;
        if (v === 0) return;
        rotations[k] = v;
      });
      progressUI.set(40, "Rotating in worker…");
      var result = await runWorker("rotate", { buffer: state.buffer.slice(0), rotations: rotations }, []);
      progressUI.set(90, "Preparing download…");
      var blob = new Blob([result.bytes], { type: "application/pdf" });
      var name = "dspdf-rotated-" + (state.file.name || "document.pdf");
      D.downloadBlob(blob, name);
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved " + name, "success");
    } catch (err) {
      progressUI.error("Rotation failed.");
      D.showError("rotate-alert", D.humanError(err, "Could not rotate this PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("rotate-progress"));

    new D.UploadZone("#uz-rotate", {
      accept: "application/pdf,.pdf",
      multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });

    el("rotate-grid").addEventListener("click", function (e) {
      var t = e.target.closest("[data-page]");
      if (!t) return;
      toggleSelect(Number(t.getAttribute("data-page")));
    });
    el("rotate-grid").addEventListener("keydown", function (e) {
      var t = e.target.closest("[data-page]");
      if (!t) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSelect(Number(t.getAttribute("data-page")));
      }
    });

    document.querySelectorAll("[data-rot]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyRotation(Number(btn.getAttribute("data-rot")), "selected");
      });
    });
    el("rotate-select-all").addEventListener("click", function () {
      for (var i = 0; i < state.pageCount; i++) state.selected[i] = true;
      el("rotate-grid").querySelectorAll("[data-page]").forEach(function (n) { n.classList.add("is-selected"); });
    });
    el("rotate-clear-sel").addEventListener("click", function () {
      state.selected = {};
      el("rotate-grid").querySelectorAll("[data-page]").forEach(function (n) { n.classList.remove("is-selected"); });
    });
    el("rotate-save").addEventListener("click", save);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
/**
 * Extract Pages — thumbnail selector + worker extraction.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, buffer: null, pdfDoc: null, pageCount: 0, selected: {} };
  var worker = null;
  var progressUI = null;

  function el(id) { return document.getElementById(id); }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error("load fail " + src)); };
      document.head.appendChild(s);
    });
  }
  function ensureWorker() {
    if (!worker) worker = D.createPdfWorker();
    return worker;
  }


  async function loadPdf(file) {
    if (progressUI) progressUI.reset();
    D.clearAlert("extract-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("extract-alert", "Please choose a PDF."); return;
    }
    el("extract-toolbar").hidden = true;
    D.showInfo("extract-alert", "Loading…");
    try {
      await loadScript(PDFJS_URL);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var buf = await D.fileToArrayBuffer(file);
      state.file = file;
      state.buffer = buf.slice(0);
      state.selected = {};
      var task = window.pdfjsLib.getDocument({ data: buf });
      state.pdfDoc = await task.promise;
      state.pageCount = state.pdfDoc.numPages;
      await renderThumbs();
      updateCount();
      el("extract-toolbar").hidden = false;
      D.clearAlert("extract-alert");
    } catch (err) {
      log(err);
      D.showError("extract-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function renderThumbs() {
    var grid = el("extract-grid");
    grid.innerHTML = "";
    for (var i = 1; i <= state.pageCount; i++) {
      var wrap = document.createElement("div");
      wrap.className = "thumb";
      wrap.setAttribute("role", "button");
      wrap.setAttribute("tabindex", "0");
      wrap.setAttribute("aria-label", "Page " + i);
      wrap.setAttribute("data-page", String(i - 1));
      wrap.innerHTML = '<div class="skeleton" style="width:100%;height:100%;position:absolute;inset:0;"></div><span class="thumb__label">' + i + '</span>';
      grid.appendChild(wrap);
    }
    for (var p = 1; p <= state.pageCount; p++) {
      try {
        var page = await state.pdfDoc.getPage(p);
        var vp = page.getViewport({ scale: 0.70 });
        var canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        var w = grid.querySelector('[data-page="' + (p - 1) + '"]');
        if (w) {
          var sk = w.querySelector(".skeleton"); if (sk) sk.remove();
          w.insertBefore(canvas, w.firstChild);
        }
      } catch (err) { log("thumb", p, err); }
    }
  }

  function toggle(idx) {
    if (state.selected[idx]) delete state.selected[idx];
    else state.selected[idx] = true;
    var node = el("extract-grid").querySelector('[data-page="' + idx + '"]');
    if (node) node.classList.toggle("is-selected", !!state.selected[idx]);
    updateCount();
  }
  function updateCount() {
    var n = Object.keys(state.selected).length;
    el("extract-count").textContent = n + " of " + state.pageCount + " pages selected";
  }

  async function apply() {
    var keep = Object.keys(state.selected).map(Number);
    if (!keep.length) { D.showError("extract-alert", "Select at least one page."); return; }
    progressUI.show();
    progressUI.set(30, "Extracting…");
    try {
      var result = await D.runPdfOperation("extractPages", { buffer: state.buffer.slice(0), keepIndices: keep });
      progressUI.set(90, "Preparing download…");
      var blob = new Blob([result.bytes], { type: "application/pdf" });
      var name = "dspdf-extracted-" + (state.file.name || "document.pdf");
      D.downloadBlob(blob, name);
      progressUI.set(100, "Done — " + result.pageCount + " page(s) extracted.");
      if (window.dspdfToast) window.dspdfToast("Saved " + name, "success");
    } catch (err) {
      progressUI.error("Extraction failed.");
      D.showError("extract-alert", D.humanError(err, "Could not extract these pages."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("extract-progress"));
    new D.UploadZone("#uz-extract", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("extract-grid").addEventListener("click", function (e) {
      var t = e.target.closest("[data-page]"); if (!t) return;
      toggle(Number(t.getAttribute("data-page")));
    });
    el("extract-grid").addEventListener("keydown", function (e) {
      var t = e.target.closest("[data-page]"); if (!t) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(Number(t.getAttribute("data-page"))); }
    });
    el("extract-clear").addEventListener("click", function () {
      state.selected = {};
      el("extract-grid").querySelectorAll("[data-page]").forEach(function (n) { n.classList.remove("is-selected"); });
      updateCount();
    });
    el("extract-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
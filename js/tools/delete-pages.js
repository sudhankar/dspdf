/**
 * Delete Pages — thumbnail selector + worker removal.
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
    D.clearAlert("delete-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("delete-alert", "Please choose a PDF.");
      return;
    }
    el("delete-toolbar").hidden = true;
    D.showInfo("delete-alert", "Loading…");
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
      el("delete-toolbar").hidden = false;
      D.clearAlert("delete-alert");
    } catch (err) {
      log(err);
      D.showError("delete-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function renderThumbs() {
    var grid = el("delete-grid");
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
    var node = el("delete-grid").querySelector('[data-page="' + idx + '"]');
    if (node) node.classList.toggle("is-selected", !!state.selected[idx]);
    updateCount();
  }
  function updateCount() {
    var n = Object.keys(state.selected).length;
    el("delete-count").textContent = n + " of " + state.pageCount + " pages selected";
  }

  async function apply() {
    var toDelete = Object.keys(state.selected).map(Number);
    if (!toDelete.length) { D.showError("delete-alert", "Select at least one page first."); return; }
    if (toDelete.length >= state.pageCount) { D.showError("delete-alert", "You can't delete every page — at least one must remain."); return; }

    progressUI.show();
    progressUI.set(30, "Deleting pages…");
    try {
      var result = await D.runPdfOperation("deletePages", { buffer: state.buffer.slice(0), deleteIndices: toDelete });
      progressUI.set(90, "Preparing download…");
      var blob = new Blob([result.bytes], { type: "application/pdf" });
      var name = "dspdf-" + (state.file.name || "document.pdf");
      D.downloadBlob(blob, name);
      progressUI.set(100, "Done — " + result.pageCount + " page(s) in new PDF.");
      if (window.dspdfToast) window.dspdfToast("Saved " + name, "success");
    } catch (err) {
      progressUI.error("Failed.");
      D.showError("delete-alert", D.humanError(err, "Could not delete these pages."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("delete-progress"));
    new D.UploadZone("#uz-delete", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("delete-grid").addEventListener("click", function (e) {
      var t = e.target.closest("[data-page]"); if (!t) return;
      toggle(Number(t.getAttribute("data-page")));
    });
    el("delete-grid").addEventListener("keydown", function (e) {
      var t = e.target.closest("[data-page]"); if (!t) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(Number(t.getAttribute("data-page"))); }
    });
    el("delete-clear").addEventListener("click", function () {
      state.selected = {};
      el("delete-grid").querySelectorAll("[data-page]").forEach(function (n) { n.classList.remove("is-selected"); });
      updateCount();
    });
    el("delete-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
/**
 * PDF → JPG — render pages via pdf.js, package as ZIP.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, pdfDoc: null, pageCount: 0 };
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

  async function loadPdf(file) {
    D.clearAlert("p2j-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("p2j-alert", "Please choose a PDF."); return;
    }
    el("p2j-toolbar").hidden = true;
    D.showInfo("p2j-alert", "Loading…");
    try {
      await loadScript(PDFJS_URL);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var buf = await D.fileToArrayBuffer(file);
      state.file = file;
      var task = window.pdfjsLib.getDocument({ data: buf });
      state.pdfDoc = await task.promise;
      state.pageCount = state.pdfDoc.numPages;
      el("p2j-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("p2j-toolbar").hidden = false;
      D.clearAlert("p2j-alert");
    } catch (err) {
      log(err);
      D.showError("p2j-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  function renderPageToJpegBlob(pageNum, dpi, quality) {
    return state.pdfDoc.getPage(pageNum).then(function (page) {
      // PDF unit is 1/72 inch; scale = dpi/72
      var scale = dpi / 72;
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (b) {
            if (!b) reject(new Error("toBlob failed"));
            else resolve(b);
          }, "image/jpeg", quality / 100);
        });
      });
    });
  }

  async function convert() {
    if (!state.pdfDoc) return;
    var dpi = parseInt(el("p2j-dpi").value, 10);
    var quality = parseInt(el("p2j-quality").value, 10);
    progressUI.show();
    progressUI.set(2, "Starting…");

    try {
      if (!window.JSZip) throw new Error("JSZip is still loading. Please try again.");
      var zip = new window.JSZip();
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");

      for (var p = 1; p <= state.pageCount; p++) {
        var blob = await renderPageToJpegBlob(p, dpi, quality);
        var pad = String(p).padStart(String(state.pageCount).length, "0");
        zip.file(base + "-page-" + pad + ".jpg", blob);
        progressUI.set(2 + (p / state.pageCount) * 85, "Rendered page " + p + " / " + state.pageCount);
      }

      var zipBlob = await zip.generateAsync({ type: "blob" }, function (meta) {
        progressUI.set(87 + meta.percent * 0.12, "Packaging ZIP… " + Math.round(meta.percent) + "%");
      });
      D.downloadBlob(zipBlob, base + "-jpg.zip");
      progressUI.set(100, "Done — " + state.pageCount + " JPG(s) in ZIP.");
      if (window.dspdfToast) window.dspdfToast("Saved ZIP with " + state.pageCount + " image(s)", "success");
    } catch (err) {
      log(err);
      progressUI.error("Conversion failed.");
      D.showError("p2j-alert", D.humanError(err, "Could not convert this PDF. Try a lower DPI."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("p2j-progress"));
    new D.UploadZone("#uz-p2j", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("p2j-quality").addEventListener("input", function () {
      el("p2j-quality-val").textContent = el("p2j-quality").value + "%";
    });
    el("p2j-apply").addEventListener("click", convert);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
/**
 * Crop PDF — apply equal-side crop across all pages.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, bytes: null, pdfDoc: null, pageCount: 0 };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  async function loadPdf(file) {
    D.clearAlert("crop-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("crop-alert", "Please choose a PDF."); return;
    }
    el("crop-toolbar").hidden = true;
    D.showInfo("crop-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = state.pdfDoc.numPages;
      el("crop-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("crop-toolbar").hidden = false;
      D.clearAlert("crop-alert");
      await renderPreview();
    } catch (err) {
      log(err); D.showError("crop-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function renderPreview() {
    try {
      var page = await state.pdfDoc.getPage(1);
      var vp = page.getViewport({ scale: 0.9 });
      var canvas = el("crop-preview");
      canvas.width = vp.width; canvas.height = vp.height;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      // Overlay crop guidelines
      var t = parseInt(el("crop-top").value, 10) || 0;
      var b = parseInt(el("crop-bottom").value, 10) || 0;
      var l = parseInt(el("crop-left").value, 10) || 0;
      var r = parseInt(el("crop-right").value, 10) || 0;
      var s = vp.scale;
      ctx.strokeStyle = "rgba(37, 99, 235, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(l * s, t * s, canvas.width - (l + r) * s, canvas.height - (t + b) * s);
      ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
      // Shade cropped regions
      ctx.fillRect(0, 0, canvas.width, t * s);
      ctx.fillRect(0, canvas.height - b * s, canvas.width, b * s);
      ctx.fillRect(0, 0, l * s, canvas.height);
      ctx.fillRect(canvas.width - r * s, 0, r * s, canvas.height);
    } catch (err) { log("preview", err); }
  }

  async function apply() {
    if (!state.bytes) return;
    var t = Math.max(0, parseInt(el("crop-top").value, 10) || 0);
    var b = Math.max(0, parseInt(el("crop-bottom").value, 10) || 0);
    var l = Math.max(0, parseInt(el("crop-left").value, 10) || 0);
    var r = Math.max(0, parseInt(el("crop-right").value, 10) || 0);
    if (t + b + l + r === 0) { D.showError("crop-alert", "Enter crop amounts for at least one side."); return; }

    progressUI.show();
    progressUI.set(20, "Applying crop…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      var pages = doc.getPages();
      pages.forEach(function (page) {
        var size = page.getSize();
        var newW = size.width - l - r;
        var newH = size.height - t - b;
        if (newW <= 10 || newH <= 10) return;
        page.setCropBox(l, b, newW, newH);
      });
      progressUI.set(80, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-cropped.pdf");
      progressUI.set(100, "Cropped PDF saved.");
      if (window.dspdfToast) window.dspdfToast("Saved cropped PDF.", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("crop-alert", D.humanError(err, "Could not crop this PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("crop-progress"));
    new D.UploadZone("#uz-crop", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    ["crop-top", "crop-bottom", "crop-left", "crop-right"].forEach(function (id) {
      el(id).addEventListener("input", function () {
        clearTimeout(id._t);
        id._t = setTimeout(renderPreview, 180);
      });
    });
    el("crop-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
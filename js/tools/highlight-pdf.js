/**
 * Highlight PDF — page-1 rectangles with color and opacity.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, bytes: null, pdfDoc: null, highlights: [], color: "#FDE047", opacity: 0.45 };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  function hexToRgb01(hex) {
    hex = (hex || "#000000").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(hex, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  async function loadPdf(file) {
    D.clearAlert("hl-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("hl-alert", "Please choose a PDF."); return;
    }
    el("hl-toolbar").hidden = true;
    D.showInfo("hl-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file;
      state.bytes = bytes;
      state.highlights = [];
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      el("hl-info").textContent = file.name + " — " + state.pdfDoc.numPages + " page(s)";
      el("hl-toolbar").hidden = false;
      el("hl-stage").hidden = false;
      await renderCanvas();
      D.clearAlert("hl-alert");
      updateCount();
    } catch (err) {
      log(err); D.showError("hl-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  var currentScale = 1;
  async function renderCanvas() {
    var page = await state.pdfDoc.getPage(1);
    var vp = page.getViewport({ scale: 1.8 });
    currentScale = vp.scale;
    var canvas = el("hl-canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    drawHighlights(ctx, canvas);
  }

  function drawHighlights(ctx, canvas) {
    ctx.save();
    state.highlights.forEach(function (h) {
      ctx.globalAlpha = h.opacity;
      ctx.fillStyle = h.color;
      ctx.fillRect(h.x * canvas.width, h.y * canvas.height, h.w * canvas.width, h.h * canvas.height);
    });
    ctx.restore();
  }

  function setupDrawing() {
    var canvas = el("hl-canvas");
    var drawing = false, start = null;

    canvas.addEventListener("pointerdown", function (e) {
      var rect = canvas.getBoundingClientRect();
      drawing = true;
      start = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });

    canvas.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var rect = canvas.getBoundingClientRect();
      var cur = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height
      };
      // redraw
      var ctx = canvas.getContext("2d");
      renderCanvas().then(function () {
        var ctx2 = canvas.getContext("2d");
        ctx2.save();
        ctx2.globalAlpha = state.opacity;
        ctx2.fillStyle = state.color;
        var x = Math.min(start.x, cur.x) * canvas.width;
        var y = Math.min(start.y, cur.y) * canvas.height;
        var w = Math.abs(cur.x - start.x) * canvas.width;
        var h = Math.abs(cur.y - start.y) * canvas.height;
        ctx2.fillRect(x, y, w, h);
        ctx2.restore();
      });
    });

    canvas.addEventListener("pointerup", function (e) {
      if (!drawing) return;
      drawing = false;
      var rect = canvas.getBoundingClientRect();
      var cur = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height
      };
      var x = Math.min(start.x, cur.x);
      var y = Math.min(start.y, cur.y);
      var w = Math.abs(cur.x - start.x);
      var h = Math.abs(cur.y - start.y);
      if (w < 0.005 || h < 0.005) return;
      state.highlights.push({
        x: x, y: y, w: w, h: h,
        color: state.color, opacity: state.opacity
      });
      renderCanvas();
      updateCount();
      el("hl-save").disabled = state.highlights.length === 0;
    });
  }

  function updateCount() {
    el("hl-count").textContent = state.highlights.length + " highlight" + (state.highlights.length === 1 ? "" : "s");
  }

  async function save() {
    if (!state.bytes || !state.highlights.length) return;
    progressUI.show();
    progressUI.set(20, "Applying highlights…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      var pages = doc.getPages();
      var page = pages[0];
      var size = page.getSize();
      state.highlights.forEach(function (h) {
        var c = hexToRgb01(h.color);
        page.drawRectangle({
          x: h.x * size.width,
          y: size.height - (h.y + h.h) * size.height,
          width: h.w * size.width,
          height: h.h * size.height,
          color: PDFLib.rgb(c.r, c.g, c.b),
          opacity: h.opacity
        });
      });
      progressUI.set(85, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-highlighted.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved highlighted PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("hl-alert", D.humanError(err, "Could not save."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("hl-progress"));
    new D.UploadZone("#uz-hl", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    document.querySelectorAll("[data-hl-color]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.color = b.dataset.hlColor;
        el("hl-color-custom").value = state.color;
      });
    });
    el("hl-color-custom").addEventListener("input", function () {
      state.color = this.value;
    });
    el("hl-opacity").addEventListener("input", function () {
      el("hl-opacity-val").textContent = this.value + "%";
      state.opacity = parseInt(this.value, 10) / 100;
    });
    el("hl-undo").addEventListener("click", function () {
      state.highlights.pop();
      renderCanvas();
      updateCount();
      el("hl-save").disabled = state.highlights.length === 0;
    });
    el("hl-clear").addEventListener("click", function () {
      state.highlights = [];
      renderCanvas();
      updateCount();
      el("hl-save").disabled = true;
    });
    el("hl-save").addEventListener("click", save);
    setupDrawing();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
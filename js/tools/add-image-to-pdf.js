/**
 * Add Image to PDF — fixed-position image insert.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, bytes: null, pdfDoc: null, pageCount: 0, imageDataUrl: null, imageAspect: 1 };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  function parseRange(str, max) {
    if (!str) return [];
    var out = [];
    str.split(",").forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var m = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = Math.max(1, parseInt(m[1], 10));
        var b = Math.min(max, parseInt(m[2], 10));
        for (var i = a; i <= b; i++) out.push(i - 1);
      } else {
        var s = parseInt(chunk, 10);
        if (s >= 1 && s <= max) out.push(s - 1);
      }
    });
    return out;
  }

  function pagesToApply() {
    var mode = el("img-pages").value;
    if (mode === "all") { var a = []; for (var i = 0; i < state.pageCount; i++) a.push(i); return a; }
    if (mode === "first") return [0];
    if (mode === "last") return [state.pageCount - 1];
    return parseRange(el("img-range").value, state.pageCount);
  }

  async function loadPdf(file) {
    D.clearAlert("img-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("img-alert", "Please choose a PDF."); return;
    }
    el("img-toolbar").hidden = true;
    D.showInfo("img-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file;
      state.bytes = bytes;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = state.pdfDoc.numPages;
      el("img-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("img-toolbar").hidden = false;
      D.clearAlert("img-alert");
    } catch (err) {
      log(err); D.showError("img-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function handleImage(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      D.showError("img-alert", "Please choose a PNG, JPG, or WebP image."); return;
    }
    var dataUrl = await D.fileToDataURL(file);
    if (file.type === "image/webp") dataUrl = await reEncodeToPng(dataUrl);
    var img = await loadImage(dataUrl);
    state.imageDataUrl = dataUrl;
    state.imageAspect = img.naturalWidth / img.naturalHeight;
    el("img-thumb-img").src = dataUrl;
    el("img-preview-thumb").hidden = false;
    el("img-apply").disabled = false;
    D.clearAlert("img-alert");
  }

  function reEncodeToPng(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c.toDataURL("image/png"));
      };
      img.src = dataUrl;
    });
  }
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = rej;
      i.src = src;
    });
  }

  function dataUrlToBytes(dataUrl) {
    var b64 = dataUrl.split(",")[1];
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function computePosition(pos, pageW, pageH, margin, imgW, imgH) {
    var x, y;
    switch (pos) {
      case "tl": x = margin; y = pageH - margin - imgH; break;
      case "tc": x = (pageW - imgW) / 2; y = pageH - margin - imgH; break;
      case "tr": x = pageW - margin - imgW; y = pageH - margin - imgH; break;
      case "ml": x = margin; y = (pageH - imgH) / 2; break;
      case "mc": x = (pageW - imgW) / 2; y = (pageH - imgH) / 2; break;
      case "mr": x = pageW - margin - imgW; y = (pageH - imgH) / 2; break;
      case "bl": x = margin; y = margin; break;
      case "bc": x = (pageW - imgW) / 2; y = margin; break;
      case "br": x = pageW - margin - imgW; y = margin; break;
      default: x = margin; y = margin;
    }
    return { x: x, y: y };
  }

  async function apply() {
    if (!state.bytes || !state.imageDataUrl) return;
    var pages = pagesToApply();
    if (!pages.length) { D.showError("img-alert", "Select at least one page."); return; }

    progressUI.show();
    progressUI.set(15, "Embedding image…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      var bytes = dataUrlToBytes(state.imageDataUrl);
      var isPng = /^data:image\/png/.test(state.imageDataUrl);
      var img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

      var pos = el("img-pos").value;
      var margin = parseInt(el("img-margin").value, 10) || 30;
      var widthPct = parseInt(el("img-width").value, 10) / 100;
      var opacity = parseInt(el("img-opacity").value, 10) / 100;

      var allPages = doc.getPages();
      pages.forEach(function (pIdx) {
        var page = allPages[pIdx];
        if (!page) return;
        var size = page.getSize();
        var imgW = size.width * widthPct;
        var imgH = imgW / state.imageAspect;
        var p = computePosition(pos, size.width, size.height, margin, imgW, imgH);
        page.drawImage(img, { x: p.x, y: p.y, width: imgW, height: imgH, opacity: opacity });
      });

      progressUI.set(80, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-with-image.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved image-added PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("img-alert", D.humanError(err, "Could not add image to this PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("img-progress"));
    new D.UploadZone("#uz-image", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("img-file").addEventListener("change", function (e) {
      if (e.target.files[0]) handleImage(e.target.files[0]);
    });
    el("img-pages").addEventListener("change", function () {
      el("img-range").hidden = this.value !== "custom";
    });
    el("img-width").addEventListener("input", function () {
      el("img-width-val").textContent = this.value + "%";
    });
    el("img-opacity").addEventListener("input", function () {
      el("img-opacity-val").textContent = this.value + "%";
    });
    el("img-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
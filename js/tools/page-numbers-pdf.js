/**
 * Page Numbers PDF — flexible format, position, range.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, bytes: null, pageCount: 0 };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }
  function hexToRgb01(hex) {
    hex = (hex || "#333333").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(hex, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  function pdfRgb(hex) {
    var c = hexToRgb01(hex);
    return window.PDFLib.rgb(c.r, c.g, c.b);
  }
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

  function formatText(fmt, n, total, custom) {
    if (fmt === "custom") return (custom || "{n}").replace(/\{n\}/g, n).replace(/\{total\}/g, total);
    if (fmt === "n") return String(n);
    if (fmt === "page-n") return "Page " + n;
    if (fmt === "page-n-of-total") return "Page " + n + " of " + total;
    if (fmt === "n-slash-total") return n + " / " + total;
    if (fmt === "dash-n-dash") return "– " + n + " –";
    return String(n);
  }

  function computePos(pos, pageW, pageH, margin, textW, fontSize) {
    var x, y;
    switch (pos) {
      case "bl": x = margin; y = margin; break;
      case "bc": x = (pageW - textW) / 2; y = margin; break;
      case "br": x = pageW - margin - textW; y = margin; break;
      case "tl": x = margin; y = pageH - margin - fontSize; break;
      case "tc": x = (pageW - textW) / 2; y = pageH - margin - fontSize; break;
      case "tr": x = pageW - margin - textW; y = pageH - margin - fontSize; break;
      default: x = (pageW - textW) / 2; y = margin;
    }
    return { x: x, y: y };
  }

  async function loadPdf(file) {
    D.clearAlert("pn-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("pn-alert", "Please choose a PDF."); return;
    }
    el("pn-toolbar").hidden = true;
    D.showInfo("pn-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file;
      state.bytes = bytes;
      var doc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = doc.numPages;
      el("pn-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("pn-toolbar").hidden = false;
      D.clearAlert("pn-alert");
    } catch (err) {
      log(err); D.showError("pn-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function apply() {
    if (!state.bytes) return;
    progressUI.show();
    progressUI.set(15, "Preparing…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));

      var fontName = el("pn-font").value;
      var font;
      if (fontName === "TimesRoman") font = await doc.embedFont(PDFLib.StandardFonts.TimesRoman);
      else if (fontName === "Courier") font = await doc.embedFont(PDFLib.StandardFonts.Courier);
      else font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

      var fmt = el("pn-format").value;
      var custom = el("pn-custom").value;
      var fontSize = parseInt(el("pn-size").value, 10) || 10;
      var color = pdfRgb(el("pn-color").value);
      var pos = el("pn-pos").value;
      var margin = parseInt(el("pn-margin").value, 10) || 24;
      var startNum = parseInt(el("pn-start").value, 10) || 1;

      var pageMode = el("pn-pages").value;
      var targets;
      if (pageMode === "all") { targets = []; for (var i = 0; i < state.pageCount; i++) targets.push(i); }
      else if (pageMode === "skip-first") { targets = []; for (var j = 1; j < state.pageCount; j++) targets.push(j); }
      else { targets = parseRange(el("pn-range").value, state.pageCount); }

      var total = state.pageCount;
      var pages = doc.getPages();
      var n = startNum;

      for (var t = 0; t < targets.length; t++) {
        var pIdx = targets[t];
        var page = pages[pIdx];
        if (!page) continue;
        var text = formatText(fmt, n, total, custom);
        var size = page.getSize();
        var tw = font.widthOfTextAtSize(text, fontSize);
        var p = computePos(pos, size.width, size.height, margin, tw, fontSize);
        page.drawText(text, { x: p.x, y: p.y, size: fontSize, font: font, color: color });
        n++;
        progressUI.set(15 + ((t + 1) / targets.length) * 65, "Numbering page " + (pIdx + 1));
      }

      progressUI.set(85, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-numbered.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved numbered PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("pn-alert", D.humanError(err, "Could not add page numbers."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("pn-progress"));
    new D.UploadZone("#uz-pn", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("pn-format").addEventListener("change", function () {
      el("pn-custom").hidden = this.value !== "custom";
    });
    el("pn-pages").addEventListener("change", function () {
      el("pn-range").hidden = this.value !== "custom";
    });
    el("pn-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
/**
 * Add Text to PDF — place a text string at a fixed position on selected pages.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, bytes: null, pdfDoc: null, pageCount: 0 };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  function hexToRgb01(hex) {
    hex = (hex || "#000000").replace("#", "");
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
        var single = parseInt(chunk, 10);
        if (single >= 1 && single <= max) out.push(single - 1);
      }
    });
    return out;
  }

  function pagesToApply() {
    var mode = el("t-pages").value;
    if (mode === "all") {
      var all = [];
      for (var i = 0; i < state.pageCount; i++) all.push(i);
      return all;
    }
    if (mode === "first") return [0];
    if (mode === "last") return [state.pageCount - 1];
    return parseRange(el("t-range").value, state.pageCount);
  }

  async function loadPdf(file) {
    if (progressUI) progressUI.reset();
    D.clearAlert("text-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("text-alert", "Please choose a PDF."); return;
    }
    el("text-toolbar").hidden = true;
    D.showInfo("text-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file;
      state.bytes = bytes;
      var task = window.pdfjsLib.getDocument({ data: bytes.slice(0) });
      state.pdfDoc = await task.promise;
      state.pageCount = state.pdfDoc.numPages;
      el("text-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("text-toolbar").hidden = false;
      D.clearAlert("text-alert");
      await updatePreview();
    } catch (err) {
      log(err);
      D.showError("text-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  function computePosition(pos, pageW, pageH, margin, textW, fontSize) {
    var textH = fontSize;
    var x, y;
    switch (pos) {
      case "tl": x = margin; y = pageH - margin - textH; break;
      case "tc": x = (pageW - textW) / 2; y = pageH - margin - textH; break;
      case "tr": x = pageW - margin - textW; y = pageH - margin - textH; break;
      case "ml": x = margin; y = (pageH - textH) / 2; break;
      case "mc": x = (pageW - textW) / 2; y = (pageH - textH) / 2; break;
      case "mr": x = pageW - margin - textW; y = (pageH - textH) / 2; break;
      case "bl": x = margin; y = margin; break;
      case "bc": x = (pageW - textW) / 2; y = margin; break;
      case "br": x = pageW - margin - textW; y = margin; break;
      default: x = margin; y = margin;
    }
    return { x: x, y: y };
  }

  async function updatePreview() {
    if (!state.pdfDoc) return;
    try {
      var page = await state.pdfDoc.getPage(1);
      var vp = page.getViewport({ scale: 1.8 });
      var canvas = el("text-preview");
      canvas.width = vp.width; canvas.height = vp.height;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      // Draw the text preview overlay
      var text = el("t-content").value || "Your text here";
      var fontSize = parseInt(el("t-size").value, 10) || 16;
      var bold = el("t-bold").checked;
      var color = el("t-color").value;
      var pos = el("t-pos").value;
      var margin = parseInt(el("t-margin").value, 10) || 30;
      var scale = vp.scale;
      var displayFont = (bold ? "bold " : "") + (fontSize * scale) + "px " +
        (el("t-font").value === "TimesRoman" ? 'Times, serif' :
         el("t-font").value === "Courier" ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif');
      ctx.font = displayFont;
      ctx.fillStyle = color;
      var tw = ctx.measureText(text).width;
      var p = computePosition(pos, vp.width, vp.height, margin * scale, tw, fontSize * scale);
      ctx.fillText(text, p.x, vp.height - p.y);
    } catch (err) { log("preview err", err); }
  }

  async function apply() {
    if (!state.bytes) return;
    var text = (el("t-content").value || "").trim();
    if (!text) { D.showError("text-alert", "Type the text you want to add."); return; }
    var pages = pagesToApply();
    if (!pages.length) { D.showError("text-alert", "Select at least one page."); return; }

    progressUI.show();
    progressUI.set(10, "Preparing…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));

      var fontName = el("t-font").value;
      var bold = el("t-bold").checked;
      var font;
      if (fontName === "TimesRoman") font = await doc.embedFont(bold ? PDFLib.StandardFonts.TimesRomanBold : PDFLib.StandardFonts.TimesRoman);
      else if (fontName === "Courier") font = await doc.embedFont(bold ? PDFLib.StandardFonts.CourierBold : PDFLib.StandardFonts.Courier);
      else font = await doc.embedFont(bold ? PDFLib.StandardFonts.HelveticaBold : PDFLib.StandardFonts.Helvetica);

      var fontSize = parseInt(el("t-size").value, 10) || 16;
      var color = pdfRgb(el("t-color").value);
      var pos = el("t-pos").value;
      var margin = parseInt(el("t-margin").value, 10) || 30;

      var allPages = doc.getPages();
      var textW = font.widthOfTextAtSize(text, fontSize);

      pages.forEach(function (pIdx) {
        var page = allPages[pIdx];
        if (!page) return;
        var size = page.getSize();
        var p = computePosition(pos, size.width, size.height, margin, textW, fontSize);
        page.drawText(text, { x: p.x, y: p.y, size: fontSize, font: font, color: color });
      });

      progressUI.set(80, "Building PDF…");
      doc.setProducer("DSPDF");
      var outBytes = await doc.save({ useObjectStreams: true });
      var blob = new Blob([outBytes], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-text-added.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved text-added PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("text-alert", D.humanError(err, "Could not add text to this PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("text-progress"));
    new D.UploadZone("#uz-text", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("t-pages").addEventListener("change", function () {
      el("t-range").hidden = this.value !== "custom";
    });
    el("text-preview-btn").addEventListener("click", updatePreview);
    el("text-apply").addEventListener("click", apply);

    // Live preview updates (debounced)
    var t;
    ["t-content", "t-font", "t-size", "t-color", "t-bold", "t-pos", "t-margin"].forEach(function (id) {
      el(id).addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(updatePreview, 220);
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
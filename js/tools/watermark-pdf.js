/**
 * Watermark PDF — text or image, centered/tiled, rotatable, adjustable opacity.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var state = { file: null, bytes: null, imageDataUrl: null };
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
  function dataUrlToBytes(dataUrl) {
    var b64 = dataUrl.split(",")[1];
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function loadPdf(file) {
    D.clearAlert("wm-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("wm-alert", "Please choose a PDF."); return;
    }
    el("wm-toolbar").hidden = true;
    D.showInfo("wm-alert", "Reading PDF…");
    try {
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file;
      state.bytes = bytes;
      el("wm-info").textContent = file.name + " (" + D.formatBytes(file.size) + ")";
      el("wm-toolbar").hidden = false;
      D.clearAlert("wm-alert");
    } catch (err) {
      log(err); D.showError("wm-alert", "Could not read this PDF.");
    }
  }

  async function handleImage(file) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      D.showError("wm-alert", "Please choose a PNG or JPG image."); return;
    }
    state.imageDataUrl = await D.fileToDataURL(file);
    D.clearAlert("wm-alert");
  }

  function computeGridForTile(pageW, pageH, wmW, wmH) {
    // Spacing: at least 1.4x the watermark size
    var spacingX = wmW * 1.6;
    var spacingY = wmH * 1.6;
    var cols = Math.max(1, Math.floor(pageW / spacingX));
    var rows = Math.max(1, Math.floor(pageH / spacingY));
    var stepX = pageW / (cols + 1);
    var stepY = pageH / (rows + 1);
    var positions = [];
    for (var r = 1; r <= rows; r++) {
      for (var c = 1; c <= cols; c++) {
        positions.push({ x: c * stepX, y: r * stepY });
      }
    }
    return positions;
  }

  function singlePosition(pos, pageW, pageH, wmW, wmH, margin) {
    switch (pos) {
      case "tl": return { x: margin + wmW / 2, y: pageH - margin - wmH / 2 };
      case "tr": return { x: pageW - margin - wmW / 2, y: pageH - margin - wmH / 2 };
      case "bl": return { x: margin + wmW / 2, y: margin + wmH / 2 };
      case "br": return { x: pageW - margin - wmW / 2, y: margin + wmH / 2 };
      case "center":
      default: return { x: pageW / 2, y: pageH / 2 };
    }
  }

  async function apply() {
    if (!state.bytes) return;
    var type = document.querySelector('input[name="wm-type"]:checked').value;
    var opacity = parseInt(el("wm-opacity").value, 10) / 100;
    var rotation = parseInt(el("wm-rotate").value, 10);
    var position = el("wm-pos").value;

    progressUI.show();
    progressUI.set(15, "Preparing watermark…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      var pages = doc.getPages();

      var textFont = null, textWm = null, imageWm = null;
      if (type === "text") {
        var fontName = el("wm-font").value;
        var bold = el("wm-bold").checked;
        if (fontName === "TimesRoman") textFont = await doc.embedFont(bold ? PDFLib.StandardFonts.TimesRomanBold : PDFLib.StandardFonts.TimesRoman);
        else if (fontName === "Courier") textFont = await doc.embedFont(bold ? PDFLib.StandardFonts.CourierBold : PDFLib.StandardFonts.Courier);
        else textFont = await doc.embedFont(bold ? PDFLib.StandardFonts.HelveticaBold : PDFLib.StandardFonts.Helvetica);
      } else {
        if (!state.imageDataUrl) throw new Error("Choose an image watermark first.");
        var imgBytes = dataUrlToBytes(state.imageDataUrl);
        var isPng = /^data:image\/png/.test(state.imageDataUrl);
        imageWm = isPng ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
      }

      var text = el("wm-text").value || "";
      var fontSize = parseInt(el("wm-size").value, 10) || 48;
      var color = pdfRgb(el("wm-color").value);
      var margin = 30;

      for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        var size = page.getSize();
        var wmW, wmH;

        if (type === "text") {
          wmW = textFont.widthOfTextAtSize(text, fontSize);
          wmH = fontSize;
        } else {
          var aspect = imageWm.width / imageWm.height;
          wmW = size.width * 0.4;
          wmH = wmW / aspect;
        }

        var positions;
        if (position === "tile") {
          positions = computeGridForTile(size.width, size.height, wmW, wmH);
        } else {
          positions = [singlePosition(position, size.width, size.height, wmW, wmH, margin)];
        }

        positions.forEach(function (p) {
          if (type === "text") {
            page.drawText(text, {
              x: p.x - wmW / 2,
              y: p.y - fontSize * 0.35,
              size: fontSize, font: textFont, color: color,
              opacity: opacity,
              rotate: PDFLib.degrees(rotation)
            });
          } else {
            page.drawImage(imageWm, {
              x: p.x - wmW / 2,
              y: p.y - wmH / 2,
              width: wmW, height: wmH,
              opacity: opacity,
              rotate: PDFLib.degrees(rotation)
            });
          }
        });
        progressUI.set(15 + ((i + 1) / pages.length) * 65, "Applying to page " + (i + 1) + " / " + pages.length);
      }

      progressUI.set(85, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-watermarked.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved watermarked PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("wm-alert", D.humanError(err, "Could not watermark this PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("wm-progress"));
    new D.UploadZone("#uz-wm", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    document.querySelectorAll('input[name="wm-type"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var t = document.querySelector('input[name="wm-type"]:checked').value;
        el("wm-text-row").hidden = t !== "text";
        el("wm-image-row").hidden = t !== "image";
      });
    });
    el("wm-image-file").addEventListener("change", function (e) {
      if (e.target.files[0]) handleImage(e.target.files[0]);
    });
    el("wm-opacity").addEventListener("input", function () {
      el("wm-opacity-val").textContent = this.value + "%";
    });
    el("wm-rotate").addEventListener("input", function () {
      el("wm-rotate-val").textContent = this.value + "°";
    });
    el("wm-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
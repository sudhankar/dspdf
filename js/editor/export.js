/**
 * DSPDF Editor — Export
 * ---------------------
 * Bakes overlays into the original PDF using pdf-lib.
 *
 * Coordinate system notes:
 *   - Overlays are stored normalized (0..1) with origin TOP-LEFT.
 *   - pdf-lib uses PDF points with origin BOTTOM-LEFT.
 *   - Conversion: pdfX = normX * pageWidth
 *                 pdfY = pageHeight - (normY + normH) * pageHeight
 *
 * Fonts: standard PDF fonts (Helvetica, Times, Courier) only.
 * Custom fonts would require embedding TTFs — documented as out of scope.
 */
(function () {
  "use strict";
  var Ed = window.DSPDFEditor;
  var state = Ed.state;
  var log = window.dspdfLog || function () {};

  function hexToRgb01(hex) {
    hex = (hex || "#000000").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(hex, 16);
    return {
      r: ((n >> 16) & 255) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255
    };
  }
  function rgb(hex) {
    var c = hexToRgb01(hex);
    return window.PDFLib.rgb(c.r, c.g, c.b);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error("load fail " + src)); };
      document.head.appendChild(s);
    });
  }

  function dataUrlToBytes(dataUrl) {
    var base64 = dataUrl.split(",")[1];
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function embedImageForLib(pdfDoc, el) {
    var bytes = dataUrlToBytes(el.dataUrl);
    var isPng = /^data:image\/png/.test(el.dataUrl);
    if (isPng) return await pdfDoc.embedPng(bytes);
    // pdf-lib supports jpg only for non-PNG; canvas output of typed signatures is PNG.
    // If we encounter WebP/other, we would need to re-encode. We handle PNG and JPG.
    return await pdfDoc.embedJpg(bytes);
  }

  async function exportPdf(opts) {
    opts = opts || {};
    var flatten = opts.flatten !== false;

    if (!state.originalBytes) throw new Error("No PDF loaded.");

    await loadScript("https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js");
    var PDFLib = window.PDFLib;

    var doc = await PDFLib.PDFDocument.load(state.originalBytes.slice(0), { ignoreEncryption: false });
    var pages = doc.getPages();

    // Font cache
    var fontCache = {};
    async function getFont(name, bold) {
      var key = name + (bold ? "-B" : "");
      if (fontCache[key]) return fontCache[key];
      var f;
      if (name === "TimesRoman") f = bold ? await doc.embedFont(PDFLib.StandardFonts.TimesRomanBold)
                                          : await doc.embedFont(PDFLib.StandardFonts.TimesRoman);
      else if (name === "Courier") f = bold ? await doc.embedFont(PDFLib.StandardFonts.CourierBold)
                                            : await doc.embedFont(PDFLib.StandardFonts.Courier);
      else f = bold ? await doc.embedFont(PDFLib.StandardFonts.HelveticaBold)
                    : await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      fontCache[key] = f;
      return f;
    }

    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      var { width: PW, height: PH } = page.getSize();
      var list = state.overlays[p] || [];

      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var x = el.x * PW;
        var y = PH - (el.y + el.h) * PH; // top-left origin flip
        var w = el.w * PW;
        var h = el.h * PH;

        if (el.type === "text") {
          var font = await getFont(el.font, el.bold);
          var fontSize = el.fontSize || 16;
          var lines = wrapText(el.text || "", font, fontSize, w);
          var lineHeight = fontSize * 1.25;
          for (var li = 0; li < lines.length; li++) {
            var line = lines[li];
            var textW = font.widthOfTextAtSize(line, fontSize);
            var tx = x;
            if (el.align === "center") tx = x + (w - textW) / 2;
            else if (el.align === "right") tx = x + w - textW;
            var ty = y + h - (li + 1) * lineHeight + (lineHeight - fontSize) / 2;
            page.drawText(line, {
              x: tx, y: ty, size: fontSize, font: font, color: rgb(el.color || "#000")
            });
          }
        } else if (el.type === "image" || el.type === "signature") {
          try {
            var img = await embedImageForLib(doc, el);
            page.drawImage(img, { x: x, y: y, width: w, height: h });
          } catch (err) {
            log("image embed failed", err);
          }
        } else if (el.type === "rect") {
          page.drawRectangle({
            x: x, y: y, width: w, height: h,
            borderColor: rgb(el.stroke || "#2563EB"),
            borderWidth: el.strokeWidth || 2,
            color: el.fill ? rgb(el.fill) : undefined,
            opacity: el.fill ? 1 : undefined
          });
        } else if (el.type === "ellipse") {
          page.drawEllipse({
            x: x + w / 2, y: y + h / 2,
            xScale: w / 2, yScale: h / 2,
            borderColor: rgb(el.stroke || "#2563EB"),
            borderWidth: el.strokeWidth || 2,
            color: el.fill ? rgb(el.fill) : undefined
          });
        } else if (el.type === "line" || el.type === "arrow") {
          var x1 = x + (el.x1 != null ? el.x1 * w : 0);
          var y1 = y + h - (el.y1 != null ? el.y1 * h : 0);
          var x2 = x + (el.x2 != null ? el.x2 * w : w);
          var y2 = y + h - (el.y2 != null ? el.y2 * h : h);
          page.drawLine({
            start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
            thickness: el.strokeWidth || 2,
            color: rgb(el.stroke || "#2563EB")
          });
          if (el.type === "arrow") {
            drawArrowHead(page, x1, y1, x2, y2, rgb(el.stroke || "#2563EB"), el.strokeWidth || 2);
          }
        } else if (el.type === "draw") {
          // Draw freehand as connected line segments
          var pts = el.points || [];
          if (pts.length > 1) {
            for (var k = 1; k < pts.length; k++) {
              var px1 = x + pts[k - 1][0] * w;
              var py1 = y + h - pts[k - 1][1] * h;
              var px2 = x + pts[k][0] * w;
              var py2 = y + h - pts[k][1] * h;
              page.drawLine({
                start: { x: px1, y: py1 }, end: { x: px2, y: py2 },
                thickness: el.strokeWidth || 3,
                color: rgb(el.color || "#EF4444"), opacity: el.opacity != null ? el.opacity : 1
              });
            }
          }
        } else if (el.type === "highlight" || el.type === "redact") {
          page.drawRectangle({
            x: x, y: y, width: w, height: h,
            color: rgb(el.type === "redact" ? "#000000" : (el.color || "#FDE047")),
            opacity: el.type === "redact" ? 1 : (el.opacity != null ? el.opacity : 0.45)
          });
        }
      }
    }

    doc.setProducer("DSPDF");
    doc.setCreator("DSPDF Editor");

    var bytes = await doc.save({ useObjectStreams: true });
    return bytes;
  }

  function wrapText(text, font, size, maxWidth) {
    // pdf-lib standard fonts don't support newlines directly, so we pre-split.
    var paragraphs = String(text).split(/\n/);
    var out = [];
    paragraphs.forEach(function (para) {
      var words = para.split(/\s+/);
      var line = "";
      words.forEach(function (word) {
        var test = line ? line + " " + word : word;
        var w = font.widthOfTextAtSize(test, size);
        if (w > maxWidth && line) {
          out.push(line);
          line = word;
        } else {
          line = test;
        }
      });
      out.push(line);
    });
    return out.length ? out : [""];
  }

  function drawArrowHead(page, x1, y1, x2, y2, color, thickness) {
    var angle = Math.atan2(y2 - y1, x2 - x1);
    var headLen = Math.max(8, thickness * 3);
    var a1 = angle + Math.PI - 0.4;
    var a2 = angle + Math.PI + 0.4;
    var p1 = { x: x2 + headLen * Math.cos(a1), y: y2 + headLen * Math.sin(a1) };
    var p2 = { x: x2 + headLen * Math.cos(a2), y: y2 + headLen * Math.sin(a2) };
    page.drawLine({ start: { x: x2, y: y2 }, end: p1, thickness: thickness, color: color });
    page.drawLine({ start: { x: x2, y: y2 }, end: p2, thickness: thickness, color: color });
  }

  window.DSPDFEditorExport = { exportPdf: exportPdf };
})();